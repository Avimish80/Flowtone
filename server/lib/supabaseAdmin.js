import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

let adminClient = null;

export function isSupabaseServerConfigured() {
  return Boolean(supabaseUrl && supabaseServiceRoleKey);
}

export function getSupabaseAdmin() {
  if (!isSupabaseServerConfigured()) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.");
  }

  if (adminClient) return adminClient;

  adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return adminClient;
}

