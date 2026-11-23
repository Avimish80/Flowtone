// Offline tests for iCloud Mail. Run with `npm test` in server/.
//
// Nothing here touches Apple or a real database. Apple's IMAP and SMTP are
// replaced by stand-ins (icloudMail.js exposes them as `transports`), and the
// database is a small HTTP server that answers the way Supabase's REST API
// does, so the real mailparser, nodemailer, supabase-js and Express routes all
// run. What this cannot prove is Apple's own behaviour: that needs one real
// mailbox, connected with an app-specific password.
import assert from 'node:assert/strict';
import http from 'node:http';
import { createRequire } from 'node:module';

// The code under test logs what it leaves out and what fails. Those lines are
// expected here and would bury the results.
console.warn = () => {};
console.error = () => {};

const require = createRequire(import.meta.url);
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');

// ───────────── stand-in for the database HTTP API (PostgREST) ─────────────
const db = {
  accounts: new Map(), messages: new Map(), clients: [], requests: [],
  mode: 'ok',           // 'ok' | 'down' | 'no-table'
};
let idCounter = 0;
function send(res, status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
}
const httpServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/auth/v1/user') {
      const token = String(req.headers.authorization || '').replace('Bearer ', '');
      if (!token.startsWith('tok-')) return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
      return send(res, 200, { id: token.slice(4), aud: 'authenticated', role: 'authenticated', email: token.slice(4) + '@test.example' });
    }
    const table = url.pathname.replace('/rest/v1/', '');
    const body = raw ? JSON.parse(raw) : null;
    db.requests.push({ method: req.method, table, query: Object.fromEntries(url.searchParams), prefer: req.headers.prefer || '', body });
    if (db.mode === 'down') return send(res, 503, { code: 'PGRST000', message: 'Could not connect with the database' });
    if (db.mode === 'no-table' && table === 'mail_accounts') {
      return send(res, 404, { code: 'PGRST205', message: "Could not find the table 'public.mail_accounts' in the schema cache" });
    }
    const eq = (k) => (url.searchParams.get(k) || '').replace(/^eq\./, '');
    if (table === 'mail_accounts' && req.method === 'GET') {
      let rows = [...db.accounts.values()];
      if (url.searchParams.has('user_id')) rows = rows.filter((r) => r.user_id === eq('user_id'));
      if (url.searchParams.has('sync_enabled')) rows = rows.filter((r) => String(r.sync_enabled) === eq('sync_enabled'));
      return send(res, 200, rows);
    }
    if (table === 'mail_accounts' && req.method === 'PATCH') {
      const row = db.accounts.get(eq('user_id'));
      if (row) Object.assign(row, body);
      res.writeHead(204); return res.end();
    }
    if (table === 'mail_accounts' && req.method === 'POST') {
      assert.equal(url.searchParams.get('on_conflict'), 'user_id');
      const row = Array.isArray(body) ? body[0] : body;
      db.accounts.set(row.user_id, { last_synced_at: null, created_at: new Date().toISOString(), ...(db.accounts.get(row.user_id) || {}), ...row });
      res.writeHead(201); return res.end();
    }
    if (table === 'mail_accounts' && req.method === 'DELETE') {
      db.accounts.delete(eq('user_id'));
      res.writeHead(204); return res.end();
    }
    if (table === 'business_profiles' && req.method === 'GET') return send(res, 200, [{ user_id: eq('user_id'), business_name: 'Avi Music' }]);
    if (table === 'clients' && req.method === 'GET') return send(res, 200, db.clients);
    if (table === 'email_messages' && req.method === 'POST') {
      // What Postgres would do: one bad row fails the whole statement.
      if (body.some((r) => /POISON/.test(r.subject))) {
        return send(res, 400, { code: '22P05', message: 'unsupported Unicode escape sequence' });
      }
      if (body.some((r) => /BROKENDB/.test(r.subject))) {
        return send(res, 400, { code: '23502', message: 'null value in column violates not-null constraint' });
      }
      const inserted = [];
      for (const r of body) {
        const key = r.user_id + '|' + r.message_id;
        if (db.messages.has(key)) continue;              // ON CONFLICT DO NOTHING
        const row = { id: 'm' + (++idCounter), ...r };
        db.messages.set(key, row);
        inserted.push({ id: row.id });
      }
      return send(res, 201, inserted);
    }
    send(res, 404, { code: 'TEST', message: 'unexpected request ' + req.method + ' ' + req.url });
  });
});
await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${httpServer.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role';
process.env.MAIL_SECRET_KEY = 'test-secret-key';

// Imported only now: supabaseAdmin.js and mailCrypto.js read the settings above
// when they load.
const mail = await import('../lib/icloudMail.js');
const sync = await import('../lib/mailSync.js');
const mailCrypto = await import('../lib/mailCrypto.js');

// ───────────── stand-in for Apple's IMAP ─────────────
const PASSWORD = 'abcd-efgh-ijkl-mnop';
const imap = { uidValidity: 777n, uidNext: 1, messages: [], boxes: [], rejectUser: null, connectError: null, connectDelay: 0, connects: 0, clients: [], appended: [] };
class FakeImap {
  constructor(options) { this.options = options; this.fetchCalls = []; imap.clients.push(this); }
  on() {}
  async connect() {
    imap.connects += 1;
    if (imap.connectDelay) await new Promise((r) => setTimeout(r, imap.connectDelay));
    if (imap.connectError) throw imap.connectError;
    if ((imap.rejectUser && imap.rejectUser(this.options.auth.user)) || this.options.auth.pass !== PASSWORD) {
      const err = new Error('Command failed'); err.authenticationFailed = true; throw err;
    }
  }
  async getMailboxLock(path) {
    assert.equal(path, 'INBOX');
    this.mailbox = { path, uidValidity: imap.uidValidity, uidNext: imap.uidNext };
    return { release: () => { this.released = true; } };
  }
  async search(query, options) {
    assert.deepEqual(options, { uid: true });
    if (query.since) {
      const day = new Date(query.since); day.setHours(0, 0, 0, 0);
      return imap.messages.filter((m) => m.date >= day).map((m) => m.uid);
    }
    const m = /^(\d+):\*$/.exec(query.uid || '');
    assert.ok(m, 'incremental search must be "N:*"');
    const hits = imap.messages.filter((x) => x.uid >= Number(m[1])).map((x) => x.uid);
    // Real IMAP: "N:*" always matches the last message, even below N.
    if (!hits.length && imap.messages.length) return [imap.messages[imap.messages.length - 1].uid];
    return hits;
  }
  async *fetch(range, query, options) {
    assert.deepEqual(options, { uid: true });
    assert.equal(query.source.maxLength, 400000);
    const uids = String(range).split(',').map(Number);
    this.fetchCalls.push(uids);
    for (const uid of uids) {
      const m = imap.messages.find((x) => x.uid === uid);
      if (!m) continue;
      if (m.broken) { yield { uid, get flags() { throw new Error('boom'); } }; continue; }
      yield { uid, source: m.raw, envelope: m.envelope || {}, flags: new Set(m.flags || []), internalDate: m.date };
    }
  }
  async list() { return imap.boxes; }
  async append(path, content, flags, idate) { imap.appended.push({ path, content, flags, idate }); }
  async logout() { this.loggedOut = true; }
}
mail.transports.imap = (options) => new FakeImap(options);

// ───────────── helpers ─────────────
async function buildRaw(options = {}) {
  const t = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  const info = await t.sendMail({ from: 'Jane Client <jane@example.com>', to: 'avi@icloud.com', subject: 'Hello', text: 'Hi there', ...options });
  return info.message;
}
const minutesAgo = (n) => new Date(Date.now() - n * 60_000);
async function fillInbox(firstUid, count, extra = () => ({})) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const uid = firstUid + i;
    const opts = extra(uid, i);
    out.push({ uid, date: opts.date || minutesAgo((count - i) * 3), raw: await buildRaw({ subject: `Message ${uid}`, ...(opts.mail || {}) }), flags: opts.flags || [], broken: !!opts.broken });
  }
  return out;
}
const ACCOUNT = () => ({
  user_id: 'u1', provider: 'icloud', email: 'avi@icloud.com', login: 'avi@icloud.com',
  secret_ciphertext: mailCrypto.encryptSecret(PASSWORD),
  imap_host: 'imap.mail.me.com', imap_port: 993, smtp_host: 'smtp.mail.me.com', smtp_port: 587,
  sync_enabled: true, uid_validity: null, last_uid: 0, last_synced_at: null, last_error: '',
});
function resetAll() {
  db.accounts.clear(); db.messages.clear(); db.clients = []; db.requests = []; db.mode = 'ok';
  Object.assign(imap, { uidValidity: 777n, uidNext: 1, messages: [], boxes: [], rejectUser: null, connectError: null, connectDelay: 0, connects: 0, clients: [], appended: [] });
}
const wellFormed = (v) => JSON.stringify(v).indexOf('\\u0000') === -1 && JSON.stringify(v).isWellFormed() && !/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i.test(JSON.stringify(v));

