// backend/server.ts
import express, { Request, Response, NextFunction } from "express";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import fs from "fs";
import multer from "multer";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "./services/sendEmail.js";
import { generateDocx } from "./services/generateDocument.js";

dotenv.config();

// CONFIG

const allowedOrigins = [
  "https://surattugaslppm.com",
  "https://www.surattugaslppm.com",
  "https://surattugaslppm.untag-smd.ac.id",
  "https://www.surattugaslppm.untag-smd.ac.id",
  "http://localhost:5173",
];

// EXPRESS APP

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  const origin = req.headers.origin;

  const allowedOrigins = [
    "https://surattugaslppm.com",
    "https://www.surattugaslppm.com",
    "https://surattugaslppm.untag-smd.ac.id",
    "http://localhost:5173",
  ];

  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  }

  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,DELETE,OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  // HANDLE PREFLIGHT
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.options("*", (_, res) => res.status(200).end());
const upload = multer({ storage: multer.memoryStorage() });

// DATABASE

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
});

// SUPABASE

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// JWT

const JWT_SECRET = process.env.JWT_SECRET || "change_this_secret";

function generateToken(payload: object, expiresIn = 3600) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  let tokenHeader = req.headers["authorization"];

  if (!tokenHeader) return res.status(401).json({ error: "No token" });

  const token = String(tokenHeader).split(" ")[1] || tokenHeader;

  try {
    (req as any).user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}

// ADMIN LOGIN

app.post("/api/admin-login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "").trim();

    const result = await pool.query("SELECT * FROM admin WHERE username=$1", [
      username,
    ]);

    if (result.rows.length === 0)
      return res.status(401).json({ message: "Username salah" });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);

    if (!match) return res.status(401).json({ message: "Password salah" });

    const token = generateToken({ username: user.username });

    return res.json({ token, expiresIn: 3600 });
  } catch (e) {
    console.error("Login error:", e);
    res.status(500).json({ message: "Login gagal" });
  }
});

// GENERIC GET TABLE

async function getAll(table: string) {
  const r = await pool.query(`SELECT * FROM ${table} ORDER BY id DESC`);
  return r.rows;
}

app.get("/api/:table", async (req, res) => {
  const allowedTables = [
    "anggota_surat",
    "halaman_pengesahan",
    "surat_tugas_buku",
    "surat_tugas_hki",
    "surat_tugas_penelitian",
    "surat_tugas_pkm",
  ];

  const { table } = req.params;

  if (!allowedTables.includes(table))
    return res.status(400).json({ message: "Table tidak valid" });

  try {
    return res.json(await getAll(table));
  } catch (err) {
    console.error("GET error:", err);
    return res.status(500).json({ message: "Gagal mengambil data" });
  }
});

