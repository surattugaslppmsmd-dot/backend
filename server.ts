import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { sendEmail } from "./services/sendEmail.js";
import { generateDocx } from "./services/generateDocument.js";


dotenv.config();
const app = express();
app.use(bodyParser.json());
app.use(cors({ origin: "*" }));

const requiredEnvs = [
  "DATABASE_URL",
  "JWT_SECRET",
  "SUPABASE_URL",
  "SUPABASE_KEY",
];


requiredEnvs.forEach((key) => {
  if (!process.env[key]) {
    console.warn(`⚠️  Warning: ENV ${key} tidak ditemukan! Pastikan sudah diset di Vercel`);
  }
});

console.log("Environment variables berhasil dimuat");

// === NeonDB (Postgres) ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// === Supabase ===
const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

// === JWT Helper ===
const JWT_SECRET = process.env.JWT_SECRET || "";

function generateToken(payload: object, expiresIn: number = 3600): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn }) as string;
}

function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) return res.status(401).json({ error: "No token" });
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    (req as any).user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// ===== Admin login =====
app.post("/api/admin-login", async (req: Request, res: Response) => {
  try {
    const username = req.body.username?.trim();
    const password = req.body.password?.trim();
    if (!username || !password) {
      return res.status(400).json({ message: "Username dan Password wajib diisi" });
    }

    const result = await pool.query("SELECT * FROM admin WHERE username = $1", [username]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Username tidak ditemukan" });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ message: "Password salah" });
    }

    const token = generateToken({ username: user.username }, 3600);
    res.json({ token, expiresIn: 3600 });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Login gagal" });
  }
});

// ===== Helper: get all from table =====
async function getAllFromTable(tableName: string) {
  const result = await pool.query(`SELECT * FROM ${tableName} ORDER BY id DESC`);
  return result.rows;
}

// ===== Public GET endpoints for tables =====
app.get("/api/anggota-surat", async (req, res) => {
  try {
    const data = await getAllFromTable("anggota_surat");
    res.json(data);
  } catch (err) {
    console.error("Error fetching Anggota:", err);
    res.status(500).json({ message: "Gagal mengambil data Anggota" });
  }
});

app.get("/api/halaman-pengesahan", async (req, res) => {
  try {
    const data = await getAllFromTable("halaman_pengesahan");
    res.json(data);
  } catch (err) {
    console.error("Error fetching Halaman Pengesahan:", err);
    res.status(500).json({ message: "Gagal mengambil data Halaman Pengesahan" });
  }
});

app.get("/api/surat-tugas-buku", async (req, res) => {
  try {
    const data = await getAllFromTable("surat_tugas_buku");
    res.json(data);
  } catch (err) {
    console.error("Error fetching Surat Tugas Buku:", err);
    res.status(500).json({ message: "Gagal mengambil data Surat Tugas Buku" });
  }
});

app.get("/api/surat-tugas-hki", async (req, res) => {
  try {
    const data = await getAllFromTable("surat_tugas_hki");
    res.json(data);
  } catch (err) {
    console.error("Error fetching Surat Tugas HKI:", err);
    res.status(500).json({ message: "Gagal mengambil data Surat Tugas HKI" });
  }
});

app.get("/api/surat-tugas-penelitian", async (req, res) => {
  try {
    const data = await getAllFromTable("surat_tugas_penelitian");
    res.json(data);
  } catch (err) {
    console.error("Error fetching Surat Tugas Penelitian:", err);
    res.status(500).json({ message: "Gagal mengambil data Surat Tugas Penelitian" });
  }
});

app.get("/api/surat-tugas-pkm", async (req, res) => {
  try {
    const data = await getAllFromTable("surat_tugas_pkm");
    res.json(data);
  } catch (err) {
    console.error("Error fetching Surat Tugas PKM:", err);
    res.status(500).json({ message: "Gagal mengambil data Surat Tugas PKM" });
  }
});