let passed = 0; let failed = 0;
async function test(name, fn) {
  resetAll();
  try { await fn(); passed += 1; console.log('  ok   ' + name); }
  catch (err) { failed += 1; console.log('  FAIL ' + name + '\n       ' + String(err.stack || err).split('\n').slice(0, 6).join('\n       ')); }
}

// ───────────── cleanText and parsing ─────────────
console.log('parsing and cleaning');
await test('cleanText removes NUL and half emoji, keeps whole emoji', () => {
  assert.equal(mail.cleanText('a\u0000b'), 'ab');
  assert.equal(mail.cleanText('ab😀', 3), 'ab');          // cut through the pair
  assert.equal(mail.cleanText('ab😀', 4), 'ab😀');
  assert.equal(mail.cleanText('x\uDE00y'), 'xy');
  assert.equal(mail.cleanText(null), '');
  assert.equal(mail.cleanText(42), '42');
});
await test('plain message: fields, sender, date, seen flag', async () => {
  const raw = await buildRaw({ subject: 'Wedding 12 June', text: 'Are you free?', cc: 'Bob <bob@example.com>' });
  const m = await mail.parseMessage({ uid: 9, source: raw, envelope: {}, flags: new Set(['\\Seen']), internalDate: new Date() }, { uidValidity: 777 });
  assert.equal(m.subject, 'Wedding 12 June');
  assert.equal(m.from_email, 'jane@example.com');
  assert.equal(m.from_name, 'Jane Client');
  assert.equal(m.text.trim(), 'Are you free?');
  assert.equal(m.snippet, 'Are you free?');
  assert.deepEqual(m.to, [{ name: '', address: 'avi@icloud.com' }]);
  assert.deepEqual(m.cc, [{ name: 'Bob', address: 'bob@example.com' }]);
  assert.match(m.message_id, /^<.+@example\.com>$/);
  assert.equal(m.seen, true);
  assert.ok(!Number.isNaN(Date.parse(m.date)));
});
await test('snippet cut inside an emoji stays storable', async () => {
  const text = 'x'.repeat(199) + '😀' + ' tail';
  const raw = await buildRaw({ text });
  const m = await mail.parseMessage({ uid: 1, source: raw, flags: new Set(), internalDate: new Date() });
  assert.ok(m.snippet.length <= 200);
  assert.ok(wellFormed(m), 'no half surrogate may survive');
  assert.equal(m.snippet, 'x'.repeat(199));
});
await test('NUL characters in a body are removed', async () => {
  const raw = await buildRaw({ text: 'before\u0000after', subject: 'nul\u0000subject' });
  const m = await mail.parseMessage({ uid: 1, source: raw, flags: new Set(), internalDate: new Date() });
  assert.ok(!m.text.includes('\u0000') && !m.subject.includes('\u0000'));
  assert.ok(wellFormed(m));
});
await test('HTML-only message still yields readable text', async () => {
  const raw = await buildRaw({ text: undefined, html: '<p>Hello <b>Avi</b></p><p>Quote please</p>' });
  const m = await mail.parseMessage({ uid: 1, source: raw, flags: new Set(), internalDate: new Date() });
  assert.match(m.text, /Hello/); assert.match(m.text, /Quote please/); assert.ok(!/<p>/.test(m.text));
});
await test('attachment is listed with name and type', async () => {
  const raw = await buildRaw({ attachments: [{ filename: 'contract.pdf', content: Buffer.from('%PDF-1.4 test'), contentType: 'application/pdf' }] });
  const m = await mail.parseMessage({ uid: 1, source: raw, flags: new Set(), internalDate: new Date() });
  assert.equal(m.attachments.length, 1);
  assert.equal(m.attachments[0].filename, 'contract.pdf');
  assert.equal(m.attachments[0].contentType, 'application/pdf');
});
await test('garbage Date header falls back to the arrival time', async () => {
  const raw = Buffer.from((await buildRaw()).toString('latin1').replace(/^Date: .*$/m, 'Date: not a date at all'), 'latin1');
  const arrival = new Date('2026-11-01T10:00:00Z');
  const m = await mail.parseMessage({ uid: 1, source: raw, flags: new Set(), internalDate: arrival });
  assert.equal(m.date, arrival.toISOString());
});
await test('arrival time wins over a Date header set in the future', async () => {
  const raw = Buffer.from((await buildRaw()).toString('latin1').replace(/^Date: .*$/m, 'Date: Fri, 01 Jan 2038 10:00:00 +0000'), 'latin1');
  const arrival = new Date('2026-11-01T10:00:00Z');
  const m = await mail.parseMessage({ uid: 1, source: raw, flags: new Set(), internalDate: arrival });
  assert.equal(m.date, arrival.toISOString());
  const noArrival = await mail.parseMessage({ uid: 1, source: raw, flags: new Set() });
  assert.equal(noArrival.date, '2038-01-01T10:00:00.000Z', 'header date is the fallback');
});
await test('absurd year in Date header is not stored', async () => {
  const raw = Buffer.from((await buildRaw()).toString('latin1').replace(/^Date: .*$/m, 'Date: Mon, 01 Jan 12026 10:00:00 +0000'), 'latin1');
  const arrival = new Date('2026-11-01T10:00:00Z');
  const m = await mail.parseMessage({ uid: 1, source: raw, flags: new Set(), internalDate: arrival });
  const year = new Date(m.date).getUTCFullYear();
  assert.ok(year >= 1970 && year <= 2100, 'got ' + m.date);
});
await test('missing Message-ID gets a stable stand-in; very long one is capped', async () => {
  const noId = Buffer.from((await buildRaw()).toString('latin1').replace(/^Message-ID: .*\r\n/mi, ''), 'latin1');
  const a = await mail.parseMessage({ uid: 55, source: noId, flags: new Set(), internalDate: new Date() }, { uidValidity: 777 });
  assert.equal(a.message_id, 'uid:777:55@imap.mail.me.com');
  const long = await buildRaw({ messageId: '<' + 'a'.repeat(3000) + '@example.com>' });
  const b = await mail.parseMessage({ uid: 56, source: long, flags: new Set(), internalDate: new Date() });
  assert.ok(b.message_id.length <= 500);
});
await test('no source at all still gives a row from the envelope', async () => {
  const m = await mail.parseMessage({ uid: 3, envelope: { subject: 'Env subject', from: [{ name: 'Env', address: 'ENV@Example.com' }], messageId: '<env@x>', date: new Date('2026-10-10T10:00:00Z') }, flags: new Set() });
  assert.equal(m.subject, 'Env subject'); assert.equal(m.from_email, 'env@example.com'); assert.equal(m.message_id, '<env@x>');
});
await test('error wording', () => {
  const auth = Object.assign(new Error('x'), { authenticationFailed: true });
  assert.ok(mail.isAuthFailure(auth));
  assert.ok(mail.isAuthFailure(Object.assign(new Error('Invalid login: 535 5.7.8 Error: authentication failed'), { code: 'EAUTH' })));
  assert.ok(!mail.isAuthFailure(new Error('connect ETIMEDOUT')));
  assert.match(mail.friendlyMailError(auth), /app-specific password/);
  assert.match(mail.friendlyMailError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })), /Could not reach/);
});

