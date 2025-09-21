import CloudConvert from "cloudconvert";
import fs from "fs";

const cloudConvert = new CloudConvert(process.env.CLOUDCONVERT_API_KEY as string);

export async function convertDocxToPdf(docxPath: string): Promise<string> {
  const outputPath = docxPath.replace(/\.docx$/i, ".pdf");

  const job = await cloudConvert.jobs.create({
    tasks: {
      upload: { operation: "import/upload" },
      convert: {
        operation: "convert",
        input: "upload",
        input_format: "docx",
        output_format: "pdf"
      },
      export: { operation: "export/url", input: "convert" }
    }
  });

  const uploadTask = job.tasks.find(t => t.name === "upload");
  if (!uploadTask) throw new Error("Upload task tidak ditemukan.");
  await cloudConvert.tasks.upload(uploadTask, fs.createReadStream(docxPath));

  const jobDone = await cloudConvert.jobs.wait(job.id);
  const exportTask = jobDone.tasks.find(
    t => t.operation === "export/url" && t.status === "finished"
  );
  if (!exportTask?.result?.files || exportTask.result.files.length === 0) {
    throw new Error("Export task gagal atau tidak ada file.");
  }

  const fileUrl = exportTask.result.files[0].url;
  if (!fileUrl) throw new Error("URL file hasil tidak tersedia.");

  const res = await fetch(fileUrl);
  const buffer = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outputPath, buffer);

  return outputPath;
}
