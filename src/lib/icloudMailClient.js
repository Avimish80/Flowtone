// Frontend side of the iCloud Mail connection: a thin wrapper over /api/mail.
// The password is sent once, on connect, and never comes back. The connected
// state is cached per device so synchronous code (the send helper, the
// invoice page) can ask "is a mailbox connected?" without a round trip; the
// cache is refreshed on app open and after every change made here.
import { flowtoneJson } from "@/lib/flowtoneApi";
import { isPreviewModeEnabled } from "@/lib/supabaseClient";

const CACHE_KEY = "flowtone_icloud_mail_status";

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : { connected: false };
  } catch {
    return { connected: false };
  }
}

function writeCache(status) {
  try {
    if (status?.connected) {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        connected: true,
        email: status.email || "",
        sync_enabled: !!status.sync_enabled,
        last_synced_at: status.last_synced_at || null,
        last_error: status.last_error || "",
        checked_at: Date.now(),
      }));
    } else {
      localStorage.removeItem(CACHE_KEY);
    }
  } catch {
    // Storage unavailable: the status still returns to the caller.
  }
  return status;
}

export function getCachedICloudMailStatus() {
  return readCache();
}

export function isICloudMailConnected() {
  return !!readCache().connected;
}

export function getICloudMailEmail() {
  return readCache().email || "";
}

/** Ask the server and refresh the cache. Offline or signed out: keep what we knew. */
export async function refreshICloudMailStatus() {
  if (isPreviewModeEnabled()) return { connected: false };
  try {
    return writeCache(await flowtoneJson("/api/mail/status"));
  } catch {
    return readCache();
  }
}

export async function connectICloudMail({ email, password, login }) {
  const status = await flowtoneJson("/api/mail/connect", {
    method: "POST",
    body: JSON.stringify({ email, password, login: login || "" }),
    timeoutMs: 45000,
  });
  return writeCache(status);
}

export async function disconnectICloudMail() {
  return writeCache(await flowtoneJson("/api/mail/disconnect", { method: "POST" }));
}

export async function setICloudMailSyncEnabled(enabled) {
  return writeCache(await flowtoneJson("/api/mail/toggle", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  }));
}

/** Import new INBOX messages now. Returns { imported, checked, last_synced_at }. */
export async function syncICloudMailNow() {
  return flowtoneJson("/api/mail/sync", { method: "POST", timeoutMs: 120000 });
}

export async function sendICloudMail({ to, cc, subject, htmlBody, text, replyTo }) {
  return flowtoneJson("/api/mail/send", {
    method: "POST",
    body: JSON.stringify({ to, cc, subject, htmlBody, text, replyTo }),
    timeoutMs: 60000,
  });
}