// ───────────── reading the inbox ─────────────
console.log('reading the inbox');
await test('first read takes the newest 150 of the last 30 days, in chunks of 40', async () => {
  imap.messages = await fillInbox(301, 200); imap.uidNext = 501;
  const r = await mail.fetchInboxMessages(ACCOUNT(), PASSWORD, {});
  assert.equal(r.fresh, true); assert.equal(r.messages.length, 150);
  assert.equal(r.messages[0].uid, 351); assert.equal(r.messages[149].uid, 500);
  assert.equal(r.lastUid, 500); assert.equal(r.uidValidity, 777); assert.equal(typeof r.uidValidity, 'number');
  const c = imap.clients[0];
  assert.deepEqual(c.fetchCalls.map((x) => x.length), [40, 40, 40, 30]);
  assert.ok(c.released && c.loggedOut, 'lock released and logged out');
  assert.equal(c.options.host, 'imap.mail.me.com'); assert.equal(c.options.port, 993); assert.equal(c.options.secure, true);
});
await test('first read ignores mail older than 30 days', async () => {
  imap.messages = await fillInbox(1, 5, (uid, i) => ({ date: i < 2 ? new Date(Date.now() - 60 * 86_400_000) : minutesAgo(10 - i) })); imap.uidNext = 6;
  const r = await mail.fetchInboxMessages(ACCOUNT(), PASSWORD, {});
  assert.deepEqual(r.messages.map((m) => m.uid), [3, 4, 5]); assert.equal(r.lastUid, 5);
});
await test('first read of an inbox with nothing recent remembers where it ends', async () => {
  imap.messages = await fillInbox(1, 3, () => ({ date: new Date(Date.now() - 90 * 86_400_000) })); imap.uidNext = 501;
  const r = await mail.fetchInboxMessages(ACCOUNT(), PASSWORD, {});
  assert.equal(r.messages.length, 0); assert.equal(r.lastUid, 500);
});
await test('later read brings only what is new', async () => {
  imap.messages = await fillInbox(498, 6); imap.uidNext = 504;
  const r = await mail.fetchInboxMessages(ACCOUNT(), PASSWORD, { lastUid: 500, uidValidity: 777 });
  assert.equal(r.fresh, false); assert.deepEqual(r.messages.map((m) => m.uid), [501, 502, 503]); assert.equal(r.lastUid, 503);
});
await test('later read with nothing new brings nothing (the "N:*" quirk)', async () => {
  imap.messages = await fillInbox(498, 3); imap.uidNext = 501;
  const r = await mail.fetchInboxMessages(ACCOUNT(), PASSWORD, { lastUid: 500, uidValidity: 777 });
  assert.equal(r.messages.length, 0); assert.equal(r.lastUid, 500);
});
await test('rebuilt mailbox (UIDVALIDITY changed) restarts the count', async () => {
  imap.uidValidity = 999n; imap.messages = await fillInbox(1, 10); imap.uidNext = 11;
  const r = await mail.fetchInboxMessages(ACCOUNT(), PASSWORD, { lastUid: 9000, uidValidity: 777 });
  assert.equal(r.fresh, true); assert.equal(r.messages.length, 10);
  assert.equal(r.lastUid, 10, 'old high number must not survive'); assert.equal(r.uidValidity, 999);
});
await test('one unreadable message does not stop the rest', async () => {
  imap.messages = await fillInbox(1, 5, (uid) => ({ broken: uid === 3 })); imap.uidNext = 6;
  const r = await mail.fetchInboxMessages(ACCOUNT(), PASSWORD, {});
  assert.deepEqual(r.messages.map((m) => m.uid), [1, 2, 4, 5]); assert.equal(r.unreadable, 1); assert.equal(r.lastUid, 5);
});
await test('sign-in: full address first, short name second, custom domain once', async () => {
  imap.rejectUser = (u) => u.includes('@');
  assert.equal(await mail.resolveLogin({ email: 'avi@icloud.com', login: '' }, PASSWORD), 'avi');
  assert.equal(imap.connects, 2);
  resetAll(); imap.rejectUser = () => true;
  await assert.rejects(mail.resolveLogin({ email: 'avi@mydomain.co.uk', login: '' }, PASSWORD), /app-specific password/);
  assert.equal(imap.connects, 1, 'custom domain is tried once only');
  resetAll(); imap.connectError = Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' });
  await assert.rejects(mail.resolveLogin({ email: 'avi@icloud.com', login: '' }, PASSWORD), /Could not reach/);
  assert.equal(imap.connects, 1, 'a network error is not retried with another name');
});

