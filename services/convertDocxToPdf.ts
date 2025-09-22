// services/convertDocxToPdf.ts
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Fungsi untuk memastikan folder ada
async function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export async function convertDocxToPdf(docxPath: string): Promise<string> {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`DOCX tidak ditemukan: ${docxPath}`);
  }

  // Tentukan folder output
  const outputDir = path.join(__dirname, "..", "output");
  await ensureDir(outputDir);

  // Ambil nama dasar DOCX tanpa ekstensi
  const baseName = path.basename(docxPath, path.extname(docxPath));
  // Tentukan path PDF di folder output
  const pdfPath = path.join(outputDir, `${baseName}.pdf`);

  // 1) Convert DOCX -> HTML menggunakan Mammoth
  const { value: htmlBody } = await mammoth.convertToHtml({ path: docxPath });

  // 2) Wrap HTML dengan style sederhana
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <style>
          body { font-family: "Times New Roman", serif; margin: 72px; color: #000; }
          table { border-collapse: collapse; width: 100%; }
          table, th, td { border: 1px solid #333; padding: 6px; }
          img { max-width: 100%; height: auto; }
          pre { white-space: pre-wrap; word-break: break-word; }
        </style>
      </head>
      <body>
        ${htmlBody}
      </body>
    </html>
  `;

  // 3) Launch Puppeteer dan convert HTML -> PDF
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'], // aman untuk server Linux
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });

    // Simpan PDF ke folder output
    fs.writeFileSync(pdfPath, pdfBuffer);
    return pdfPath;
  } finally {
    await browser.close();
  }
}
