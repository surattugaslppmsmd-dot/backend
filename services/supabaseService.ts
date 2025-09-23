import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
export const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function uploadDocxToSupabase(
  fileName: string,
  buffer: Buffer
): Promise<string> {
  const { data, error } = await supabase.storage
    .from("uploads")
    .upload(fileName, buffer, {
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      upsert: true,
    });

  if (error) throw error;

  const { data: urlData } = supabase.storage.from("uploads").getPublicUrl(fileName);
  return urlData.publicUrl;
}
