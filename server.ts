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
import multer from "multer";

dotenv.config();
const app = express();
// ===== CORS GLOBAL =====
app.use(
  cors({
    origin: ["https://surattugaslppm.com"],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);


// ===== Body Parser =====
app.use(bodyParser.json());

const upload = multer({ storage: multer.memoryStorage() });

// === PostgreSQL Pool ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

const supabase = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

const JWT_SECRET = process.env.JWT_SECRET || "";

// ===== JWT Helper =====
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
  } catch {
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


// ===== Helper: get all =====
async function getAllFromTable(tableName: string) {
  const result = await pool.query(`SELECT * FROM ${tableName} ORDER BY id DESC`);
  return result.rows;
}

// ===== GET endpoint dinamis =====
app.get("/api/:table", async (req, res) => {
  const { table } = req.params;

  // daftar tabel yang diijinkan
  const allowedTables = [
    "anggota_surat",
    "halaman_pengesahan",
    "surat_tugas_buku",
    "surat_tugas_hki",
    "surat_tugas_penelitian",
    "surat_tugas_pkm",
  ];

  if (!allowedTables.includes(table)) {
    return res.status(400).json({ message: "Table tidak valid" });
  }

  try {
    const rows = await getAllFromTable(table);
    res.json(rows);
  } catch (err: any) {
    console.error(`Error GET /api/${table}:`, err.message);
    res.status(500).json({
      message: `Gagal mengambil data dari ${table}`,
      error: err.message,
    });
  }
});


// ===== FORM CONFIG =====
const formTableMap: Record < string,
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
      JabatanFungsional : row.jabatan || "",
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
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "",
      NamaDekan: row.nama_dekan || "",
      NipDekan: row.nip_dekan || "",
      NamaPeneliti: row.nama_peneliti || "",
      NipKetua: row.nip_ketua || "",
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
      JabatanFungsional: row.jabatan || "",
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
      JenisHakCipta: row.jenis_hki || "",
      No_Tanggal_Permohonan: row.tanggal_permohonan ? new Date(row.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "",
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
      TahunPengajuan: row.tanggal_pengajuan ? new Date (row.tanggal_pengajuan).getFullYear().toString(): "",
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      JabatanFungsional: row.jabatan || "",
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
      TahunPengajuan: row.tanggal_pengajuan ? new Date (row.tanggal_pengajuan).getFullYear().toString(): "",
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      JabatanFungsional: row.jabatan || "",
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


// ===== Submit Handler =====
app.post("/api/submit/:formType", upload.single("pdfFile"), async (req, res) => {
  const { formType } = req.params;
  const formData = req.body || {};
  const uploadedFile = req.file;
  const config = formTableMap[formType];

  if (!config) return res.status(400).json({ error: "Form type tidak valid" });

  try {
    // Parse anggota
    if (formData.anggota && typeof formData.anggota === "string") {
      try {
        formData.anggota = JSON.parse(formData.anggota);
      } catch {
        formData.anggota = [];
      }
    }
    if (!Array.isArray(formData.anggota)) formData.anggota = [];

    // Map untuk docx
    const mappedData = config.mapFn(formData, formData.anggota);
    const docxPath = await generateDocx(config.template, mappedData);
    const docxBuffer = fs.readFileSync(docxPath);

    const filename = `${formData.nama_ketua || "Unknown"}_${Date.now()}.docx`;
    const { error: uploadError } = await supabase.storage
      .from("surat-tugas-files")
      .upload(filename, docxBuffer, {
        contentType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    if (uploadError) throw uploadError;
    const fileUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/surat-tugas-files/${filename}`;

    // Upload PDF jika ada
    let pdfUrl: string | null = null;
    if (uploadedFile) {
      const pdfName = `${formData.nama_ketua}_${Date.now()}_${uploadedFile.originalname}`;
      const { error: pdfError } = await supabase.storage
        .from("uploads")
        .upload(pdfName, uploadedFile.buffer, {
          contentType: uploadedFile.mimetype,
        });
      if (!pdfError) {
        pdfUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/uploads/${pdfName}`;
      }
    }

    // Insert ke tabel utama
    const safeFormData: Record<string, any> = {};
    Object.keys(formData).forEach((k) => {
      if (k !== "anggota") safeFormData[k] = formData[k];
    });
    if (fileUrl) safeFormData["file_url"] = fileUrl;
    if (pdfUrl) safeFormData["pdf_url"] = pdfUrl;
    safeFormData["status"] = formData.status || "belum_dibaca";

    const cols = Object.keys(safeFormData);
    const vals = Object.values(safeFormData);
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
    const insertQuery = `INSERT INTO ${config.table} (${cols.join(
      ","
    )}) VALUES (${placeholders}) RETURNING id`;
    const result = await pool.query(insertQuery, vals);
    const suratId = result.rows[0].id;

    // Insert anggota ke anggota_surat
    if (formData.anggota.length > 0) {
      for (const anggota of formData.anggota) {
        await pool.query(
          `INSERT INTO anggota_surat (surat_type, surat_id, nama, nidn, idsintaanggota)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            config.table,
            suratId,
            anggota.name || "",
            anggota.nidn || "",
            anggota.idsintaAnggota || "",
          ]
        );
      }
    }

    // --- KIRIM EMAIL ---
    const namaKetua = formData.nama_ketua || "Unknown";

    // Email untuk user
    await sendEmail(
      formData.email,
      "Konfirmasi Pengisian Form LPPM",
      null,
      "Terima kasih sudah mengisi form, untuk surat yang telah di isi dapat menghubungi Admin LPPM - 085117513399 A.n Novi."
    );

    // Email untuk admin (dengan lampiran .docx hasil mapping)
    await sendEmail(
      "surattugaslppmsmd@gmail.com",
      `Surat Tugas Baru dari ${namaKetua}`,
      { filename, content: docxBuffer },
      `Ini Hasil Submit form dari ${namaKetua} dengan Email ${formData.email}. Silahkan dicek.`
    );

    // Query ulang anggota yang baru disimpan
    const anggotaResult = await pool.query(
      `SELECT * FROM anggota_surat WHERE surat_type = $1 AND surat_id = $2`,
      [config.table, suratId]
    );

    res.json({
      success: true,
      record: result.rows[0], // data surat utama
      anggota: anggotaResult.rows, // list anggota yang tersimpan
      fileUrl,
      pdfUrl,
    });
  } catch (err) {
    console.error("Submit error:", err);
    res.status(500).json({ error: "Gagal submit form" });
  }
});

// === Helper: Ambil daftar tabel public dari PostgreSQL ===
async function getPublicTables(): Promise<string[]> {
  const result = await pool.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `);
  return result.rows.map((r) => r.tablename);
}

// === Admin: Update status (read/approve/reject) ===
app.post("/api/admin/:table/:id/status", authMiddleware, async (req, res) => {
  const { table, id } = req.params;
  const { status } = req.body;

  try {
    // validasi nama tabel berdasarkan daftar tabel public
    const validTables = await getPublicTables();
    if (!validTables.includes(table)) {
      return res.status(400).json({ error: "Invalid table name" });
    }

    const result = await pool.query(
      `UPDATE ${table} SET status = $1 WHERE id = $2 RETURNING *`,
      [status, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Row not found" });
    }

    res.json(result.rows[0]);
  } catch (err: any) {
    console.error("Update status error:", err);
    res.status(500).json({ error: err.message });
  }
});

// === Admin: Get all tables (untuk dashboard/sidebar) ===
app.get("/api/admin/all-tables", authMiddleware, async (req: Request, res: Response) => {
  try {
    const tables = await getPublicTables(); // ambil tabel langsung dari DB
    res.json({ tables });
  } catch (err: any) {
    console.error("Fetch tables error:", err);
    res.status(500).json({ error: err.message });
  }
});

// === Admin: Get all rows per table ===
app.get("/api/admin/:table", authMiddleware, async (req, res) => {
  const { table } = req.params;

  try {
    const validTables = await getPublicTables();
    if (!validTables.includes(table)) {
      return res.status(400).json({ error: "Invalid table name" });
    }

    const result = await pool.query(`SELECT * FROM ${table} ORDER BY id DESC`);
    res.json(result.rows);
  } catch (err: any) {
    console.error("Fetch rows error:", err);
    res.status(500).json({ error: err.message });
  }
});



const port = process.env.PORT || 5000;

if (process.env.NODE_ENV !== "production") {
  app.listen(port, () => console.log(`Server running on port ${port}`));
}


export default app;
