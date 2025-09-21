// services/convertDocxToPdf.ts
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import puppeteer from "puppeteer";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function ensureDir(dirPath: string) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

export async function convertDocxToPdf(docxPath: string): Promise<string> {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`DOCX tidak ditemukan: ${docxPath}`);
  }

  const outputDir = path.join(__dirname, "..", "output");
  await ensureDir(outputDir);

  // 1) Convert docx -> HTML (mammoth)
  const { value: htmlBody } = await mammoth.convertToHtml({ path: docxPath }, {
    // optional: style map or transform
  });

  // 2) Wrap HTML with basic styles to make PDF look decent
  const html = `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <style>
          /* minimal printing styles */
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

  // 3) Launch puppeteer and convert to PDF
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    // on Windows, puppeteer will download a chromium automatically.
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    // You can tune PDF options (format, margins)
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    });

    const pdfPath = docxPath.replace(/\.docx$/i, ".pdf");
    fs.writeFileSync(pdfPath, pdfBuffer);
    return pdfPath;
  } finally {
    await browser.close();
  }
}
