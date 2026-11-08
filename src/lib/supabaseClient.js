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

// The local Supabase stack delivers sign-in codes to Mailpit on the Mac
// (port 54324, next to the API on 54321), never to a real inbox. Returns
// Mailpit's address when the app talks to such a stack, so the sign-in
// screen can point there; null for a cloud project.
export function mailpitUrl() {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== "http:" || url.port !== "54321") return null;
    url.port = "54324";
    url.pathname = "/";
    return url.toString();
  } catch {
    return null;
  }
}

let client = null;
let cachedSession = null;

// Where supabase-js keeps the session. By default that is one key per
// database host; the local stack gets a fixed key instead, because it is
// reached at whatever address this Mac had at build time (its Wi-Fi IP, its
// Tailscale name) and is the same database either way.
export function authStorageKey() {
  if (!isSupabaseConfigured) return null;
  if (import.meta.env.MODE === "localdb") return "sb-flowtone-local-auth-token";
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

// Builds before 27 Oct 2026 stored the local session per IP address
// (sb-192-auth-token, ...). Carry the freshest one over instead of signing
// out: local sign-in codes only reach the Mac's Mailpit, so a phone away from
// home could not sign back in. Then remove them all, so none is left to bring
// back after a sign-out.
function adoptLocalSession() {
  if (import.meta.env.MODE !== "localdb") return;
  try {
    const key = authStorageKey();
    const old = Object.keys(localStorage).filter((k) => /^sb-\d+-auth-token/.test(k));
    if (!old.length) return;
    if (!localStorage.getItem(key)) {
      const expiry = (k) => { try { return JSON.parse(localStorage.getItem(k))?.expires_at || 0; } catch { return 0; } };
      const freshest = old.filter((k) => /^sb-\d+-auth-token$/.test(k)).sort((a, b) => expiry(b) - expiry(a))[0];
      if (freshest) localStorage.setItem(key, localStorage.getItem(freshest));
    }
    old.forEach((k) => localStorage.removeItem(k));
  } catch { /* storage blocked */ }
}

export function getSupabaseClient() {
  if (!isSupabaseConfigured) return null;
  if (client) return client;

  adoptLocalSession();
  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storageKey: authStorageKey(),
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
