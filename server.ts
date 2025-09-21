import dotenv from "dotenv";
import path from "path";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import multer from "multer";
import { Pool } from "pg";
import { fileURLToPath } from "url";
import fs from "fs";
import { generateDocx } from "./services/generateDocument.js";
import { sendEmail } from "./services/sendEmail.js";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- Async Import CloudConvert ----------
let convertDocxToPdf: any;
(async () => {
  ({ convertDocxToPdf } = await import("./services/cloudconvert.js"));
})();

// ---------- Ensure Directories ----------
function ensureDirSync(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
ensureDirSync(path.join(__dirname, "uploads"));
ensureDirSync(path.join(__dirname, "output"));

// ---------- Middleware ----------
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// ---------- Multer ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, "uploads")),
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
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

// ---------- LOGIN ADMIN ----------
app.post("/api/admin-login", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ message: "Username/Password kosong" });

    const result = await pool.query("SELECT * FROM admin WHERE username = $1", [username]);
    if (result.rows.length === 0) return res.status(401).json({ message: "Username tidak ditemukan" });

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ message: "Password salah" });

    const token = generateToken({ username: user.username });
    res.json({ token, expiresIn: 3600 });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Login gagal" });
  }
});

// ---------- Helper Functions ----------
const getAllFromTable = async (tableName: string) => {
  const result = await pool.query(`SELECT * FROM ${tableName} ORDER BY id DESC`);
  return result.rows;
};

function validateFields(data: any, requiredFields: string[]): string[] {
  return requiredFields.filter((f) => data[f] === undefined || data[f] === null || data[f] === "");
}

// ---------- GET ENDPOINTS ----------
app.get("/api/halaman-pengesahan", async (req: Request, res: Response) => {
  try {
    const data = await getAllFromTable("halaman_pengesahan");
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal mengambil data Halaman Pengesahan" });
  }
});

app.get("/api/surat-tugas-buku", async (req: Request, res: Response) => {
  try {
    const data = await getAllFromTable("surat_tugas_buku");
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal mengambil data Surat Tugas Buku" });
  }
});

app.get("/api/surat-tugas-hki", async (req: Request, res: Response) => {
  try {
    const data = await getAllFromTable("surat_tugas_hki");
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal mengambil data Surat Tugas HKI" });
  }
});

app.get("/api/surat-tugas-penelitian", async (req: Request, res: Response) => {
  try {
    const data = await getAllFromTable("surat_tugas_penelitian");
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal mengambil data Surat Tugas Penelitian" });
  }
});

app.get("/api/surat-tugas-pkm", async (req: Request, res: Response) => {
  try {
    const data = await getAllFromTable("surat_tugas_pkm");
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Gagal mengambil data Surat Tugas PKM" });
  }
});

// ---------- FORM CONFIG DENGAN MAPFN ----------
const formTableMap: Record<string, any> = {
  HalamanPengesahan: {
    table: "halaman_pengesahan",
    template: "Halaman Pengesahan.docx",
    emailSubject: "Halaman Pengesahan",
    requiredFields: ["email", "nama_ketua", "nidn", "fakultas", "prodi", "judul", "tanggal"],
    mapFn: (row: any, anggota: any[]) => ({
      Email: row.email || "",
      NamaKetua: row.nama_ketua || row.nama || "",
      NIDN: row.nidn || "",
      Puslitbang: row.puslitbang || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
      JabatanFungsional: row.jabatan || "",
      Judul: row.judul || "",
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "",
      NomorHP: row.nomor_hp || row.nomorHp || "",
      NamaInstitusi: row.nama_institusi || row.namaInstitusi || "",
      AlamatInstitusi: row.alamat || row.alamat_institusi || "",
      PenanggungJawab: row.penanggung_jawab || row.penanggungJawab || "",
      TahunPelaksana: row.tahun_pelaksana ? new Date(row.tahun_pelaksana).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : "",
      BiayaTahun: row.biaya_tahun ? new Intl.NumberFormat("id-ID",{style:"currency", currency:"IDR", maximumFractionDigits:0}).format(Number(row.biaya_tahun)) : "",
      BiayaKeseluruhan: row.biaya_keseluruhan ? new Intl.NumberFormat("id-ID",{style:"currency", currency:"IDR", maximumFractionDigits:0}).format(Number(row.biaya_keseluruhan)) : "",
      NamaDekan: row.nama_dekan || "",
      NIPDekan: row.nip_dekan || "",
      NamaPeneliti: row.nama_peneliti || "",
      NIPKetua: row.nip_ketua || "",
      anggota: anggota || [],
    })
  },
  SuratTugasBuku: {
    table: "surat_tugas_buku",
    template: "Surat Tugas Buku.docx",
    emailSubject: "Surat Tugas Buku",
    requiredFields: ["email", "nama_ketua", "nidn", "fakultas", "prodi", "judul", "jenis_buku", "penerbit_buku", "tanggal"],
    mapFn: (row: any, anggota: any[]) => ({
      Email: row.email || "",
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      NomorHP: row.nomor_hp || "",
      IDSinta: row.id_sinta || "",
      JabatanFungsional: row.jabatan || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
      JenisBuku: row.jenis_buku || "",
      PenerbitBuku: row.penerbit_buku || "",
      Judul: row.judul || row.judul_buku || "",
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID",{day:"numeric",month:"long",year:"numeric"}) : "",
      LinkArtikel: row.link_artikel || "",
      anggota: anggota || [],
    })
  },
  SuratTugasHKI: {
    table: "surat_tugas_hki",
    template: "Surat Tugas HKI.docx",
    emailSubject: "Surat Tugas HKI",
    requiredFields: ["email", "nama_ketua", "nidn", "judul_ciptaan", "jenis_hki"],
    mapFn: (row: any, anggota: any[]) => ({
      Email: row.email || "",
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      IDSinta: row.id_sinta || "",
      JabatanFungsional: row.jabatan || "",
      JenisHakCipta: row.jenis_hki || "",
      No_Tanggal_Permohonan: row.no_tanggal_permohonan ? new Date(row.no_tanggal_permohonan).toLocaleDateString("id-ID",{day:"numeric",month:"long",year:"numeric"}) : "",
      JudulCiptaan: row.judul_ciptaan || "",
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID",{day:"numeric",month:"long",year:"numeric"}) : "",
      anggota: anggota || [],
    })
  },
  SuratTugasPenelitian: {
    table: "surat_tugas_penelitian",
    template: "Surat Tugas Penelitian.docx",
    emailSubject: "Surat Tugas Penelitian",
    requiredFields: ["email", "nama_ketua", "nidn", "judul", "tanggal"],
    mapFn: (row: any, anggota: any[]) => ({
      Email: row.email || "",
      TahunPengajuan: row.tanggal_pengajuan ? new Date(row.tanggal_pengajuan).toLocaleDateString("id-ID") : "",
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      JabatanFungsional: row.jabatan || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
      Judul: row.judul || "",
      Tanggal: row.tanggal ? new Date(row.no_tanggal_permohonan).toLocaleDateString("id-ID",{day:"numeric",month:"long",year:"numeric"}) : "",
      anggota: anggota || [],
    })
  },
  SuratTugasPKM: {
    table: "surat_tugas_pkm",
    template: "Surat Tugas PKM.docx",
    emailSubject: "Surat Tugas PKM",
    requiredFields: ["email", "nama_ketua", "nidn", "judul", "tanggal"],
    mapFn: (row: any, anggota: any[]) => ({
      Email: row.email || "",
      TahunPengajuan: row.tanggal_pengajuan ? new Date(row.tanggal_pengajuan).getFullYear().toString() : "",
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      JabatanFungsional: row.jabatan || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
      Judul: row.judul || "",
      Tanggal: row.tanggal ? new Date(row.tanggal).toLocaleDateString("id-ID",{day:"numeric",month:"long",year:"numeric"}) : "",
      anggota: anggota || [],
    })
  }
};

