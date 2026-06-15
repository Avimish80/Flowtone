// Frontend calendar client — thin wrapper over the server's /api/calendar routes.
// The browser never sees the Google token; the server holds it and does the sync.
// All real calls are authenticated via the Supabase session Bearer token,
// attached automatically by flowtoneFetch/flowtoneJson.

import { flowtoneJson } from "@/lib/flowtoneApi";
import { isPreviewModeEnabled } from "@/lib/supabaseClient";

const OPEN_SYNC_KEY = "flowtone_calendar_last_open_sync";
const OPEN_SYNC_THROTTLE_MS = 2 * 60 * 1000; // at most one silent sync per 2 min

/** Kick off the OAuth flow — redirects the browser to Google. */
export async function connectCalendar() {
  const { url } = await flowtoneJson(
    `/api/calendar/auth-url?origin=${encodeURIComponent(window.location.origin)}`
  );
  window.location.href = url;
}

/** Display state only (connected, email, sync_enabled, last_synced_at). */
export async function getCalendarStatus() {
  if (isPreviewModeEnabled()) return { connected: false };
  try {
    return await flowtoneJson("/api/calendar/status");
  } catch {
    return { connected: false };
  }
}

/** Run a two-way sync now. Returns { pushed, pulled, last_synced_at } or throws. */
export async function syncNow() {
  return flowtoneJson("/api/calendar/sync", { method: "POST" });
}

export async function setSyncEnabled(enabled) {
  return flowtoneJson("/api/calendar/toggle", {
    method: "POST",
    body: JSON.stringify({ enabled }),
  });
}

export async function disconnectCalendar() {
  return flowtoneJson("/api/calendar/disconnect", { method: "POST" });
}

/**
 * Remove a single event from Google now. Call when the user DELETES a gig in
 * Flowtone — the sync engine can't push a deletion once the local row is gone.
 * Best-effort and fail-quiet; never blocks the local delete.
 */
export async function deleteCalendarEvent(googleId) {
  if (isPreviewModeEnabled() || !googleId || String(googleId).startsWith("local-")) return;
  try {
    await flowtoneJson("/api/calendar/delete-event", {
      method: "POST",
      body: JSON.stringify({ google_calendar_event_id: googleId }),
    });
  } catch {
    // Best-effort — a leftover Google copy is better than blocking the delete.
  }
}

/** Notify the user about gigs just pulled from Google that have no details. */
async function notifyBareGigs(gigs) {
  if (!gigs?.length) return;
  try {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const reg = await navigator.serviceWorker?.ready;
    if (!reg) return;
    const one = gigs.length === 1;
    reg.showNotification(
      one ? `New gig from Google: ${gigs[0].title || "Untitled"}` : `${gigs.length} new gigs from Google`,
      {
        body: "Add the client, fee and details in Flowtone.",
        tag: "flowtone-bare-gigs",
        icon: "/icon-192x192.svg",
        data: { url: one ? `/WorkEventDetail?id=${gigs[0].id}` : "/WorkEvents" },
      }
    );
  } catch {
    // Notifications are a nice-to-have; never disrupt sync.
  }
}

/**
 * Silent sync on app open. Throttled, fail-quiet, and a no-op when calendar
 * isn't connected or sync is disabled. Safe to call on every mount.
 */
export async function maybeSyncOnOpen() {
  if (isPreviewModeEnabled()) return;
  try {
    const last = Number(localStorage.getItem(OPEN_SYNC_KEY) || 0);
    if (Date.now() - last < OPEN_SYNC_THROTTLE_MS) return;

    const status = await getCalendarStatus();
    if (!status.connected || !status.sync_enabled) return;

    localStorage.setItem(OPEN_SYNC_KEY, String(Date.now()));
    const result = await syncNow();
    await notifyBareGigs(result?.new_bare_gigs);
  } catch {
    // Silent — app-open sync must never disrupt the UI.
  }
}
