import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Gunakan folder /tmp jika di Vercel
const isVercel = process.env.VERCEL === "1";
const outputDir = isVercel
  ? "/tmp/output"
  : path.join(__dirname, "..", "output");

// Tipe data anggota
interface Anggota {
  name?: string;
  nidn?: string;
  nomor?: number | string;
}

interface DocData {
  judul?: string;
  anggota?: Anggota[];
  [key: string]: any;
}

export async function generateDocx(
  templateFile: string,
  data: DocData
): Promise<string> {
  const templatePath = path.join(__dirname, "..", "templates", templateFile);

  if (!fs.existsSync(templatePath)) {
    throw new Error(`Template file tidak ditemukan: ${templatePath}`);
  }

  const content = fs.readFileSync(templatePath, "binary");
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "<<", end: ">>" },
  });

const anggotaList: Anggota[] = Array.isArray(data.anggota) ? data.anggota : [];

data.anggota = anggotaList.map((a, i) => ({
  name: a.name || "",
  nidn: a.nidn || "",
  nomor: anggotaList.length > 1 ? i + 1 : "",
}));


  try {
    doc.render(data);
  } catch (err) {
    console.error("Template rendering error:", err);
    throw err;
  }

  const buf = doc.getZip().generate({ type: "nodebuffer" });

  // Pastikan folder output ada
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const safeTitle = data.judul
    ? data.judul.replace(/[^a-z0-9_\-]/gi, "_")
    : "output";

  const docxPath = path.join(outputDir, `${safeTitle}.docx`);
  fs.writeFileSync(docxPath, buf);

  return docxPath;
}
