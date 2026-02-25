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
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
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
  throw new Error("JWT_SECRET is not defined");
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
    res.status(401).json({ error: "Invalid token" });
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
    res.status(500).json({ message: "Login gagal. kenapa ya" });
  }
});
// ================= ADMIN ENDPOINT =================

// Daftar semua tabel
app.get("/api/admin/all-tables", authMiddleware, async (req, res) => {
  try {
    const tables = Object.values(formTableMap).map(c => c.table);
    res.json({ tables });
  } catch (err) {
    console.error(err);
    res.status(500).json({ tables: [] });
  }
});

// Ambil data tabel tertentu
app.get("/api/admin/:table", authMiddleware, async (req, res) => {
  const { table } = req.params;
  const { page = 1, limit = 20, search = "" } = req.query;
  try {
    if (!Object.values(formTableMap).some(c => c.table === table)) {
      return res.status(400).json({ data: [] });
    }
    const offset = (Number(page) - 1) * Number(limit);
    const query = `
      SELECT * FROM ${table} 
      WHERE COALESCE(nama_ketua, nama, '') ILIKE $1
      ORDER BY id DESC
      LIMIT $2 OFFSET $3
    `;
    const result = await pool.query(query, [`%${search}%`, limit, offset]);
    res.json({ data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ data: [] });
  }
});

// Hitung total data untuk pagination
app.get("/api/admin/:table/count", authMiddleware, async (req, res) => {
  const { table } = req.params;
  const { search = "" } = req.query;
  try {
    if (!Object.values(formTableMap).some(c => c.table === table)) {
      return res.status(400).json({ total: 0 });
    }
    const query = `
      SELECT COUNT(*) FROM ${table} 
      WHERE COALESCE(nama_ketua, nama, '') ILIKE $1
    `;
    const result = await pool.query(query, [`%${search}%`]);
    res.json({ total: Number(result.rows[0].count) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ total: 0 });
  }
});

// ================= FORM CONFIG =================
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
app.post("/api/submit/:formType", upload.single("pdfFile"), async (req, res) => {
  try {
    const { formType } = req.params;
    const config = formTableMap[formType];

    if (!config) {
      return res.status(400).json({
        success: false,
        message: "Form tidak valid",
      });
    }

    let data = req.body;

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

    // ================= VALIDASI FILE =================
    const uploadedFile = req.file;

    if (uploadedFile) {
      const allowed = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];

      if (!allowed.includes(uploadedFile.mimetype)) {
        return res.status(400).json({
          success: false,
          message: "File harus PDF atau DOCX",
        });
      }
    }

    // ================= GENERATE DOCX =================
    const mapped = config.mapFn(data, anggota);

    const docxPath = await generateDocx(config.template, mapped);
    const buffer = await fs.promises.readFile(docxPath);

    // ================= UPLOAD DOCX =================
    const filename = `${data.nama_ketua || "user"}_${Date.now()}.docx`;

    const { error: uploadErr } = await supabase.storage
      .from("surat-tugas-files")
      .upload(filename, buffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

    if (uploadErr) {
      throw new Error("Upload DOCX gagal");
    }

    const fileUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/surat-tugas-files/${filename}`;

    // ================= UPLOAD PDF (OPTIONAL) =================
    let pdfUrl: string | null = null;

    if (uploadedFile) {
      const safeName = (data.nama_ketua || "user").replace(/\s+/g, "_");

      const pdfName = `${safeName}_${Date.now()}_${uploadedFile.originalname}`;

      const { error: pdfErr } = await supabase.storage
        .from("uploads")
        .upload(pdfName, uploadedFile.buffer, {
          contentType: uploadedFile.mimetype,
        });

      if (!pdfErr) {
        pdfUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/uploads/${pdfName}`;
      }
    }

    // ================= INSERT DB =================
    const safeData = {
      ...data,
      file_url: fileUrl,
      pdf_url: pdfUrl,
      status: "belum_dibaca",
    };

    delete safeData.anggota;

    const cols = Object.keys(safeData);
    const vals = Object.values(safeData);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
    const allowedTables = Object.values(formTableMap).map(c => c.table);

    if (!allowedTables.includes(config.table)) {
      throw new Error("Invalid table");
    }
    const result = await pool.query(
      `INSERT INTO ${config.table} (${cols.join(",")})
       VALUES (${placeholders}) RETURNING id`,
      vals
    );

    const id = result.rows[0].id;

    // insert anggota
    if (anggota.length > 0) {
      await Promise.all(
        anggota.map((ag: any) =>
          pool.query(
            `INSERT INTO anggota_surat (surat_type, surat_id, nama, nidn, idsintaanggota)
            VALUES ($1,$2,$3,$4,$5)`,
            [config.table, id, ag.name, ag.nidn, ag.idsintaAnggota || null]
          )
        )
      );
    }


    // response
      res.status(200).json({
      success: true,
      message: "Form berhasil dikirim",
      fileUrl,
      pdfUrl,
    });
    
    // email ke user
    sendEmail(data.email, "Konfirmasi Pengisian Form LPPM", null, 
      "Terima kasih sudah mengisi form, untuk surat hasil form dapat menghubungi Admin LPPM - 085117513399 A.n Novi."
    ).catch(e => console.error("Email Ke User Error", e));

    // email ke admin
    sendEmail(
      "surattugaslppmsmd@gmail.com",
      `Surat Tugas Baru dari ${data.nama_ketua}`,
      { filename, content: buffer },
      `Form baru dari ${data.nama_ketua}`
    ).catch(e => console.error("EMAIL ADMIN ERROR", e));

  } catch (err: any) {
    console.error("SUBMIT ERROR:", err);

    res.status(500).json({
      success: false,
      message: err.message || "Terjadi kesalahan di server",
    });
  }
});

// ================= RUN =================
if (!process.env.VERCEL) {
  app.listen(5000, () => console.log("Server running"));
}

export default app;