//  FORM CONFIG 
const formTableMap: Record<
  string,
  {
    table: string;
    mapFn: (row: any, anggota: { name: string; nidn: string }[]) => Record<
      string,
      any
    >;
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

//  Submit Handler 

//  FORM SUBMIT
app.post("/api/submit/:formType", upload.single("pdfFile"), async (req, res) => {
  try {
    const { formType } = req.params;
    const config = formTableMap[formType];

    if (!config) return res.status(400).json({ error: "Form type tidak valid" });

    let formData = req.body || {};
    const uploadedFile = (req as any).file;

    // parse anggota
    try {
      formData.anggota = JSON.parse(formData.anggota || "[]");
    } catch {
      formData.anggota = [];
    }

    //  Generate DOCX 
    const mapped = config.mapFn(formData, formData.anggota);
    const docxPath = await generateDocx(config.template, mapped);
    const docxBuffer = fs.readFileSync(docxPath);

    // Upload DOCX
    const filename = `${formData.nama_ketua || "Unknown"}_${Date.now()}.docx`;
    const { error: uploadErr } = await supabase.storage
      .from("surat-tugas-files")
      .upload(filename, docxBuffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

    if (uploadErr) throw uploadErr;

    const fileUrl =
      `${process.env.SUPABASE_URL}/storage/v1/object/public/surat-tugas-files/${filename}`;

    // Upload PDF
    let pdfUrl = null;
    if (uploadedFile) {
      const pdfName = `${formData.nama_ketua}_${Date.now()}_${uploadedFile.originalname}`;
      const { error: pdfError } = await supabase.storage
        .from("uploads")
        .upload(pdfName, uploadedFile.buffer, {
          contentType: uploadedFile.mimetype,
        });
      if (!pdfError) {
        pdfUrl =
          `${process.env.SUPABASE_URL}/storage/v1/object/public/uploads/${pdfName}`;
      }
    }

    // Insert into DB
    const safeData = { ...formData, file_url: fileUrl, pdf_url: pdfUrl, status: "belum_dibaca" };
    delete safeData.anggota;

    const cols = Object.keys(safeData);
    const vals = Object.values(safeData);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");

    const result = await pool.query(
      `INSERT INTO ${config.table} (${cols.join(",")}) VALUES (${placeholders}) RETURNING id`,
      vals
    );

    const suratId = result.rows[0].id;

    // Insert anggota
    for (const ag of formData.anggota) {
      await pool.query(
        `INSERT INTO anggota_surat (surat_type, surat_id, nama, nidn, idsintaanggota) 
         VALUES ($1, $2, $3, $4, $5)`,
        [config.table, suratId, ag.name || "", ag.nidn || "", ag.idsintaAnggota || ""]
      );
    }

    // Send emails
    await sendEmail(
      formData.email,
      "Konfirmasi Pengisian Form LPPM",
      null,
      "Terima kasih sudah mengisi form, untuk surat hasil form dapat menghubungi Admin LPPM - 085117513399 A.n Novi."
    );

    await sendEmail(
      "surattugaslppmsmd@gmail.com",
      `Surat Tugas Baru dari ${formData.nama_ketua}`,
      { filename, content: docxBuffer },
      `Form baru dari ${formData.nama_ketua}, email: ${formData.email}.`
    );

    res.json({
  success: true,
  message: "Formulir berhasil dikirim",
  fileUrl,
  pdfUrl,
});
  } catch (err) {
    console.error("Submit error:", err);
    res.status(500).json({
  success: false,
  message: "Gagal submit form",
});
  }
});

//  ADMIN ENDPOINTS 
const ADMIN_TABLES = [
  "anggota_surat",
  "halaman_pengesahan",
  "surat_tugas_buku",
  "surat_tugas_hki",
  "surat_tugas_penelitian",
  "surat_tugas_pkm",
];

// list all tables (admin)
async function listTables() {
  const r = await pool.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  return r.rows.map((x) => x.tablename);
}

//  GET ALL TABLE NAMES 
app.get("/api/admin/all-tables", authMiddleware, async (req, res) => {
  try {
    res.json({ tables: await listTables() });
  } catch (err) {
    console.error("LIST TABLE ERROR:", err);
    res.status(500).json({ message: "Gagal mengambil daftar tabel" });
  }
});

const SEARCHABLE_COLUMNS: Record<string, string[]> = {
  anggota_surat: ["nama", "nidn"],
  halaman_pengesahan: ["email", "nama_ketua"],
  surat_tugas_buku: ["email", "nama_ketua"],
  surat_tugas_hki: ["email", "nama_ketua"],
  surat_tugas_penelitian: ["email", "nama_ketua"],
  surat_tugas_pkm: ["email", "nama_ketua"],
};

app.get("/api/admin/:table", authMiddleware, async (req, res) => {
  const { table } = req.params;
  const page = Math.max(Number(req.query.page || 1), 1);
  const limit = Math.min(Number(req.query.limit || 20), 100);
  const search = String(req.query.search || "").trim();

  if (!ADMIN_TABLES.includes(table)) {
    return res.status(400).json({ message: "Table tidak valid" });
  }

  const offset = (page - 1) * limit;
  const cols = SEARCHABLE_COLUMNS[table] || [];
  const where =
    search && cols.length
      ? `WHERE (${cols.map((c) => `${c} ILIKE $1`).join(" OR ")})`
      : "";

  const params = search ? [`%${search}%`, limit, offset] : [limit, offset];

  try {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM ${table}
      ${where}
      ORDER BY id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
      `,
      params
    );

    res.json({
      data: rows,
      page,
      limit,
      hasMore: rows.length === limit,
    });
  } catch (err) {
    console.error("ADMIN DATA ERROR:", err);
    res.status(500).json({ message: "Gagal mengambil data" });
  }
});

app.get("/api/admin/:table/count", authMiddleware, async (req, res) => {
  const { table } = req.params;
  const search = String(req.query.search || "").trim();

  if (!ADMIN_TABLES.includes(table)) {
    return res.status(400).json({ message: "Table tidak valid" });
  }

  const cols = SEARCHABLE_COLUMNS[table] || [];
  const where =
    search && cols.length
      ? `WHERE (${cols.map((c) => `${c} ILIKE $1`).join(" OR ")})`
      : "";

  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS total FROM ${table} ${where}`,
      search ? [`%${search}%`] : []
    );

    res.json({ total: r.rows[0].total });
  } catch (err) {
    console.error("ADMIN COUNT ERROR:", err);
    res.status(500).json({ message: "Gagal menghitung total data, karena saya capek :(" });
  }
});


// UPDATE STATUS 
app.post(
  "/api/admin/:table/:id/status",
  authMiddleware,
  async (req, res) => {
    const { table, id } = req.params;
    const { status } = req.body;

    if (!ADMIN_TABLES.includes(table)) {
      return res.status(400).json({ error: "Invalid table" });
    }

    if (!status) {
      return res.status(400).json({ error: "Di isi dong status nya" });
    }

    try {
      const r = await pool.query(
        `UPDATE ${table} SET status=$1 WHERE id=$2 RETURNING *`,
        [status, id]
      );

      if (r.rows.length === 0) {
        return res.status(404).json({ error: "Mana ya data nya coba cari yang lain." });
      }

      res.json(r.rows[0]);
    } catch (err) {
      console.error("UPDATE STATUS ERROR:", err);
      res.status(500).json({ error: "Gagal update status" });
    }
  }
);

//  LOCAL MODE (dev) 
if (!process.env.VERCEL) {
  const port = process.env.PORT || 5000;
  app.listen(port, () => console.log("Running locally on port", port));
}

//  VERCEL HANDLER 
export default function handler(req: any, res: any) {
  return app(req, res);
}
