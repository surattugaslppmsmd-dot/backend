import fs from "fs";
import path from "path";
import { supabase } from "../supabaseClient.js";

/**
 * Upload DOCX buffer ke Supabase storage
 * @param fileName nama file yang akan disimpan
 * @param buffer isi file dalam bentuk Buffer
 */
export async function uploadDocxToSupabase(filePath: string): Promise<string> {
  // pastikan file ada
  if (!fs.existsSync(filePath)) {
    throw new Error(`File tidak ditemukan: ${filePath}`);
  }

  // nama file unik di Supabase
  const fileName = `${Date.now()}_${path.basename(filePath)}`;

  // baca file sebagai Buffer
  const buffer = fs.readFileSync(filePath);

  // upload ke bucket "uploads"
  const { error } = await supabase.storage
    .from("uploads")
    .upload(fileName, buffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });

  if (error) {
    console.error("Gagal upload ke Supabase:", error.message);
    throw error;
  }

  // ambil public URL
  const { data: publicUrlData } = supabase.storage
    .from("uploads")
    .getPublicUrl(fileName);

  if (!publicUrlData?.publicUrl) {
    throw new Error("Gagal mendapatkan public URL dari Supabase");
  }

  return publicUrlData.publicUrl;
}
