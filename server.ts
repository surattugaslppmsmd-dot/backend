import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import fs from "fs";
import multer from "multer";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

import { sendEmail } from "./services/sendEmail.js";
import { generateDocx } from "./services/generateDocument.js";

// ================= INIT =================
const app = express();

export const config = {
  api: {
    bodyParser: false,
  },
};

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://surattugaslppm.com",
      "https://www.surattugaslppm.com"
    ],
    methods: ["GET", "POST"],
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

// ================= DATABASE (POSTGRES) =================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// ================= SUPABASE =================
const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ================= JWT =================
if (!process.env.JWT_SECRET) {
  throw new Error("isi JWT_SECRET di vercel");
}

const JWT_SECRET = process.env.JWT_SECRET;

function generateToken(payload: object, expiresIn = 3600) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const tokenHeader = req.headers["authorization"];
  if (!tokenHeader) return res.status(401).json({ error: "No token" });

  const token = String(tokenHeader).split(" ")[1] || tokenHeader;

  try {
    (req as any).user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token Tidak tersedia" });
  }
}

// ================= ADMIN LOGIN =================
app.post("/api/admin-login", async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await pool.query(
      "SELECT * FROM admin WHERE username=$1",
      [username]
    );

    if (!result.rows.length)
      return res.status(401).json({ message: "Username salah. coba ulang deh" });

    const user = result.rows[0];

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return res.status(401).json({ message: "Password salah. coba ulang deh" });

    const token = generateToken({ username: user.username });

    res.json({ token, expiresIn: 3600 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: "Login gagal. tanya orang nya" });
  }
});
// ================= ADMIN ENDPOINT =================

// update status
app.post(
  "/api/admin/:table/:id/status",
  authMiddleware,
  async (req, res) => {
    const { table, id } = req.params;
    const { status } = req.body;

    // validasi status
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ message: "Status tidak valid" });
    }

    // validasi id
    if (isNaN(Number(id))) {
      return res.status(400).json({ message: "ID tidak valid" });
    }

    // validasi table
    const validTable = Object.values(formTableMap).find(
      (c) => c.table === table
    );
    if (!validTable) {
      return res.status(400).json({ message: "Tabel tidak valid" });
    }

    try {
      await pool.query(
        `UPDATE ${table}
         SET status = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [status, Number(id)]
      );

      return res.json({ success: true });
    } catch (err) {
      console.error("UPDATE STATUS ERROR:", err);
      return res.status(500).json({ success: false });
    }
  }
);
// ================= DAFTAR TABEL =================
app.get("/api/admin/all-tables", authMiddleware, async (_req, res) => {
  try {
    const tables = Object.values(formTableMap).map((c) => c.table);
    return res.json({ tables });
  } catch (err) {
    console.error("GET TABLES ERROR:", err);
    return res.status(500).json({ tables: [] });
  }
});
// ================= GET DATA TABEL =================
app.get("/api/admin/:table", authMiddleware, async (req, res) => {
  const { table } = req.params;
  const { page = "1", limit = "20", search = "" } = req.query;

  const pageNum = Number(page);
  const limitNum = Number(limit);
  const offset = (pageNum - 1) * limitNum;

  if (isNaN(pageNum) || isNaN(limitNum)) {
    return res.status(400).json({ data: [] });
  }

  if (!Object.values(formTableMap).some((c) => c.table === table)) {
    return res.status(400).json({ data: [] });
  }

  try {
    const query = `
      SELECT * FROM ${table}
      WHERE COALESCE(nama_ketua, nama, '') ILIKE $1
      ORDER BY id DESC
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [
      `%${search}%`,
      limitNum,
      offset,
    ]);

    return res.json({ data: result.rows });
  } catch (err) {
    console.error("GET TABLE DATA ERROR:", err);
    return res.status(500).json({ data: [] });
  }
});

