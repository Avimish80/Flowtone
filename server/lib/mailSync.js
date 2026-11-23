// Pulls new INBOX mail for every connected iCloud account into email_messages,
// the table the Email Inbox page already reads. Called from the HTTP routes
// (connect, "Sync now") and from the five-minute scheduler tick.
import { getSupabaseAdmin } from './supabaseAdmin.js';
import { decryptSecret } from './mailCrypto.js';
import { fetchInboxMessages, friendlyMailError, isAuthFailure } from './icloudMail.js';

export const ACCOUNTS_TABLE = 'mail_accounts';
const MESSAGES_TABLE = 'email_messages';
const UPSERT_CHUNK = 50;

/**
 * True when the database has no mail tables yet, which is the state of a
 * server deployed before migration 20261108_mail_accounts.sql has been run.
 */
export function isMailNotSetUp(err) {
  const code = String(err?.code || '');
  const message = String(err?.message || '');
  return code === 'PGRST205' || code === '42P01'
    || (/mail_accounts/.test(message) && /schema cache|does not exist/i.test(message));
}

export async function getMailAccount(userId) {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from(ACCOUNTS_TABLE).select('*').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return data || null;
}

/** What the client may see of an account row: never the ciphertext. */
export function publicAccount(row) {
  if (!row) return { connected: false };
  return {
    connected: true,
    provider: row.provider,
    email: row.email,
    login: row.login,
    sync_enabled: !!row.sync_enabled,
    last_synced_at: row.last_synced_at,
    last_error: row.last_error || '',
    created_at: row.created_at,
  };
}

/** lower-cased client email -> client id, so known senders arrive pre-linked. */
async function clientEmailMap(db, userId) {
  const map = new Map();
  const { data } = await db.from('clients').select('*').eq('user_id', userId);
  for (const c of data || []) {
    const emails = Array.isArray(c.emails) ? c.emails : Array.isArray(c.payload?.emails) ? c.payload.emails : [];
    for (const e of emails) {
      if (typeof e === 'string' && e.trim()) map.set(e.trim().toLowerCase(), c.id);
    }
  }
  return map;
}

export function toRow(userId, m, account, uidValidity, clients) {
  const clientId = m.from_email ? clients.get(m.from_email) || null : null;
  return {
    user_id: userId,
    message_id: m.message_id,
    subject: m.subject || '(no subject)',
    from_name: m.from_name || '',
    from_email: m.from_email || '',
    status: 'new',
    date: m.date,
    snippet: m.snippet || '',
    body: m.text || '',
    thread_id: m.references?.[0] || m.in_reply_to || m.message_id,
    payload: {
      provider: account.provider || 'icloud',
      account_email: account.email,
      folder: 'INBOX',
      uid: m.uid,
      uid_validity: uidValidity,
      to: m.to,
      cc: m.cc,
      in_reply_to: m.in_reply_to || '',
      references: m.references || [],
      has_attachments: (m.attachments || []).length > 0,
      attachments: m.attachments || [],
      seen_on_server: !!m.seen,
      client_id: clientId,
    },
  };
}

// Errors that belong to one row and not to the database: data it cannot hold
// (class 22) or a value too large to index (class 54).
const isRowProblem = (error) => /^(22|54)/.test(String(error?.code || ''));

async function storeRows(db, rows) {
  // ignoreDuplicates = ON CONFLICT DO NOTHING: a message already in the inbox
  // keeps the status the user gave it. Only rows that are new come back.
  const insert = (batch) => db
    .from(MESSAGES_TABLE)
    .upsert(batch, { onConflict: 'user_id,message_id', ignoreDuplicates: true })
    .select('id');

  const whole = await insert(rows);
  if (!whole.error) return { imported: whole.data?.length || 0, skipped: 0 };
  if (!isRowProblem(whole.error)) throw whole.error;

  // One message the database will not take must not block the mailbox: the
  // next sync would read it again and fail again, for good. Go row by row and
  // leave out only the rows that are themselves the problem.
  let imported = 0;
  let skipped = 0;
  for (const row of rows) {
    const one = await insert([row]);
    if (!one.error) {
      imported += one.data?.length || 0;
    } else if (isRowProblem(one.error)) {
      skipped += 1;
      console.warn(`[mail-sync] Left out message uid ${row.payload?.uid}: ${one.error.message}`);
    } else {
      throw one.error;
    }
  }
  return { imported, skipped };
}

