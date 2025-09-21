import fs from "fs";
import path from "path";
import PizZip from "pizzip";
import Docxtemplater from "docxtemplater";
import { fileURLToPath } from "url";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export async function generateDocx(templateFile, data) {
    const templatePath = path.join(__dirname, "..", "templates", templateFile);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Template file tidak ditemukan: ${templatePath}`);
    }
    // Load template DOCX
    const content = fs.readFileSync(templatePath, "binary");
    const zip = new PizZip(content);
    const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: "<<", end: ">>" },
    });
    // Jika ada anggota array
    if (data.anggota && Array.isArray(data.anggota)) {
        data.anggota = data.anggota.map(a => ({ name: a.name, nidn: a.nidn }));
    }
    try {
        doc.render(data);
    }
    catch (err) {
        console.error("Template rendering error:", err);
        throw err;
    }
    const buf = doc.getZip().generate({ type: "nodebuffer" });
    // Simpan file DOCX
    const outputDir = path.join(__dirname, "..", "output");
    if (!fs.existsSync(outputDir))
        fs.mkdirSync(outputDir, { recursive: true });
    const docxPath = path.join(outputDir, `${Date.now()}.docx`);
    fs.writeFileSync(docxPath, buf);
    return docxPath;
}
