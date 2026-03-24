/**
 * Simple JSON file store — replaces better-sqlite3.
 * No native compilation needed. Works on any platform.
 *
 * Structure of store.json:
 * {
 *   subscriptions:    { [endpoint]: { endpoint, p256dh, auth, user_agent, notification_level } },
 *   scheduledPushes:  { [id]:       { id, endpoint, fire_at, title, body, url, icon, actions, tag, sent } }
 * }
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Resolve store path ──────────────────────────────────────────────
function resolveStorePath() {
  const prodDir = '/app/data';
  try {
    if (!existsSync(prodDir)) mkdirSync(prodDir, { recursive: true });
    return join(prodDir, 'store.json');
  } catch {
    return join(__dirname, 'store.json');
  }
}

const STORE_PATH = resolveStorePath();

// ─── Load / save ─────────────────────────────────────────────────────
function load() {
  try {
    if (existsSync(STORE_PATH)) {
      return JSON.parse(readFileSync(STORE_PATH, 'utf8'));
    }
  } catch (e) {
    console.warn('[db] Could not read store.json, starting fresh:', e.message);
  }
  return { subscriptions: {}, scheduledPushes: {} };
}

function save(store) {
  try {
    writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (e) {
    console.error('[db] Could not write store.json:', e.message);
  }
}

// ─── In-memory store ─────────────────────────────────────────────────
const store = load();
console.log(`[db] JSON store ready at ${STORE_PATH} — ${Object.keys(store.subscriptions).length} subscriptions, ${Object.keys(store.scheduledPushes).length} scheduled pushes`);

// ─── Subscription helpers ────────────────────────────────────────────
export function upsertSubscription({ endpoint, p256dh, auth, user_agent, notification_level }) {
  store.subscriptions[endpoint] = { endpoint, p256dh, auth, user_agent, notification_level };
  save(store);
}

export function getSubscription(endpoint) {
  return store.subscriptions[endpoint] ?? null;
}

export function deleteSubscription(endpoint) {
  const existed = endpoint in store.subscriptions;
  delete store.subscriptions[endpoint];
  if (existed) save(store);
  return existed;
}

// ─── Scheduled push helpers ──────────────────────────────────────────
export function insertScheduledPush(row) {
  // row: { id, endpoint, fire_at, title, body, url, icon, actions, tag }
  store.scheduledPushes[row.id] = { ...row, sent: 0 };
  save(store);
}

export function deleteUnsentByTagAndEndpoint(tag, endpoint) {
  let changed = false;
  for (const [id, push] of Object.entries(store.scheduledPushes)) {
    if (push.tag === tag && push.endpoint === endpoint && push.sent === 0) {
      delete store.scheduledPushes[id];
      changed = true;
    }
  }
  if (changed) save(store);
}

export function getDuePushes(nowTs) {
  return Object.values(store.scheduledPushes).filter(
    (p) => p.sent === 0 && p.fire_at <= nowTs
  );
}

export function markPushSent(id) {
  if (store.scheduledPushes[id]) {
    store.scheduledPushes[id].sent = 1;
    save(store);
  }
}
