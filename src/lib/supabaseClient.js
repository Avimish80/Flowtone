import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function isLocalPreviewHost() {
  if (typeof window === "undefined") return false;

  const host = window.location.hostname || "";
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".local") ||
    /^192\.168\.\d+\.\d+$/.test(host) ||
    /^10\.\d+\.\d+\.\d+$/.test(host)
  );
}

export function isPreviewModeEnabled() {
  return !isSupabaseConfigured;
}

let client = null;

export function getSupabaseClient() {
  if (!isSupabaseConfigured) return null;
  if (client) return client;

  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
    },
  });

  return client;
}

export const supabase = getSupabaseClient();
