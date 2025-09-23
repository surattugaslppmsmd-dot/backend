import { createClient } from "@supabase/supabase-js";

// Ambil dari environment
const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("SUPABASE_URL atau SUPABASE_SERVICE_ROLE_KEY belum diatur di .env / Vercel");
}

export const supabase = createClient(supabaseUrl, supabaseKey);