async function syncOnce(userId, given) {
  const db = getSupabaseAdmin();
  const account = given || await getMailAccount(userId);
  if (!account) throw new Error('No mailbox connected');
  const startedAt = new Date().toISOString();
  let unreadableCredential = false;
  try {
    let password;
    try {
      password = decryptSecret(account.secret_ciphertext);
    } catch (err) {
      unreadableCredential = true;
      throw err;
    }
    const { messages, lastUid, uidValidity, fresh } = await fetchInboxMessages(account, password, {
      lastUid: Number(account.last_uid) || 0,
      uidValidity: account.uid_validity,
    });
    const clients = messages.length ? await clientEmailMap(db, userId) : new Map();

    let imported = 0;
    let skipped = 0;
    for (let i = 0; i < messages.length; i += UPSERT_CHUNK) {
      const rows = messages.slice(i, i + UPSERT_CHUNK).map((m) => toRow(userId, m, account, uidValidity, clients));
      const stored = await storeRows(db, rows);
      imported += stored.imported;
      skipped += stored.skipped;
    }
    // A single odd message is left out and the sync moves on. Every message
    // failing at once is not about the messages, so it is reported instead.
    if (messages.length > 1 && skipped === messages.length) {
      throw new Error('None of the new messages could be stored');
    }

    const { error: updateError } = await db.from(ACCOUNTS_TABLE).update({
      last_uid: lastUid,
      uid_validity: uidValidity,
      last_synced_at: startedAt,
      last_error: '',
    }).eq('user_id', userId);
    if (updateError) throw updateError;

    return { ok: true, imported, checked: messages.length, skipped, initial: fresh, last_synced_at: startedAt };
  } catch (err) {
    const refused = isAuthFailure(err);
    const message = refused
      ? 'Apple no longer accepts the saved password, so the inbox import is paused. Disconnect, then connect again with a new app-specific password.'
      : friendlyMailError(err);
    const patch = { last_error: message.slice(0, 500) };
    // A refused or unreadable password is never retried on the timer. Every
    // five minutes would be hundreds of failed sign-ins a day, and Apple
    // locks accounts for that. Reconnecting switches the import back on.
    if (refused || unreadableCredential) patch.sync_enabled = false;
    try {
      await db.from(ACCOUNTS_TABLE).update(patch).eq('user_id', userId);
    } catch {
      // Recording the error is best effort.
    }
    throw new Error(message);
  }
}

const inFlight = new Map();

/**
 * Sync one user's INBOX. Resolves to { ok, imported, checked, skipped,
 * initial, last_synced_at }; throws with a user-facing message after
 * recording it on the account row so Settings can show it.
 *
 * One sync per mailbox at a time: the scheduler tick, "Sync now" and the
 * first import after connecting all share a run that is already going.
 */
export function runMailSyncForUser(userId, { account } = {}) {
  const running = inFlight.get(userId);
  if (running) return running;
  const run = syncOnce(userId, account).finally(() => inFlight.delete(userId));
  inFlight.set(userId, run);
  return run;
}

/** Scheduler entry point: every account with sync on, one after another. */
export async function syncAllMailAccounts() {
  const db = getSupabaseAdmin();
  const { data, error } = await db.from(ACCOUNTS_TABLE).select('*').eq('sync_enabled', true);
  if (error) {
    // No tables yet (server ahead of its database): nothing to do, say nothing.
    if (!isMailNotSetUp(error)) console.error('[mail-sync] Could not list mail accounts:', error.message);
    return { users: 0, ok: 0, failed: 0 };
  }
  let ok = 0;
  let failed = 0;
  for (const account of data || []) {
    try {
      await runMailSyncForUser(account.user_id, { account });
      ok += 1;
    } catch (err) {
      failed += 1;
      console.error(`[mail-sync] ${account.email}: ${err.message}`);
    }
  }
  return { users: (data || []).length, ok, failed };
}