// ───────────── storing ─────────────
console.log('storing in the database');
await test('first sync stores everything, links a known client, records the position', async () => {
  db.accounts.set('u1', ACCOUNT());
  db.clients = [{ id: 'c-jane', user_id: 'u1', emails: ['Jane@Example.com'] }];
  imap.messages = await fillInbox(1, 60, (uid) => ({ flags: uid % 2 ? ['\\Seen'] : [] })); imap.uidNext = 61;
  const r = await sync.runMailSyncForUser('u1');
  assert.deepEqual({ ok: r.ok, imported: r.imported, checked: r.checked, skipped: r.skipped, initial: r.initial }, { ok: true, imported: 60, checked: 60, skipped: 0, initial: true });
  assert.equal(db.messages.size, 60);
  const acc = db.accounts.get('u1');
  assert.equal(acc.last_uid, 60); assert.equal(acc.uid_validity, 777); assert.equal(acc.last_error, ''); assert.ok(acc.last_synced_at);
  const row = [...db.messages.values()][0];
  assert.equal(row.user_id, 'u1'); assert.equal(row.status, 'new'); assert.equal(row.payload.client_id, 'c-jane');
  assert.equal(row.payload.folder, 'INBOX'); assert.equal(row.payload.account_email, 'avi@icloud.com');
  assert.equal(typeof row.payload.uid_validity, 'number');
  const posts = db.requests.filter((q) => q.table === 'email_messages');
  assert.deepEqual(posts.map((p) => p.body.length), [50, 10]);
  assert.equal(posts[0].query.on_conflict, 'user_id,message_id');
  assert.match(posts[0].prefer, /resolution=ignore-duplicates/); assert.match(posts[0].prefer, /return=representation/);
});
await test('second sync with nothing new stores nothing and skips the client lookup', async () => {
  db.accounts.set('u1', { ...ACCOUNT(), last_uid: 60, uid_validity: 777 });
  imap.messages = await fillInbox(58, 3); imap.uidNext = 61;
  const r = await sync.runMailSyncForUser('u1');
  assert.equal(r.imported, 0); assert.equal(r.checked, 0); assert.equal(r.initial, false);
  assert.equal(db.requests.filter((q) => q.table === 'clients').length, 0);
  assert.equal(db.requests.filter((q) => q.table === 'email_messages').length, 0);
});
await test('a message already in the inbox keeps its status (reconnect re-reads the month)', async () => {
  db.accounts.set('u1', ACCOUNT());
  imap.messages = await fillInbox(1, 4); imap.uidNext = 5;
  await sync.runMailSyncForUser('u1');
  const first = [...db.messages.values()][0]; first.status = 'linked';
  Object.assign(db.accounts.get('u1'), { last_uid: 0, uid_validity: null });   // what a reconnect does
  imap.messages.push(...await fillInbox(5, 2)); imap.uidNext = 7;
  const r = await sync.runMailSyncForUser('u1');
  assert.equal(r.checked, 6); assert.equal(r.imported, 2);
  assert.equal(db.messages.size, 6); assert.equal([...db.messages.values()][0].status, 'linked');
});
await test('one message the database refuses is left out, the rest go in', async () => {
  db.accounts.set('u1', ACCOUNT());
  imap.messages = await fillInbox(1, 5, (uid) => (uid === 3 ? { mail: { subject: 'POISON pill' } } : {})); imap.uidNext = 6;
  const r = await sync.runMailSyncForUser('u1');
  assert.equal(r.imported, 4); assert.equal(r.skipped, 1);
  assert.equal(db.accounts.get('u1').last_uid, 5, 'the mailbox moves on past it');
});
await test('a lone refused message does not block the mailbox', async () => {
  db.accounts.set('u1', { ...ACCOUNT(), last_uid: 5, uid_validity: 777 });
  imap.messages = await fillInbox(6, 1, () => ({ mail: { subject: 'POISON alone' } })); imap.uidNext = 7;
  const r = await sync.runMailSyncForUser('u1');
  assert.equal(r.imported, 0); assert.equal(r.skipped, 1); assert.equal(db.accounts.get('u1').last_uid, 6);
});
await test('every message refused at once is reported, position kept', async () => {
  db.accounts.set('u1', ACCOUNT());
  imap.messages = await fillInbox(1, 3, () => ({ mail: { subject: 'POISON all' } })); imap.uidNext = 4;
  await assert.rejects(sync.runMailSyncForUser('u1'), /could be stored/);
  assert.equal(db.accounts.get('u1').last_uid, 0); assert.match(db.accounts.get('u1').last_error, /could be stored/);
  assert.equal(db.accounts.get('u1').sync_enabled, true);
});
await test('a database fault that is not about one row stops the sync, nothing is skipped', async () => {
  db.accounts.set('u1', ACCOUNT());
  imap.messages = await fillInbox(1, 3, () => ({ mail: { subject: 'BROKENDB' } })); imap.uidNext = 4;
  await assert.rejects(sync.runMailSyncForUser('u1'), /not-null/);
  assert.equal(db.accounts.get('u1').last_uid, 0);
});
await test('database down: sync fails cleanly and the position is kept', async () => {
  db.accounts.set('u1', ACCOUNT());
  imap.messages = await fillInbox(1, 3); imap.uidNext = 4;
  const account = { ...db.accounts.get('u1') };
  db.mode = 'down';
  await assert.rejects(sync.runMailSyncForUser('u1', { account }), /Could not connect/);
  db.mode = 'ok';
  assert.equal(db.accounts.get('u1').last_uid, 0);
});
await test('refused password pauses the import and says how to fix it', async () => {
  db.accounts.set('u1', ACCOUNT()); imap.rejectUser = () => true;
  await assert.rejects(sync.runMailSyncForUser('u1'), /paused/);
  const acc = db.accounts.get('u1');
  assert.equal(acc.sync_enabled, false); assert.match(acc.last_error, /connect again/);
  const listed = await sync.syncAllMailAccounts();
  assert.equal(listed.users, 0, 'the timer no longer picks it up');
});
await test('unreadable stored password pauses the import without contacting Apple', async () => {
  db.accounts.set('u1', { ...ACCOUNT(), secret_ciphertext: 'v1.AAAA.BBBB.CCCC' });
  await assert.rejects(sync.runMailSyncForUser('u1'), /reconnect the mailbox/);
  assert.equal(db.accounts.get('u1').sync_enabled, false); assert.equal(imap.connects, 0);
  assert.throws(() => mailCrypto.decryptSecret('garbage'), /unreadable/);
  assert.throws(() => mailCrypto.decryptSecret('v1.!!.!!.!!'), /reconnect the mailbox/);
});
await test('network trouble does not pause the import', async () => {
  db.accounts.set('u1', ACCOUNT()); imap.connectError = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
  await assert.rejects(sync.runMailSyncForUser('u1'), /Could not reach/);
  assert.equal(db.accounts.get('u1').sync_enabled, true);
});
await test('two syncs at once share one run', async () => {
  db.accounts.set('u1', ACCOUNT()); imap.connectDelay = 60;
  imap.messages = await fillInbox(1, 3); imap.uidNext = 4;
  const [a, b] = await Promise.all([sync.runMailSyncForUser('u1'), sync.runMailSyncForUser('u1')]);
  assert.equal(imap.connects, 1); assert.equal(a, b); assert.equal(a.imported, 3);
  const c = await sync.runMailSyncForUser('u1');
  assert.equal(imap.connects, 2, 'a later call runs again'); assert.equal(c.imported, 0);
});
await test('timer run covers every mailbox with the import on', async () => {
  db.accounts.set('u1', ACCOUNT());
  db.accounts.set('u2', { ...ACCOUNT(), user_id: 'u2', email: 'two@icloud.com', sync_enabled: false });
  imap.messages = await fillInbox(1, 2); imap.uidNext = 3;
  assert.deepEqual(await sync.syncAllMailAccounts(), { users: 1, ok: 1, failed: 0 });
});
await test('server ahead of its database: quiet, and recognisable', async () => {
  db.mode = 'no-table';
  assert.deepEqual(await sync.syncAllMailAccounts(), { users: 0, ok: 0, failed: 0 });
  let caught = null;
  try { await sync.getMailAccount('u1'); } catch (err) { caught = err; }
  assert.ok(sync.isMailNotSetUp(caught));
  assert.ok(!sync.isMailNotSetUp(new Error('fetch failed')));
});
await test('publicAccount never carries the stored password', () => {
  const out = sync.publicAccount(ACCOUNT());
  assert.ok(!('secret_ciphertext' in out)); assert.ok(!JSON.stringify(out).includes('v1.'));
  assert.deepEqual(sync.publicAccount(null), { connected: false });
});
await test('stored password: round trip, unique each time, wrong key refused', () => {
  const a = mailCrypto.encryptSecret(PASSWORD); const b = mailCrypto.encryptSecret(PASSWORD);
  assert.notEqual(a, b); assert.ok(!a.includes(PASSWORD));
  assert.equal(mailCrypto.decryptSecret(a), PASSWORD);
  const [v, iv, tag, data] = a.split('.');
  const flipped = [v, iv, tag, Buffer.from(Buffer.from(data, 'base64').map((x) => x ^ 1)).toString('base64')].join('.');
  assert.throws(() => mailCrypto.decryptSecret(flipped), /could not be decrypted/);
});