// ================= COUNT DATA =================
app.get("/api/admin/:table/count", authMiddleware, async (req, res) => {
  const { table } = req.params;
  const { search = "" } = req.query;

  if (!Object.values(formTableMap).some((c) => c.table === table)) {
    return res.status(400).json({ total: 0 });
  }

  try {
    const query = `
      SELECT COUNT(*)::int AS total
      FROM ${table}
      WHERE COALESCE(nama_ketua, nama, '') ILIKE $1
    `;

    const result = await pool.query(query, [`%${search}%`]);

    return res.json({ total: result.rows[0].total });
  } catch (err) {
    console.error("COUNT ERROR:", err);
    return res.status(500).json({ total: 0 });
  }
});

// FORM CONFIG
const formTableMap: Record<
  string,
  {
    table: string;
    mapFn: (row: any, anggota: { name: string; nidn: string }[]) => Record<string, any>;
    template: string;
    emailSubject: string;
    requiredFields: string[];
  }
> = {
  HalamanPengesahan: {
    table: "halaman_pengesahan",
    mapFn: (row, anggota) => ({
      Email: row.email || "",
      Puslitbang: row.puslitbang || "",
      NamaKetua: row.nama_ketua || row.nama || "",
      NIDN: row.nidn || "",
      JabatanFungsional: row.jabatan || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
      NomorHP: row.nomor_hp || "",
      Judul: row.judul || "",
      NamaInstitusi: row.nama_institusi || "",
      AlamatInstitusi: row.alamat || "",
      PenanggungJawab: row.penanggung_jawab || "",
      TahunPelaksana: row.tahun_pelaksana || "",
      BiayaTahun: row.biaya_tahun || "",
      BiayaKeseluruhan: row.biaya_keseluruhan || "",
      Tanggal: row.tanggal
        ? new Date(row.tanggal).toLocaleDateString("id-ID", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : "",
      NamaDekan: row.nama_dekan || "",
      NipDekan: row.nip_dekan || "",
      NamaPeneliti: row.nama_peneliti || "",
      NipKetua: row.nip_ketua || "",
      anggota: anggota || [],
    }),
    template: "Halaman Pengesahan.docx",
    emailSubject: "Halaman Pengesahan",
    requiredFields: [
      "email",
      "nama_ketua",
      "nidn",
      "fakultas",
      "prodi",
      "judul",
      "tanggal",
    ],
  },

  SuratTugasBuku: {
    table: "surat_tugas_buku",
    mapFn: (row, anggota) => ({
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      JabatanFungsional: row.jabatan || "",
      Judul: row.judul || "",
      JenisBuku: row.jenis_buku || "",
      PenerbitBuku: row.penerbit_buku || "",
      Tanggal: row.tanggal
        ? new Date(row.tanggal).toLocaleDateString("id-ID", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : "",
      anggota: anggota || [],
    }),
    template: "Surat Tugas Buku.docx",
    emailSubject: "Surat Tugas Buku",
    requiredFields: [
      "email",
      "nama_ketua",
      "nidn",
      "judul",
      "jenis_buku",
      "penerbit_buku",
      "tanggal",
    ],
  },

  SuratTugasHKI: {
    table: "surat_tugas_hki",
    mapFn: (row, anggota) => ({
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      JabatanFungsional: row.jabatan || "",
      judulCiptaan: row.judul_ciptaan || "",
      JenisHakCipta: row.jenis_hki || "",
      No_Tanggal_Permohonan: row.tanggal_permohonan
        ? new Date(row.tanggal_permohonan).toLocaleDateString("id-ID", {
          day: "numeric",
          month: "long",
          year: "numeric",
        }): "",
      Tanggal: row.tanggal
        ? new Date(row.tanggal).toLocaleDateString("id-ID", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : "",
      anggota: anggota || [],
    }),
    template: "Surat Tugas HKI.docx",
    emailSubject: "Surat Tugas HKI",
    requiredFields: ["email", "nama_ketua", "nidn", "judul_ciptaan", "jenis_hki", "tanggal_permohonan", "jabatan"],
  },

  SuratTugasPenelitian: {
    table: "surat_tugas_penelitian",
    mapFn: (row, anggota) => ({
      TahunPengajuan: row.tanggal_pengajuan
        ? new Date(row.tanggal_pengajuan).getFullYear().toString()
        : "",
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      JabatanFungsional: row.jabatan || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
      Judul: row.judul || "",
      Tanggal: row.tanggal
        ? new Date(row.tanggal).toLocaleDateString("id-ID", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : "",
      anggota: anggota || [],
    }),
    template: "Surat Tugas Penelitian.docx",
    emailSubject: "Surat Tugas Penelitian",
    requiredFields: ["email", "nama_ketua", "nidn", "judul", "tanggal"],
  },

  SuratTugasPKM: {
    table: "surat_tugas_pkm",
    mapFn: (row, anggota) => ({
      TahunPengajuan: row.tanggal_pengajuan
        ? new Date(row.tanggal_pengajuan).getFullYear().toString()
        : "",
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      JabatanFungsional: row.jabatan || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
      Judul: row.judul || "",
      Tanggal: row.tanggal
        ? new Date(row.tanggal).toLocaleDateString("id-ID", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : "",
      anggota: anggota || [],
    }),
    template: "Surat Tugas PKM.docx",
    emailSubject: "Surat Tugas PKM",
    requiredFields: ["email", "nama_ketua", "nidn", "judul", "tanggal"],
  },
};

// SubmitFormtype

app.post(
  "/api/submit/:formType",
  upload.single("pdfFile"),
  async (req, res) => {
    try {
      const { formType } = req.params;
      const config = formTableMap[formType];

      if (!config) {
        return res.status(400).json({
          success: false,
          message: "Form tidak valid",
        });
      }

      const data = req.body;

      // ================= VALIDASI =================
      for (const field of config.requiredFields) {
        if (!data[field]) {
          return res.status(400).json({
            success: false,
            message: `Field ${field} wajib diisi`,
          });
        }
      }

      // ================= PARSE ANGGOTA =================
      let anggota: any[] = [];
      try {
        anggota = JSON.parse(data.anggota || "[]");
      } catch {
        return res.status(400).json({
          success: false,
          message: "Format anggota tidak valid",
        });
      }

      // DOCX TEMPLATE
      const mapped = config.mapFn(data, anggota);
      const docxPath = await generateDocx(config.template, mapped);
      const buffer = await fs.promises.readFile(docxPath);

      // TANGGAL & HARI
      const tanggal = new Date();
      const formatter = new Intl.DateTimeFormat("id-ID", {
        weekday: "long",
        day: "2-digit",
        month: "long",
      });
      const tanggalIndo = formatter.format(tanggal);

      // ================= EMAIL USER =================
      try {
        await sendEmail(
          data.email,
          "Konfirmasi Pengisian Form LPPM",
          null,
          "Terima kasih sudah mengisi form,\n\nuntuk surat yang telah di isi dapat menghubungi nomor Admin LPPM 085117513399 an. Novi."
        );
      } catch (e) {
        console.error("EMAIL USER ERROR:", e);
      }

      // ================= EMAIL ADMIN =================
      try {
        await sendEmail(
          "surattugaslppmsmd@gmail.com",
          `Surat Tugas Baru Hari ${tanggalIndo}`,
          {
            filename: `${data.nama_ketua || "user"}.docx`,
            content: buffer,
          },
          `Form ${formType} dari ${data.nama_ketua}, email: ${data.email}.`
        );
      } catch (e) {
        console.error("EMAIL ADMIN ERROR:", e);
      }

      // ================= HAPUS FILE TEMP =================
      if (fs.existsSync(docxPath)) {
        fs.unlinkSync(docxPath);
      }

      // ================= RESPONSE =================
      return res.status(200).json({
        success: true,
        message: "Form berhasil dikirim",
      });
    } catch (err: any) {
      console.error("SUBMIT ERROR:", err);
      return res.status(500).json({
        success: false,
        message: err.message || "Terjadi kesalahan di server",
      });
    }
  }
);

// ================= RUN =================
if (!process.env.VERCEL) {
  app.listen(5000, () => console.log("Server running"));
}

export default app;