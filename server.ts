import dotenv from "dotenv";
import path from "path";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}
import { createClient } from "@supabase/supabase-js";

import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import multer from "multer";
import { Pool } from "pg";
import { fileURLToPath } from "url";
import fs from "fs";
import { generateDocx } from "./services/generateDocument.js";
import { sendEmail } from "./services/sendEmail.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

const app = express();
const handler = (req: any, res: any) => app(req, res);
const port = process.env.PORT || 5000;
const isVercel = process.env.VERCEL === "1";
const __filename = fileURLToPath(import.meta.url);
app.get('/api', (req, res) => res.send('API works!'));
const __dirname = path.dirname(__filename);
const uploadDir = isVercel ? "/tmp/uploads" : path.join(__dirname, "uploads");
const outputDir = isVercel ? "/tmp/output" : path.join(__dirname, "output");

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Validasi variabel environment
if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Supabase URL atau Service Role Key belum diatur. Periksa environment variables.");
}

// --- Init Supabase Client ---
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// --- Pastikan folder lokal ada (kalau dipakai sementara sebelum upload) ---
for (const dir of [uploadDir, outputDir]) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// --- Upload file DOCX ke Storage ---
async function uploadFileToSupabase(filePath: string, storagePath: string) {
  const fileBuffer = fs.readFileSync(filePath);

  const { data, error } = await supabase.storage
    .from("uploads") // bucket name
    .upload(storagePath, fileBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true, // kalau sudah ada, replace
    });

  if (error) throw error;

  // Ambil public URL untuk kirim lewat email
  const { data: publicUrlData } = supabase.storage
    .from("uploads")
    .getPublicUrl(storagePath);

  return publicUrlData.publicUrl;
}


// ---------- Ensure Directories ----------
function ensureDirSync(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
ensureDirSync(uploadDir);
ensureDirSync(outputDir);

app.use(
  cors({
    origin: "https://surattugaslppm.com",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// ---------- Multer ----------

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// ---------- Database ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------- JWT Helper ----------
interface AuthRequest extends Request {
  user?: string | jwt.JwtPayload;
}
const JWT_SECRET = process.env.JWT_SECRET || "secret_key";

function generateToken(payload: object, expiresIn: number = 3600) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn });
}

function verifyJWT(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: "Token tidak ditemukan" });
  const token = authHeader.split(" ")[1];
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ message: "Token tidak valid/kadaluwarsa" });
    req.user = decoded;
    next();
  });
}
// ---------------- LOGIN ADMIN ----------------
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


