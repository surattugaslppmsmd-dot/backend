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

// ---------- Setup Express ----------
const app = express();
const port = process.env.PORT || 5000;

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


// Helper untuk ambil semua data dari tabel
const getAllFromTable = async (tableName: string) => {
  const result = await pool.query(`SELECT * FROM ${tableName} ORDER BY id DESC`);
  return result.rows;
};

// ----------------- ENDPOINTS -----------------

// Halaman Pengesahan
app.get("/api/halaman-pengesahan", async (req: Request, res: Response) => {
  try {
    const data = await getAllFromTable("halaman_pengesahan");
    res.json(data);
  } catch (err) {
    console.error("Error fetching Halaman Pengesahan:", err);
    res.status(500).json({ message: "Gagal mengambil data Halaman Pengesahan" });
  }
});

// Surat Tugas Buku
app.get("/api/surat-tugas-buku", async (req: Request, res: Response) => {
  try {
    const data = await getAllFromTable("surat_tugas_buku");
    res.json(data);
  } catch (err) {
    console.error("Error fetching Surat Tugas Buku:", err);
    res.status(500).json({ message: "Gagal mengambil data Surat Tugas Buku" });
  }
});

// Surat Tugas HKI
app.get("/api/surat-tugas-hki", async (req: Request, res: Response) => {
  try {
    const data = await getAllFromTable("surat_tugas_hki");
    res.json(data);
  } catch (err) {
    console.error("Error fetching Surat Tugas HKI:", err);
    res.status(500).json({ message: "Gagal mengambil data Surat Tugas HKI" });
  }
});

// Surat Tugas Penelitian
app.get("/api/surat-tugas-penelitian", async (req: Request, res: Response) => {
  try {
    const data = await getAllFromTable("surat_tugas_penelitian");
    res.json(data);
  } catch (err) {
    console.error("Error fetching Surat Tugas Penelitian:", err);
    res.status(500).json({ message: "Gagal mengambil data Surat Tugas Penelitian" });
  }
});

// Surat Tugas PKM
app.get("/api/surat-tugas-pkm", async (req: Request, res: Response) => {
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
      Email: row.email || "",
      NamaKetua: row.nama_ketua || "",
      NomorHP: row.nomor_hp || "",
      NIDN: row.nidn || "",
      IDSinta: row.id_sinta || row.idSinta || "",
      JabatanFungsional: row.jabatan || "",
      Fakultas: row.fakultas || "",
      Prodi: row.prodi || "",
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
      Email: row.email || "",
      NamaKetua: row.nama_ketua || "",
      NIDN: row.nidn || "",
      IDSinta: row.id_sinta || row.idSinta || "",
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
      Email: row.email || "",
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
      Email: row.email || "",
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
    if (!config) {
      return res.status(400).json({ success: false, message: "FormType tidak valid" });
    }

    let { anggota, ...formData } = req.body as any;

    // Parse anggota jika dikirim string JSON
    if (typeof anggota === "string") {
      try {
        anggota = anggota ? JSON.parse(anggota) : [];
      } catch {
        anggota = [];
      }
    }

    const file_url = req.file ? `/uploads/${req.file.filename}` : null;

    // Validasi field wajib
    const emptyFields = validateFields(formData, config.requiredFields);
    if (emptyFields.length) {
      return res.status(400).json({
        success: false,
        message: `Field belum terisi: ${emptyFields.join(", ")}`,
      });
    }

    try {
      // ---------- Simpan ke DB ----------
      const safeFormData: Record<string, any> = {};
      for (const k of Object.keys(formData)) {
        const v = formData[k];
        if (v !== undefined) safeFormData[k] = v;
      }
      if (file_url) safeFormData["file_url"] = file_url;

      const columns = Object.keys(safeFormData);
      const values = Object.values(safeFormData);
      const placeholders = columns.map((_, i) => `$${i + 1}`);
      const insertQuery = `INSERT INTO ${config.table} (${columns.join(", ")})
                           VALUES (${placeholders.join(", ")}) RETURNING *`;
      const result = await pool.query(insertQuery, values);
      const record = result.rows[0];

      // ---------- Simpan anggota ----------
      let anggotaSaved: { name: string; nidn: string }[] = [];
      if (Array.isArray(anggota) && anggota.length > 0) {
        for (const a of anggota) {
          if (a?.name && a?.nidn) {
            await pool.query(
              `INSERT INTO anggota_surat (surat_type, surat_id, nama, nidn)
               VALUES ($1,$2,$3,$4)`,
              [config.table, record.id, a.name, a.nidn]
            );
          }
        }
        const anggotaRows = await pool.query(
          `SELECT nama, nidn FROM anggota_surat WHERE surat_type=$1 AND surat_id=$2 ORDER BY id ASC`,
          [config.table, record.id]
        );
        anggotaSaved = anggotaRows.rows.map((r) => ({ name: r.nama, nidn: r.nidn }));
      }

      // ---------- Generate DOCX ----------
      const mappedData = config.mapFn(record, anggotaSaved);
      const docxPath = await generateDocx(config.template, mappedData);

      // ---------- Convert to PDF via CloudConvert ----------
      const pdfPath = await convertDocxToPdf(docxPath);

      // Hapus DOCX setelah konversi
      try {
        fs.unlinkSync(docxPath);
      } catch (err) {
        console.warn("Gagal hapus DOCX:", err);
      }

      // ---------- Kirim Email ----------
      const penerima = formData.email || record.email || "";
      const emailBody = `Kepada ${formData.nama_ketua || "Bapak/Ibu"},
Terima kasih telah mengisi form. Silakan lihat lampiran PDF.
Untuk nomor surat, hubungi:
- Ritria Novidyanti, S.Pd (+62 852-4763-6399)`;

      await sendEmail(penerima, config.emailSubject, pdfPath, emailBody);

      res.json({
        success: true,
        message: "Form berhasil disubmit, PDF dibuat & email terkirim.",
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

// ---------- Start Server ----------
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});