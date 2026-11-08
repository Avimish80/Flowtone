// Reminders for the iOS app, delivered as iOS local notifications.
//
// The iPhone app has no web push (no service worker in its web view), so the
// reminder plan pushManager builds is handed to the phone itself: iOS fires
// each one at its time even when Flowtone is closed, with no server involved.
// The plan only covers what this device knew at the last open/resume, so
// callers re-plan on every resume (see useAppResume).
//
// Not covered here: instant server-side alerts (new lead, quote accepted, new
// Google gigs while the app is closed). Those need real Apple push later.

import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

// iOS keeps at most 64 pending local notifications per app. Leave headroom
// for the test notification.
const MAX_PLANNED = 60;
const TEST_ID = 999999;
const OFF_KEY = "flowtone_local_reminders_off";

export const isNative = () => Capacitor.isNativePlatform();

/** Stable positive 31-bit id from a reminder tag, so re-planning the same
 *  reminder replaces it instead of adding a duplicate. */
function idForTag(tag) {
  let h = 5381;
  for (let i = 0; i < tag.length; i++) h = ((h * 33) ^ tag.charCodeAt(i)) >>> 0;
  const id = h % 2147483647;
  return id === 0 || id === TEST_ID ? id + 1 : id;
}

function isTurnedOff() {
  try { return localStorage.getItem(OFF_KEY) === "1"; } catch { return false; }
}

function setTurnedOff(off) {
  try {
    if (off) localStorage.setItem(OFF_KEY, "1");
    else localStorage.removeItem(OFF_KEY);
  } catch { /* storage unavailable */ }
}

/** → "granted" | "denied" | "prompt" | "unavailable" */
export async function getLocalPermission() {
  if (!isNative()) return "unavailable";
  try {
    const { display } = await LocalNotifications.checkPermissions();
    return display === "granted" || display === "denied" ? display : "prompt";
  } catch {
    return "unavailable";
  }
}

export async function areLocalRemindersOn() {
  if (!isNative() || isTurnedOff()) return false;
  return (await getLocalPermission()) === "granted";
}

/** Ask iOS for permission (only prompts the first time) and switch reminders on. */
export async function enableLocalReminders() {
  if (!isNative()) return { success: false, reason: "not_supported" };
  let { display } = await LocalNotifications.checkPermissions();
  if (display !== "granted" && display !== "denied") {
    ({ display } = await LocalNotifications.requestPermissions());
  }
  if (display !== "granted") return { success: false, reason: "denied" };
  setTurnedOff(false);
  return { success: true };
}

export async function disableLocalReminders() {
  if (!isNative()) return;
  setTurnedOff(true);
  await cancelPlanned();
}

async function cancelPlanned() {
  const { notifications } = await LocalNotifications.getPending();
  const planned = notifications.filter((n) => n.id !== TEST_ID);
  if (planned.length) {
    await LocalNotifications.cancel({ notifications: planned.map((n) => ({ id: n.id })) });
  }
  return notifications.length;
}

export async function getPendingCount() {
  if (!isNative()) return 0;
  try {
    const { notifications } = await LocalNotifications.getPending();
    return notifications.length;
  } catch {
    return 0;
  }
}

// Open and resume can both trigger a re-plan; run them one after another.
let queue = Promise.resolve();

/**
 * Replace the phone's pending reminders with `plan` (from buildReminderPlan):
 * cancel the previous plan, then schedule the nearest MAX_PLANNED reminders.
 */
export function scheduleLocalReminders(plan = []) {
  const run = queue.then(async () => {
    if (!(await areLocalRemindersOn())) return { scheduled: 0 };
    const before = await cancelPlanned();

    const soon = Date.now() + 5000;
    const byId = new Map();
    plan
      .map((p) => ({ ...p, at: new Date(p.fireAt) }))
      .filter((p) => p.at.getTime() > soon)
      .sort((a, b) => a.at - b.at)
      .forEach((p) => {
        const id = idForTag(p.tag || `${p.title}-${p.fireAt}`);
        if (!byId.has(id)) byId.set(id, p);
      });

    const notifications = [...byId.entries()].slice(0, MAX_PLANNED).map(([id, p]) => ({
      id,
      title: p.title,
      body: p.body,
      schedule: { at: p.at, allowWhileIdle: true },
      extra: { kind: "reminder", url: p.url || "/", tag: p.tag || "" },
    }));
    if (notifications.length) await LocalNotifications.schedule({ notifications });

    const after = await getPendingCount();
    console.info(`[reminders] planned ${notifications.length} of ${plan.length}; pending before ${before}, after ${after}`);
    return { scheduled: notifications.length, before, after };
  });
  queue = run.catch(() => {});
  return run;
}

/** Fire a test notification a few seconds from now (lock the phone to see the banner). */
export async function sendLocalTest() {
  if (!(await areLocalRemindersOn())) return { success: false, reason: "not_subscribed" };
  await LocalNotifications.schedule({
    notifications: [{
      id: TEST_ID,
      title: "Flowtone test",
      body: "Reminders are working on this iPhone.",
      schedule: { at: new Date(Date.now() + 5000), allowWhileIdle: true },
      extra: { kind: "test", url: "/AppSettings" },
    }],
  });
  return { success: true };
}

/** Call `handler(url)` when a reminder is tapped. Returns an unsubscribe function.
 *  iOS holds a tap that launched the app until this listener is attached. */
export function onReminderTap(handler) {
  if (!isNative()) return () => {};
  const listener = LocalNotifications.addListener("localNotificationActionPerformed", (action) => {
    const url = action?.notification?.extra?.url;
    if (url) handler(url);
  });
  return () => { listener.then((h) => h.remove()).catch(() => {}); };
}

/** Opens Flowtone's page in the iOS Settings app (to re-allow notifications). */
export function openIosSettings() {
  window.location.href = "app-settings:";
}