// ===== FORM CONFIG =====
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
      NamaKetua: row.nama_ketua || row.nama || "",
      NIDN: row.nidn || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
      Judul: row.judul || "",
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "",
      anggota: anggota || [],
    }),
    template: "Halaman Pengesahan.docx",
    emailSubject: "Halaman Pengesahan",
    requiredFields: ["email", "nama_ketua", "nidn", "fakultas", "prodi", "judul", "tanggal"],
  },

  SuratTugasBuku: {
    table: "surat_tugas_buku",
    mapFn: (row, anggota) => ({
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      Judul: row.judul || "",
      JenisBuku: row.jenis_buku || "",
      PenerbitBuku: row.penerbit_buku || "",
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "",
      anggota: anggota || [],
    }),
    template: "Surat Tugas Buku.docx",
    emailSubject: "Surat Tugas Buku",
    requiredFields: ["email", "nama_ketua", "nidn", "judul", "jenis_buku", "penerbit_buku", "tanggal"],
  },

  SuratTugasHKI: {
    table: "surat_tugas_hki",
    mapFn: (row, anggota) => ({
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      JudulCiptaan: row.judul_ciptaan || "",
      JenisHKI: row.jenis_hki || "",
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "",
      anggota: anggota || [],
    }),
    template: "Surat Tugas HKI.docx",
    emailSubject: "Surat Tugas HKI",
    requiredFields: ["email", "nama_ketua", "nidn", "judul_ciptaan", "jenis_hki"],
  },

  SuratTugasPenelitian: {
    table: "surat_tugas_penelitian",
    mapFn: (row, anggota) => ({
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
      Judul: row.judul || "",
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "",
      anggota: anggota || [],
    }),
    template: "Surat Tugas Penelitian.docx",
    emailSubject: "Surat Tugas Penelitian",
    requiredFields: ["email", "nama_ketua", "nidn", "judul", "tanggal"],
  },

  SuratTugasPKM: {
    table: "surat_tugas_pkm",
    mapFn: (row, anggota) => ({
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
      Judul: row.judul || "",
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "",
      anggota: anggota || [],
    }),
    template: "Surat Tugas PKM.docx",
    emailSubject: "Surat Tugas PKM",
    requiredFields: ["email", "nama_ketua", "nidn", "judul", "tanggal"],
  },
};


// === Alur Submit ===
app.post("/api/submit/:formType", async (req, res) => {
  const { formType } = req.params;
  const formData = req.body;
  const config = formTableMap[formType];

  try {
    // 1. generate docx
    const docxPath = await generateDocx(config.template, formData);
    const docxBuffer = fs.readFileSync(docxPath);

    // 2. bikin filename NamaKetua_(TemplateName).docx
    const templateName = config.template.replace(/\.docx$/, "");
    const namaKetua = formData.nama_ketua || "Unknown";
    const filename = `${formData.nama_ketua}_${templateName}.docx`;

    // 3. upload ke supabase
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("surat-tugas-files")
      .upload(filename, docxBuffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

    if (uploadError) throw uploadError;

    const fileUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/surat-tugas-files/${filename}`;

    // 4. simpan ke NeonDB
    await pool.query(
      `INSERT INTO ${config.table} (email, nama_ketua, judul, file_url, status) 
       VALUES ($1, $2, $3, $4, $5)`,
      [formData.email, formData.nama_ketua, formData.judul, fileUrl, "belum_dibaca"]
    );

    // 5. kirim email user
    await sendEmail(
      formData.email,
      "Konfirmasi Pengisian Form LPPM",
      null,
      "Terima kasih sudah mengisi form, untuk surat yang telah di isi dapat menghubungi Admin LPPM - 085117513399 A.n Novi."
    );

    // 6. kirim email admin dengan lampiran
    await sendEmail(
      "surattugaslppmsmd@gmail.com",
      `Surat Tugas Baru dari ${formData.nama_ketua}`,
      { filename, content: docxBuffer },
      `Dokumen ${formData.nama_ketua} terlampir.`
    );

    res.json({ success: true, fileUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Gagal submit form" });
  }
});

// === Admin: Get all data by table ===
app.get("/admin/:table", authMiddleware, async (req, res) => {
  const { table } = req.params;
  try {
    const result = await pool.query(`SELECT * FROM ${table} ORDER BY id DESC`);
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// === Admin: Update status (read/approve) ===
app.post("/admin/:table/:id/status", authMiddleware, async (req, res) => {
  const { table, id } = req.params;
  const { status } = req.body;
  try {
    const result = await pool.query(
      `UPDATE ${table} SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );
    res.json(result.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// === Admin: Get all tables (untuk dashboard) ===
app.get("/admin/all-tables", authMiddleware, async (req, res) => {
  try {
    const tables = Object.values(formTableMap).map((f) => f.table);
    res.json({ tables });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// === Root ===
app.get("/", (req, res) => {
  res.send("API aktif");
});

export default app;