// ---------- Upload PDF ke Supabase ----------
async function uploadPdfToSupabase(filePath: string): Promise<string> {
  const fileName = `${Date.now()}_${filePath.split("/").pop()}`;
  const fileBuffer = fs.readFileSync(filePath);

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("uploads")
    .upload(fileName, fileBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(fileName);
  return urlData.publicUrl;
}

(async () => {
  try {
    const publicUrl = await uploadFileToSupabase(
      `${outputDir}/namafile.docx`, // path lokal
      `dokumen/namafile.docx` // path di bucket
    );
    console.log("Public URL:", publicUrl);
  } catch (err) {
    console.error("Upload gagal:", err);
  }
})();

// Helper untuk ambil semua data dari tabel
const getAllFromTable = async (tableName: string) => {
  const result = await pool.query(`SELECT * FROM ${tableName} ORDER BY id DESC`);
  return result.rows;
};
// Halaman Pengesahan
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

// ---------- Utility ----------
function validateFields(data: any, requiredFields: string[]): string[] {
  return requiredFields.filter(
    (f) => data[f] === undefined || data[f] === null || data[f] === ""
  );
}

// ---------------- FORM CONFIG
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
      Puslitbang: row.puslitbang || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
      JabatanFungsional: row.jabatan || "",
      Judul: row.judul || "",
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID",{day: "numeric", month:"long", year:"numeric"}) : "",
      NomorHP: row.nomor_hp || row.nomorHp || "",
      NamaInstitusi: row.nama_institusi || row.namaInstitusi || "",
      AlamatInstitusi: row.alamat || row.alamat_institusi || "",
      PenanggungJawab: row.penanggung_jawab || row.penanggungJawab || "",
      TahunPelaksana: row.tahun_pelaksana ? new Date(row.tahun_pelaksana).toLocaleDateString("id-ID",{day: "numeric", month:"long", year:"numeric"}) : "",
      BiayaTahun: row.biaya_tahun || row.biayaTahun ? new Intl.NumberFormat("id-ID",{ style:"currency", currency:"IDR", maximumFractionDigits: 0 }).format(Number(row.biaya_tahun || row.biayaTahun)) : "",
      BiayaKeseluruhan: row.biaya_keseluruhan || row.biayaKeseluruhan ? new Intl.NumberFormat("id-ID",{ style:"currency", currency:"IDR", maximumFractionDigits: 0 }).format(Number(row.biaya_keseluruhan || row.biayaKeseluruhan)) :"",
      NamaDekan: row.nama_dekan || row.namaDekan || "",
      NIPDekan: row.nip_dekan || row.nipDekan || "",
      NamaPeneliti: row.nama_peneliti || row.namaPeneliti || "",
      NIPKetua: row.nip_ketua || row.nipKetua || "",
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
      JenisBuku: row.jenis_buku || row.jenisBuku || "",
      PenerbitBuku: row.penerbit_buku || row.penerbitBuku || "",
      Judul: row.judul || row.judul_buku || "",
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID",{day: "numeric", month:"long", year:"numeric"}) : "",
      LinkArtikel: row.link_artikel || row.linkArtikel || "",
      anggota: anggota || [],
    }),
    template: "Surat Tugas Buku.docx",
    emailSubject: "Surat Tugas Buku",
    requiredFields: ["email", "nama_ketua", "nidn", "fakultas", "prodi", "judul", "jenis_buku", "penerbit_buku", "tanggal"],
  },

  SuratTugasHKI: {
    table: "surat_tugas_hki",
    mapFn: (row, anggota) => ({
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      JabatanFungsional: row.jabatan || "",
      JenisHakCipta: row.jenis_hki || row.jenis_hak_cipta || "",
      No_Tanggal_Permohonan: row.no_tanggal_permohonan ? new Date(row.no_tanggal_permohonan).toLocaleDateString("id-ID",{day: "numeric", month:"long", year:"numeric"}) : "",
      JudulCiptaan: row.judul_ciptaan || row.judulCiptaan || "",
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID",{day: "numeric", month:"long", year:"numeric"}) : "",
      anggota: anggota || [],
    }),
    template: "Surat Tugas HKI.docx",
    emailSubject: "Surat Tugas HKI",
    requiredFields: ["email", "nama_ketua", "nidn", "judul_ciptaan", "jenis_hki"],
  },

  SuratTugasPenelitian: {
    table: "surat_tugas_penelitian",
    mapFn: (row, anggota) => ({
      TahunPengajuan: row.tanggal_pengajuan ? new Date(row.tanggal).toLocaleDateString("id-ID") : "",
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      JabatanFungsional: row.jabatan || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
      Judul: row.judul || "",
      Tanggal: row.tanggal ? new Date(row.no_tanggal_permohonan).toLocaleDateString("id-ID",{day: "numeric", month:"long", year:"numeric"}) : "",
      anggota: anggota || [],
    }),
    template: "Surat Tugas Penelitian.docx",
    emailSubject: "Surat Tugas Penelitian",
    requiredFields: ["email", "nama_ketua", "nidn", "judul", "tanggal"],
  },

  SuratTugasPKM: {
    table: "surat_tugas_pkm",
    mapFn: (row, anggota) => ({
      TahunPengajuan: row.tanggal_pengajuan ? new Date(row.tanggal_pengajuan).getFullYear().toString() : "",
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      JabatanFungsional: row.jabatan || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
      Judul: row.judul || "",
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID",{day: "numeric", month:"long", year:"numeric"}) : "",
      anggota: anggota || [],
    }),
    template: "Surat Tugas PKM.docx",
    emailSubject: "Surat Tugas PKM",
    requiredFields: ["email", "nama_ketua", "nidn", "judul", "tanggal"],
  },
}; 

