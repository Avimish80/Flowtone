// iCloud Mail: connect with an app-specific password, sync INBOX into
// email_messages, send through SMTP. Every route needs a signed-in user. The
// password travels once (connect) and is stored encrypted; /status never
// returns it.
import { Router } from 'express';
import { requireAuthenticatedUser } from '../lib/auth.js';
import { getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { encryptSecret, decryptSecret } from '../lib/mailCrypto.js';
import { ICLOUD_DEFAULTS, resolveLogin, sendMessage } from '../lib/icloudMail.js';
import { ACCOUNTS_TABLE, getMailAccount, isMailNotSetUp, publicAccount, runMailSyncForUser } from '../lib/mailSync.js';

const router = Router();
router.use(requireAuthenticatedUser);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOT_SET_UP = 'iCloud Mail is not switched on for this server yet.';

// Apple locks an account after repeated failed sign-ins, so connect attempts
// are capped per user: five per ten minutes.
const connectAttempts = new Map();
function tooManyAttempts(userId) {
  const now = Date.now();
  const recent = (connectAttempts.get(userId) || []).filter((t) => now - t < 10 * 60_000);
  connectAttempts.set(userId, recent);
  if (recent.length >= 5) return true;
  recent.push(now);
  return false;
}

function cleanAddresses(value) {
  return [].concat(value || []).map((s) => String(s).trim()).filter(Boolean);
}

// GET /api/mail/status
router.get('/status', async (req, res) => {
  try {
    res.json(publicAccount(await getMailAccount(req.flowtoneUser.id)));
  } catch (err) {
    // A server whose database has not had the mail migration yet answers
    // "not available" quietly, so the app hides the option instead of
    // offering something that cannot work.
    if (isMailNotSetUp(err)) return res.json({ connected: false, available: false });
    console.error('[mail/status]', err.message);
    res.status(500).json({ error: 'Could not read the mailbox status' });
  }
});

// POST /api/mail/connect { email, password, login? }
router.post('/connect', async (req, res) => {
  const userId = req.flowtoneUser.id;
  const email = String(req.body?.email || '').trim().toLowerCase();
  const login = String(req.body?.login || '').trim().toLowerCase();
  // Apple shows app passwords as xxxx-xxxx-xxxx-xxxx; the dashes are part of
  // the password, spaces never are.
  const password = String(req.body?.password || '').replace(/\s+/g, '');

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter the full iCloud email address' });
  if (password.length < 8) return res.status(400).json({ error: 'Enter the app-specific password Apple generated' });
  if (login && !EMAIL_RE.test(login) && !/^[a-z0-9._-]+$/.test(login)) {
    return res.status(400).json({ error: 'The sign-in address looks wrong' });
  }

  try {
    // Look at the table before talking to Apple: with no place to store the
    // result, a sign-in attempt would be spent for nothing.
    await getMailAccount(userId);
  } catch (err) {
    if (isMailNotSetUp(err)) return res.status(503).json({ error: NOT_SET_UP });
    console.error('[mail/connect]', err.message);
    return res.status(500).json({ error: 'Could not reach the database. Try again in a moment.' });
  }

  if (tooManyAttempts(userId)) {
    return res.status(429).json({ error: 'Too many sign-in attempts. Wait ten minutes before trying again, so Apple does not lock the account.' });
  }

  try {
    const resolvedLogin = await resolveLogin({ ...ICLOUD_DEFAULTS, email, login }, password);
    const db = getSupabaseAdmin();
    const { error } = await db.from(ACCOUNTS_TABLE).upsert({
      user_id: userId,
      provider: 'icloud',
      email,
      login: resolvedLogin,
      secret_ciphertext: encryptSecret(password),
      imap_host: ICLOUD_DEFAULTS.imap_host,
      imap_port: ICLOUD_DEFAULTS.imap_port,
      smtp_host: ICLOUD_DEFAULTS.smtp_host,
      smtp_port: ICLOUD_DEFAULTS.smtp_port,
      sync_enabled: true,
      uid_validity: null,
      last_uid: 0,
      last_error: '',
    }, { onConflict: 'user_id' });
    if (error) throw error;

    const saved = await getMailAccount(userId);
    res.json(publicAccount(saved));

    // The first import runs after the reply: it can take a while, and the
    // account is already saved, so the user is not kept waiting.
    runMailSyncForUser(userId, { account: saved }).then(
      (r) => console.log(`[mail] First sync for ${email}: ${r.imported} message(s)`),
      (err) => console.error(`[mail] First sync for ${email} failed: ${err.message}`)
    );
  } catch (err) {
    console.error('[mail/connect]', err.message);
    res.status(400).json({ error: err.message || 'Could not connect the mailbox' });
  }
});

// POST /api/mail/disconnect
router.post('/disconnect', async (req, res) => {
  try {
    const db = getSupabaseAdmin();
    const { error } = await db.from(ACCOUNTS_TABLE).delete().eq('user_id', req.flowtoneUser.id);
    if (error) throw error;
    res.json({ connected: false });
  } catch (err) {
    console.error('[mail/disconnect]', err.message);
    res.status(500).json({ error: 'Could not disconnect the mailbox' });
  }
});

// POST /api/mail/toggle { enabled }
router.post('/toggle', async (req, res) => {
  try {
    const db = getSupabaseAdmin();
    const { error } = await db.from(ACCOUNTS_TABLE)
      .update({ sync_enabled: !!req.body?.enabled })
      .eq('user_id', req.flowtoneUser.id);
    if (error) throw error;
    res.json(publicAccount(await getMailAccount(req.flowtoneUser.id)));
  } catch (err) {
    console.error('[mail/toggle]', err.message);
    res.status(500).json({ error: 'Could not update the mailbox' });
  }
});

// POST /api/mail/sync
router.post('/sync', async (req, res) => {
  try {
    res.json(await runMailSyncForUser(req.flowtoneUser.id));
  } catch (err) {
    if (isMailNotSetUp(err)) return res.status(503).json({ error: NOT_SET_UP });
    const status = err.message === 'No mailbox connected' ? 400 : 500;
    res.status(status).json({ error: err.message || 'Sync failed' });
  }
});

// POST /api/mail/send { to, cc?, subject, htmlBody | html, text?, replyTo? }
router.post('/send', async (req, res) => {
  const userId = req.flowtoneUser.id;
  const body = req.body || {};
  const to = cleanAddresses(body.to);
  const cc = cleanAddresses(body.cc);
  const subject = String(body.subject || '').trim().slice(0, 300);
  const html = body.html || body.htmlBody || '';
  const text = body.text || '';
  const replyTo = String(body.replyTo || '').trim();

  if (!to.length || to.some((r) => !EMAIL_RE.test(r))) return res.status(400).json({ error: 'Enter a valid recipient address' });
  if (cc.some((r) => !EMAIL_RE.test(r))) return res.status(400).json({ error: 'A cc address is not valid' });
  if (replyTo && !EMAIL_RE.test(replyTo)) return res.status(400).json({ error: 'The reply-to address is not valid' });
  if (!subject) return res.status(400).json({ error: 'Add a subject' });
  if (!html && !text) return res.status(400).json({ error: 'The email has no content' });

  try {
    const account = await getMailAccount(userId);
    if (!account) return res.status(400).json({ error: 'iCloud Mail is not connected' });
    const password = decryptSecret(account.secret_ciphertext);

    const db = getSupabaseAdmin();
    const { data: profile } = await db.from('business_profiles').select('*').eq('user_id', userId).maybeSingle();
    const fromName = String(profile?.business_name || profile?.payload?.business_name || '').trim();

    const result = await sendMessage(account, password, {
      to, cc, subject, html: html || undefined, text: text || undefined, replyTo: replyTo || undefined, fromName,
    });
    res.json({ ok: true, from: account.email, ...result });
  } catch (err) {
    if (isMailNotSetUp(err)) return res.status(503).json({ error: NOT_SET_UP });
    console.error('[mail/send]', err.message);
    res.status(500).json({ error: err.message || 'Could not send the email' });
  }
});

export default router;
