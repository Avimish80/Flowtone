import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';

// ─── Resolve DB path ────────────────────────────────────────────────
// Production: /app/data/flowtone.db  (container / deployment)
// Local dev:  ./flowtone.db          (fallback when /app/data is absent)
function resolveDbPath() {
  const prodDir = '/app/data';
  try {
    if (!existsSync(prodDir)) {
      mkdirSync(prodDir, { recursive: true });
    }
    return `${prodDir}/flowtone.db`;
  } catch {
    // Can't create /app/data — fall back to local file
    return './flowtone.db';
  }
}

const dbPath = resolveDbPath();
const db = new Database(dbPath);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// ─── Schema ─────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint           TEXT PRIMARY KEY,
    p256dh             TEXT NOT NULL,
    auth               TEXT NOT NULL,
    user_agent         TEXT,
    notification_level TEXT NOT NULL DEFAULT 'standard',
    created_at         TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS scheduled_pushes (
    id         TEXT    PRIMARY KEY,
    endpoint   TEXT    NOT NULL,
    fire_at    INTEGER NOT NULL,
    title      TEXT    NOT NULL,
    body       TEXT    NOT NULL,
    url        TEXT,
    icon       TEXT,
    actions    TEXT,
    tag        TEXT,
    sent       INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

console.log(`[db] SQLite ready at ${dbPath}`);

export default db;