// ---------- Endpoint Submit Form ----------
app.post(
  "/api/forms/:formType",
  upload.single("pdfFile"),
  async (req: Request, res: Response) => {
    const { formType } = req.params;
    const config = formTableMap[formType];
    if (!config)
      return res
        .status(400)
        .json({ success: false, message: "FormType tidak valid" });

    let { anggota, ...formData } = req.body as any;

    if (typeof anggota === "string") {
      try {
        anggota = anggota ? JSON.parse(anggota) : [];
      } catch {
        anggota = [];
      }
    }

    try {
      // ---------- Simpan data ke DB ----------
      const safeFormData: Record<string, any> = {};
      for (const k of Object.keys(formData)) {
        const v = formData[k];
        if (v !== undefined) safeFormData[k] = v;
      }

      const columns = Object.keys(safeFormData);
      const values = Object.values(safeFormData);
      const placeholders = columns.map((_, i) => `$${i + 1}`);
      const insertQuery = `INSERT INTO ${config.table} (${columns.join(
        ", "
      )}) VALUES (${placeholders.join(", ")}) RETURNING *`;
      const result = await pool.query(insertQuery, values);
      const record = result.rows[0];

      // ---------- Simpan anggota ----------
      let anggotaSaved: { name: string; nidn: string; idsintaAnggota: string }[] = [];
      if (Array.isArray(anggota) && anggota.length > 0) {
        for (const a of anggota) {
          if (a?.name && a?.nidn && a?.idsintaAnggota) {
            await pool.query(
              `INSERT INTO anggota_surat (surat_type, surat_id, nama, nidn, idsinta_anggota)
               VALUES ($1,$2,$3,$4,$5)`,
              [config.table, record.id, a.name, a.nidn, a.idsintaAnggota]
            );
          }
        }
        const anggotaRows = await pool.query(
          `SELECT nama, nidn, idsinta_anggota FROM anggota_surat WHERE surat_type=$1 AND surat_id=$2 ORDER BY id ASC`,
          [config.table, record.id]
        );
        anggotaSaved = anggotaRows.rows.map((r) => ({
          name: r.nama,
          nidn: r.nidn,
          idsintaAnggota: r.idsinta_anggota,
        }));
      }

      // ---------- Generate DOCX ----------
const mappedData = config.mapFn(record, anggotaSaved);
const docxPath = await generateDocx(config.template, mappedData);

// ---------- Upload DOCX ke Supabase ----------
let fileUrl: string | null = null;
if (docxPath) {
  const fileBuffer = fs.readFileSync(docxPath);
  const fileName = path.basename(docxPath);

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("uploads")
    .upload(fileName, fileBuffer, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(fileName);
  fileUrl = urlData.publicUrl;
}

      // ---------- Update file_url di DB ----------
      if (fileUrl) {
        await pool.query(`UPDATE ${config.table} SET file_url=$1 WHERE id=$2`, [
          fileUrl,
          record.id,
        ]);
      }

      // ---------- Kirim Email ----------
      const penerima = formData.email || record.email || "";
      const emailBody = `Kepada ${formData.nama_ketua || "Bapak/Ibu"},
Terima kasih telah mengisi form. Silakan lihat lampiran PDF.
Untuk nomor surat, hubungi:
- Ritria Novidyanti, S.Pd (+62 852-4763-6399)`;

      await sendEmail(penerima, config.emailSubject, docxPath, emailBody);

      // ---------- Response ke frontend ----------
      res.json({
        success: true,
        message: "Form berhasil disubmit, PDF dibuat & email terkirim.",
        file_url: fileUrl,
        id: record.id,
      });
    } catch (err) {
      console.error("Error submit form:", err);
      res.status(500).json({
        success: false,
        message: "Terjadi kesalahan server (DB/CloudConvert/Email)",
      });
    }
  }
);

export default handler;