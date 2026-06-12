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
let cachedSession = null;

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

  // Keep a synchronous copy of the session. supabase.auth.getSession() can
  // deadlock on its internal lock after an iOS PWA resumes from background,
  // which would hang every data call with no error.
  client.auth.onAuthStateChange((_event, session) => {
    cachedSession = session;
  });
  client.auth.getSession().then(({ data }) => {
    if (data?.session) cachedSession = data.session;
  }).catch(() => {});

  return client;
}

// Session lookup that can never hang: prefer the cached copy, and cap the
// fallback getSession() call at 4 seconds.
export async function getSessionSafe() {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  if (cachedSession) return cachedSession;

  return Promise.race([
    supabase.auth.getSession().then(({ data }) => data.session || null).catch(() => null),
    new Promise((resolve) => setTimeout(() => resolve(null), 4000)),
  ]);
}

export const supabase = getSupabaseClient();