// ───────────── sending ─────────────
console.log('sending');
const smtp = { sent: [], closed: 0, fail: null };
mail.transports.smtp = (options) => ({
  sendMail: async (m) => { smtp.sent.push({ options, m }); if (smtp.fail) throw smtp.fail; return { accepted: m.envelope.to, messageId: '<made-up-by-smtp@x>' }; },
  close: () => { smtp.closed += 1; },
});
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
await test('send: right server, right envelope, logo attached, copy filed in Sent', async () => {
  Object.assign(smtp, { sent: [], closed: 0, fail: null });
  imap.boxes = [{ path: 'INBOX', name: 'INBOX' }, { path: 'Sent Messages', name: 'Sent Messages', specialUse: '\\Sent' }];
  const account = { ...ACCOUNT(), login: 'avi' };
  const r = await mail.sendMessage(account, PASSWORD, {
    to: ['client@example.com'], cc: ['agent@example.com'], bcc: ['hidden@example.com'],
    subject: 'Invoice #INV-0042 from Avi Music', html: `<div><img src="${LOGO}" alt=""><p>Total £600</p></div>`, fromName: 'Avi Music',
  });
  const { options, m } = smtp.sent[0];
  assert.equal(options.host, 'smtp.mail.me.com'); assert.equal(options.port, 587);
  assert.equal(options.secure, false); assert.equal(options.requireTLS, true);
  assert.equal(options.auth.user, 'avi@icloud.com', 'SMTP signs in with the full address'); assert.equal(options.auth.pass, PASSWORD);
  assert.deepEqual(m.envelope, { from: 'avi@icloud.com', to: ['client@example.com', 'agent@example.com', 'hidden@example.com'] });
  assert.ok(Buffer.isBuffer(m.raw));
  const text = m.raw.toString('utf8');
  assert.ok(!/^Bcc:/mi.test(text), 'the hidden recipient is not written into the message');
  const parsed = await simpleParser(m.raw);
  assert.equal(parsed.subject, 'Invoice #INV-0042 from Avi Music');
  assert.equal(parsed.from.value[0].address, 'avi@icloud.com'); assert.equal(parsed.from.value[0].name, 'Avi Music');
  assert.equal(parsed.to.value[0].address, 'client@example.com'); assert.equal(parsed.cc.value[0].address, 'agent@example.com');
  assert.equal(parsed.attachments.length, 1, 'the logo became an inline attachment'); assert.equal(parsed.attachments[0].contentType, 'image/png');
  assert.ok(!text.includes('src="data:image'), 'no data: image is left in the HTML');
  assert.match(parsed.html, /Total £600/);
  assert.equal(r.messageId, parsed.messageId, 'the id reported is the id inside the message');
  assert.deepEqual(r.accepted, ['client@example.com', 'agent@example.com', 'hidden@example.com']);
  assert.equal(r.filedInSent, true); assert.equal(smtp.closed, 1);
  assert.equal(imap.appended.length, 1); assert.equal(imap.appended[0].path, 'Sent Messages');
  assert.deepEqual(imap.appended[0].flags, ['\\Seen']); assert.ok(imap.appended[0].content.equals(m.raw), 'Sent copy is byte-identical');
});
await test('send: Sent folder found by name when the server gives no marker', async () => {
  Object.assign(smtp, { sent: [], closed: 0, fail: null });
  imap.boxes = [{ path: 'INBOX', name: 'INBOX' }, { path: 'Sent Items', name: 'Sent Items' }];
  const r = await mail.sendMessage(ACCOUNT(), PASSWORD, { to: ['a@example.com'], subject: 's', text: 'plain' });
  assert.equal(r.filedInSent, true); assert.equal(imap.appended[0].path, 'Sent Items');
});
await test('send: no Sent folder, or IMAP down, still counts as sent', async () => {
  Object.assign(smtp, { sent: [], closed: 0, fail: null });
  imap.boxes = [{ path: 'INBOX', name: 'INBOX' }];
  let r = await mail.sendMessage(ACCOUNT(), PASSWORD, { to: ['a@example.com'], subject: 's', text: 'plain' });
  assert.equal(r.filedInSent, false); assert.equal(smtp.sent.length, 1);
  imap.connectError = new Error('socket hang up');
  r = await mail.sendMessage(ACCOUNT(), PASSWORD, { to: ['a@example.com'], subject: 's', text: 'plain' });
  assert.equal(r.filedInSent, false); assert.equal(smtp.sent.length, 2);
});
await test('send: refused by Apple gives the plain-words error and files nothing', async () => {
  Object.assign(smtp, { sent: [], closed: 0, fail: Object.assign(new Error('Invalid login: 535 5.7.8 Error: authentication failed'), { code: 'EAUTH' }) });
  imap.boxes = [{ path: 'Sent Messages', name: 'Sent Messages', specialUse: '\\Sent' }];
  await assert.rejects(mail.sendMessage(ACCOUNT(), PASSWORD, { to: ['a@example.com'], subject: 's', text: 'plain' }), /app-specific password/);
  assert.equal(imap.appended.length, 0); assert.equal(smtp.closed, 1);
});