// ---------- POST FORM ENDPOINT ----------
app.post("/api/forms/:formType", upload.single("pdfFile"), async (req: Request, res: Response) => {
  const { formType } = req.params;
  const config = formTableMap[formType];
  if (!config) return res.status(400).json({ success: false, message: "FormType tidak valid" });

  let { anggota, ...formData } = req.body as any;
  if (typeof anggota === "string") {
    try { anggota = anggota ? JSON.parse(anggota) : []; } catch { anggota = []; }
  }
  const file_url = req.file ? `/uploads/${req.file.filename}` : null;

  const emptyFields = validateFields(formData, config.requiredFields);
  if (emptyFields.length) return res.status(400).json({ success: false, message: `Field belum terisi: ${emptyFields.join(", ")}` });

  try {
    const safeFormData: Record<string, any> = {};
    for (const k of Object.keys(formData)) if (formData[k] !== undefined) safeFormData[k] = formData[k];
    if (file_url) safeFormData["file_url"] = file_url;

    const columns = Object.keys(safeFormData);
    const values = Object.values(safeFormData);
    const placeholders = columns.map((_, i) => `$${i + 1}`);
    const insertQuery = `INSERT INTO ${config.table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`;
    const result = await pool.query(insertQuery, values);
    const record = result.rows[0];

    // Save anggota
    let anggotaSaved: any[] = [];
    if (Array.isArray(anggota) && anggota.length > 0) {
      for (const a of anggota) {
        if (a?.name && a?.nidn) {
          await pool.query(`INSERT INTO anggota_surat (surat_type, surat_id, nama, nidn) VALUES ($1,$2,$3,$4)`, [config.table, record.id, a.name, a.nidn]);
        }
      }
      const anggotaRows = await pool.query(`SELECT nama, nidn FROM anggota_surat WHERE surat_type=$1 AND surat_id=$2 ORDER BY id ASC`, [config.table, record.id]);
      anggotaSaved = anggotaRows.rows.map((r) => ({ name: r.nama, nidn: r.nidn }));
    }

    // Generate DOCX & PDF
    const mappedData = config.mapFn(record, anggotaSaved);
    const docxPath = await generateDocx(config.template, mappedData);
    const pdfPath = await convertDocxToPdf(docxPath);
    try { fs.unlinkSync(docxPath); } catch {}

    // Send Email
    const penerima = formData.email || record.email || "";
    const emailBody = `Kepada ${formData.nama_ketua || "Bapak/Ibu"}, silakan lihat lampiran PDF.`;
    await sendEmail(penerima, config.emailSubject, pdfPath, emailBody);

    res.json({ success: true, message: "Form berhasil disubmit, PDF dibuat & email terkirim.", id: record.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Terjadi kesalahan server (DB/CloudConvert/Email)" });
  }
});

// ---------- Export app for Vercel ----------
export default app;