// ───────────── the HTTP routes, as the app calls them ─────────────
console.log('routes');
const express = require('express');
const router = (await import('../routes/mail.js')).default;
const app = express();
app.use('/api/mail/send', express.json({ limit: '8mb' }));   // same two lines as server/index.js
app.use(express.json());
app.use('/api/mail', router);
app.use((err, req, res, next) => { res.status(err.status || 500).end(); });   // keeps the 413 below out of the output
const appServer = await new Promise((r) => { const srv = app.listen(0, '127.0.0.1', () => r(srv)); });
const base = `http://127.0.0.1:${appServer.address().port}/api/mail`;
async function api(method, path, body, user = 'r1') {
  const headers = { 'content-type': 'application/json' };
  if (user) headers.authorization = user === 'BAD' ? 'Bearer nonsense' : `Bearer tok-${user}`;
  const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, data };
}
const until = async (check, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (check()) return true; await new Promise((r) => setTimeout(r, 15)); } return false; };

await test('routes refuse a caller who is not signed in', async () => {
  assert.equal((await api('GET', '/status', undefined, null)).status, 401);
  assert.equal((await api('GET', '/status', undefined, 'BAD')).status, 401);
  assert.equal((await api('POST', '/send', { to: 'a@example.com', subject: 's', text: 't' }, null)).status, 401);
});
await test('connect, first import, status, toggle, sync, disconnect', async () => {
  imap.messages = await fillInbox(1, 7); imap.uidNext = 8;
  assert.deepEqual((await api('GET', '/status')).data, { connected: false });
  assert.equal((await api('POST', '/connect', { email: 'nope', password: PASSWORD })).status, 400);
  assert.equal((await api('POST', '/connect', { email: 'avi@icloud.com', password: 'short' })).status, 400);
  assert.equal((await api('POST', '/connect', { email: 'avi@icloud.com', password: PASSWORD, login: 'bad login!' })).status, 400);
  assert.equal(imap.connects, 0, 'nothing reaches Apple before the form is valid');

  const c = await api('POST', '/connect', { email: '  Avi@iCloud.com ', password: ` ${PASSWORD} \n` });
  assert.equal(c.status, 200);
  assert.equal(c.data.connected, true); assert.equal(c.data.email, 'avi@icloud.com'); assert.equal(c.data.sync_enabled, true);
  assert.ok(!JSON.stringify(c.data).includes(PASSWORD) && !('secret_ciphertext' in c.data), 'the password never comes back');
  const row = db.accounts.get('r1');
  assert.ok(!row.secret_ciphertext.includes(PASSWORD)); assert.equal(mailCrypto.decryptSecret(row.secret_ciphertext), PASSWORD);
  assert.equal(row.login, 'avi@icloud.com'); assert.equal(row.imap_host, 'imap.mail.me.com'); assert.equal(row.smtp_port, 587);

  assert.ok(await until(() => db.messages.size === 7 && db.accounts.get('r1').last_uid === 7), 'first import runs by itself after connect');
  const st = await api('GET', '/status');
  assert.equal(st.data.connected, true); assert.ok(st.data.last_synced_at); assert.equal(st.data.last_error, '');

  assert.equal((await api('POST', '/toggle', { enabled: false })).data.sync_enabled, false);
  assert.equal((await api('POST', '/toggle', { enabled: true })).data.sync_enabled, true);

  imap.messages.push(...await fillInbox(8, 2)); imap.uidNext = 10;
  const sy = await api('POST', '/sync', {});
  assert.equal(sy.status, 200); assert.equal(sy.data.imported, 2); assert.equal(sy.data.initial, false);

  const d = await api('POST', '/disconnect', {});
  assert.deepEqual(d.data, { connected: false }); assert.ok(!db.accounts.has('r1'));
  assert.equal(db.messages.size, 9, 'imported mail stays after disconnecting');
  assert.equal((await api('POST', '/sync', {})).status, 400);
});
await test('send route: checks the form, uses the business name, takes a large logo', async () => {
  Object.assign(smtp, { sent: [], closed: 0, fail: null });
  imap.boxes = [{ path: 'Sent Messages', name: 'Sent Messages', specialUse: '\\Sent' }];
  assert.equal((await api('POST', '/send', { to: 'c@example.com', subject: 's', htmlBody: '<p>x</p>' }, 'r2')).status, 400, 'no mailbox yet');
  db.accounts.set('r2', { ...ACCOUNT(), user_id: 'r2' });
  assert.equal((await api('POST', '/send', { subject: 's', htmlBody: '<p>x</p>' }, 'r2')).status, 400);
  assert.equal((await api('POST', '/send', { to: 'not-an-address', subject: 's', htmlBody: '<p>x</p>' }, 'r2')).status, 400);
  assert.equal((await api('POST', '/send', { to: 'c@example.com', cc: ['bad'], subject: 's', htmlBody: '<p>x</p>' }, 'r2')).status, 400);
  assert.equal((await api('POST', '/send', { to: 'c@example.com', htmlBody: '<p>x</p>' }, 'r2')).status, 400);
  assert.equal((await api('POST', '/send', { to: 'c@example.com', subject: 's' }, 'r2')).status, 400);
  assert.equal(smtp.sent.length, 0);

  const bigLogo = 'data:image/png;base64,' + Buffer.alloc(2_300_000, 7).toString('base64');     // about 3 MB of JSON
  const ok = await api('POST', '/send', { to: 'c@example.com', subject: 'Invoice #INV-0042', htmlBody: `<img src="${bigLogo}"><p>Total</p>` }, 'r2');
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal(ok.data.ok, true); assert.equal(ok.data.from, 'avi@icloud.com'); assert.equal(ok.data.filedInSent, true); assert.ok(ok.data.messageId);
  const parsed = await simpleParser(smtp.sent[0].m.raw);
  assert.equal(parsed.from.value[0].name, 'Avi Music'); assert.equal(parsed.attachments.length, 1);
  assert.equal(parsed.attachments[0].size, 2_300_000);

  const tooBigElsewhere = await api('POST', '/toggle', { enabled: true, filler: 'x'.repeat(300_000) }, 'r2');
  assert.equal(tooBigElsewhere.status, 413, 'the larger limit applies to sending only');
});
await test('wrong password: plain words, and Apple is spared after five tries', async () => {
  imap.rejectUser = () => true;
  for (let i = 0; i < 5; i += 1) {
    const r = await api('POST', '/connect', { email: 'avi@mydomain.co.uk', password: PASSWORD }, 'r3');
    assert.equal(r.status, 400); assert.match(r.data.error, /app-specific password/);
  }
  assert.equal(imap.connects, 5);
  const sixth = await api('POST', '/connect', { email: 'avi@mydomain.co.uk', password: PASSWORD }, 'r3');
  assert.equal(sixth.status, 429); assert.match(sixth.data.error, /ten minutes/);
  assert.equal(imap.connects, 5, 'the sixth try never reaches Apple');
  assert.ok(!db.accounts.has('r3'));
});
await test('server ahead of its database: option hidden, nothing reaches Apple', async () => {
  db.mode = 'no-table';
  assert.deepEqual((await api('GET', '/status', undefined, 'r4')).data, { connected: false, available: false });
  const c = await api('POST', '/connect', { email: 'avi@icloud.com', password: PASSWORD }, 'r4');
  assert.equal(c.status, 503); assert.match(c.data.error, /not switched on/);
  assert.equal((await api('POST', '/sync', {}, 'r4')).status, 503);
  assert.equal((await api('POST', '/send', { to: 'c@example.com', subject: 's', text: 't' }, 'r4')).status, 503);
  assert.equal(imap.connects, 0);
});
await test('database unreachable during connect: no sign-in attempt is spent', async () => {
  db.mode = 'down';
  const c = await api('POST', '/connect', { email: 'avi@icloud.com', password: PASSWORD }, 'r5');
  assert.equal(c.status, 500); assert.match(c.data.error, /database/);
  assert.equal(imap.connects, 0);
});

appServer.close();
httpServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
