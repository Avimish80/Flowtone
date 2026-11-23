// iCloud Mail over IMAP (read) and SMTP (send), signed in with an Apple
// app-specific password. Apple publishes these hosts for every iCloud mailbox
// and offers no OAuth for iCloud Mail, so this is the only route. iOS itself
// never exposes the Mail app to other apps, which is why this runs on the
// server and not on the phone.
import imapflowPkg from 'imapflow';
import mailparserPkg from 'mailparser';
import nodemailer from 'nodemailer';

const { ImapFlow } = imapflowPkg;
const { simpleParser } = mailparserPkg;

export const ICLOUD_DEFAULTS = {
  imap_host: 'imap.mail.me.com',
  imap_port: 993,
  smtp_host: 'smtp.mail.me.com',
  smtp_port: 587,
};

// The two network clients sit behind one object so the offline tests can put
// stand-ins here. Nothing in production changes it.
export const transports = {
  imap: (options) => new ImapFlow(options),
  smtp: (options) => nodemailer.createTransport(options),
};

const ICLOUD_DOMAINS = new Set(['icloud.com', 'me.com', 'mac.com']);
const CONNECT_TIMEOUT_MS = 20_000;
// Whole messages are fetched up to this size; bigger ones are cut. Text sits
// at the top of a MIME message and attachments at the bottom, so the text
// survives the cut and only attachment bytes are dropped.
const MAX_SOURCE_BYTES = 400_000;
const MAX_TEXT_CHARS = 50_000;
const FETCH_CHUNK = 40;

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

/**
 * Make a string safe to store. Postgres text and jsonb refuse the NUL
 * character, and a string cut in the middle of an emoji keeps half a surrogate
 * pair, which jsonb refuses too. One such value fails the whole insert, so
 * every string headed for the database goes through here, cut to length first.
 */
export function cleanText(value, max = Infinity) {
  const s = value == null ? '' : String(value);
  return (s.length > max ? s.slice(0, max) : s).replace(/\u0000/g, '').replace(LONE_SURROGATE, '');
}

/** First candidate that is a real, plausible date, as ISO; otherwise null. */
function isoDate(...candidates) {
  for (const c of candidates) {
    if (!c) continue;
    const d = c instanceof Date ? c : new Date(c);
    const year = d.getUTCFullYear();
    if (!Number.isNaN(d.getTime()) && year >= 1970 && year <= 2100) return d.toISOString();
  }
  return null;
}

function makeImapClient(account, password) {
  const client = transports.imap({
    host: account.imap_host || ICLOUD_DEFAULTS.imap_host,
    port: Number(account.imap_port) || ICLOUD_DEFAULTS.imap_port,
    secure: true,
    auth: { user: account.login || account.email, pass: password },
    logger: false,
    emitLogs: false,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: 15_000,
    socketTimeout: 90_000,
    clientInfo: { name: 'Flowtone', vendor: 'Flowtone' },
  });
  // ImapFlow is an EventEmitter: an unhandled 'error' would take the server down.
  client.on('error', () => {});
  return client;
}

/** True when the mail server refused the user name or password. */
export function isAuthFailure(err) {
  if (!err) return false;
  return !!err.authenticationFailed || err.code === 'EAUTH'
    || /AUTHENTICATIONFAILED|Invalid credentials|authentication failed|\b535\b/i.test(err.message || '');
}

/** Turn a transport error into one sentence the Settings screen can show. */
export function friendlyMailError(err) {
  if (!err) return 'Unknown mail error';
  const message = err.message || String(err);
  if (isAuthFailure(err)) {
    return 'Apple rejected the sign-in. Check the address, and use an app-specific password, not your Apple ID password.';
  }
  const code = err.code || '';
  if (['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNRESET', 'ESOCKET'].includes(code) || /timed? ?out/i.test(message)) {
    return "Could not reach Apple's mail server from the Flowtone server. Check its internet connection and try again.";
  }
  return message;
}

async function tryLogin(account, password) {
  const client = makeImapClient(account, password);
  await client.connect();
  await client.logout().catch(() => {});
}

/**
 * Verify the password against IMAP and return the user name Apple accepted.
 * Apple documents the user name as "usually the name part of the address",
 * with the full address as the fallback; in practice the full address works,
 * so it is tried first and the short form only after an authentication error.
 */
export async function resolveLogin(account, password) {
  const candidates = [account.login || account.email];
  const [local, domain] = String(account.email || '').toLowerCase().split('@');
  if (!account.login && local && ICLOUD_DOMAINS.has(domain)) candidates.push(local);
  let lastErr = null;
  for (const login of candidates) {
    try {
      await tryLogin({ ...account, login }, password);
      return login;
    } catch (err) {
      lastErr = err;
      if (!isAuthFailure(err)) break;
    }
  }
  throw new Error(friendlyMailError(lastErr));
}

function addressList(addr) {
  return (addr?.value || []).map((a) => ({
    name: cleanText(a.name, 200),
    address: cleanText(a.address, 320).toLowerCase(),
  }));
}

function textFromParsed(parsed) {
  if (parsed.text && parsed.text.trim()) return parsed.text;
  if (parsed.html) {
    return String(parsed.html)
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/[ \t]+/g, ' ')
      .replace(/\n\s*\n\s*\n+/g, '\n\n')
      .trim();
  }
  return '';
}

/** One fetched IMAP message to a plain object ready for email_messages. */
export async function parseMessage(msg, account = {}) {
  const flags = msg.flags instanceof Set ? [...msg.flags] : Array.isArray(msg.flags) ? msg.flags : [];
  let parsed = null;
  try {
    if (msg.source) {
      parsed = await simpleParser(msg.source, { skipImageLinks: true, skipTextLinks: true, skipTextToHtml: true });
    }
  } catch {
    parsed = null;
  }
  const env = msg.envelope || {};
  const envFrom = env.from?.[0]
    ? { name: cleanText(env.from[0].name, 200), address: cleanText(env.from[0].address, 320).toLowerCase() }
    : null;
  const from = parsed?.from ? addressList(parsed.from)[0] || envFrom : envFrom;
  const text = cleanText(parsed ? textFromParsed(parsed) : '', MAX_TEXT_CHARS);
  const host = account.imap_host || ICLOUD_DEFAULTS.imap_host;
  // The id is the key that stops a message being imported twice, and it is
  // indexed, so it is capped well under what an index entry can hold.
  const messageId = cleanText(parsed?.messageId || env.messageId || '', 500).trim()
    || `uid:${account.uidValidity || 0}:${msg.uid}@${host}`;
  const references = Array.isArray(parsed?.references) ? parsed.references : parsed?.references ? [parsed.references] : [];
  return {
    uid: msg.uid,
    message_id: messageId,
    subject: cleanText(parsed?.subject ?? env.subject ?? '', 500).trim(),
    from_name: from?.name || '',
    from_email: from?.address || '',
    // When the message reached the mailbox, as the server recorded it. The
    // Date header is the sender's claim: junk mail gets it wrong or sets it in
    // the future, and the parser quietly turns an unreadable one into "now".
    date: isoDate(msg.internalDate, parsed?.date, env.date),
    text,
    snippet: cleanText(text.replace(/\s+/g, ' ').trim(), 200),
    to: parsed ? addressList(parsed.to).slice(0, 10) : [],
    cc: parsed ? addressList(parsed.cc).slice(0, 10) : [],
    in_reply_to: cleanText(parsed?.inReplyTo || env.inReplyTo || '', 500).trim(),
    references: references.slice(0, 5).map((r) => cleanText(r, 500)),
    attachments: (parsed?.attachments || []).slice(0, 10).map((a) => ({
      filename: cleanText(a.filename, 300),
      size: Number(a.size) || 0,
      contentType: cleanText(a.contentType, 200),
    })),
    seen: flags.includes('\\Seen'),
  };
}

/**
 * Read INBOX messages newer than what we already have. With no prior state
 * (first sync, or the mailbox was rebuilt and UIDVALIDITY changed) it takes
 * the newest `initialLimit` messages from the last `initialDays` days.
 * Reading never marks a message as read: the fetch uses BODY.PEEK.
 */
export async function fetchInboxMessages(account, password, {
  lastUid = 0, uidValidity = null, initialDays = 30, initialLimit = 150,
} = {}) {
  const client = makeImapClient(account, password);
  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      const currentValidity = client.mailbox?.uidValidity != null ? Number(client.mailbox.uidValidity) : null;
      const fresh = !lastUid || uidValidity == null || currentValidity !== Number(uidValidity);
      let uids = [];
      if (fresh) {
        const since = new Date(Date.now() - initialDays * 86_400_000);
        const found = await client.search({ since }, { uid: true });
        uids = (Array.isArray(found) ? found : []).sort((a, b) => a - b).slice(-initialLimit);
      } else {
        const found = await client.search({ uid: `${lastUid + 1}:*` }, { uid: true });
        // "N:*" always includes the last message even when its UID is below N.
        uids = (Array.isArray(found) ? found : []).filter((u) => u > lastUid).sort((a, b) => a - b);
      }

      const messages = [];
      let unreadable = 0;
      for (let i = 0; i < uids.length; i += FETCH_CHUNK) {
        const chunk = uids.slice(i, i + FETCH_CHUNK);
        const query = { uid: true, envelope: true, flags: true, internalDate: true, source: { maxLength: MAX_SOURCE_BYTES } };
        for await (const msg of client.fetch(chunk.join(','), query, { uid: true })) {
          try {
            messages.push(await parseMessage(msg, { ...account, uidValidity: currentValidity }));
          } catch (err) {
            // One message we cannot read must not stop the rest of the inbox.
            unreadable += 1;
            console.warn(`[mail] Skipped unreadable message uid ${msg?.uid}: ${err.message}`);
          }
        }
      }

      const newestKnown = Math.max(0, Number(client.mailbox?.uidNext || 1) - 1);
      const highest = uids.length ? uids[uids.length - 1] : (fresh ? newestKnown : lastUid);
      return {
        messages,
        // A fresh read starts the count again: after a rebuilt mailbox the old
        // number could sit above every new UID and hide new mail for good.
        lastUid: fresh ? highest : Math.max(lastUid, highest),
        uidValidity: currentValidity,
        fresh,
        unreadable,
      };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
}

function smtpUser(account) {
  // Apple wants the full address for SMTP; a short IMAP user name is not enough.
  const login = account.login || '';
  return login.includes('@') ? login : account.email;
}

/** Send through iCloud SMTP, then file a copy in the Sent folder (best effort). */
export async function sendMessage(account, password, { to, cc, bcc, subject, html, text, replyTo, fromName }) {
  const recipients = [to, cc, bcc].flat().filter(Boolean);
  // bcc is deliberately left out of the message itself: this builder would
  // write it into a Bcc header for every recipient to read. Hidden recipients
  // exist only in the SMTP envelope below.
  const mail = {
    from: fromName ? { name: fromName, address: account.email } : account.email,
    to, cc, subject, html, text, replyTo,
    date: new Date(),
    // Invoices carry the business logo as a data: image, which Gmail and
    // others refuse to show. This turns each one into a proper inline
    // attachment so the logo arrives.
    attachDataUrls: true,
  };

  // Build the raw message once so the Sent copy is byte-identical to what went out.
  const builder = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'windows' });
  const built = await builder.sendMail(mail);
  const raw = built.message;

  const transport = transports.smtp({
    host: account.smtp_host || ICLOUD_DEFAULTS.smtp_host,
    port: Number(account.smtp_port) || ICLOUD_DEFAULTS.smtp_port,
    secure: false,
    requireTLS: true,
    auth: { user: smtpUser(account), pass: password },
    connectionTimeout: CONNECT_TIMEOUT_MS,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  let info;
  try {
    info = await transport.sendMail({ envelope: { from: account.email, to: recipients }, raw });
  } catch (err) {
    throw new Error(friendlyMailError(err));
  } finally {
    transport.close();
  }

  let filedInSent = false;
  try {
    const client = makeImapClient(account, password);
    await client.connect();
    try {
      const boxes = await client.list();
      const sent = boxes.find((b) => b.specialUse === '\\Sent')
        || boxes.find((b) => /^sent( messages| items)?$/i.test(b.name || ''));
      if (sent) {
        await client.append(sent.path, raw, ['\\Seen'], new Date());
        filedInSent = true;
      }
    } finally {
      await client.logout().catch(() => {});
    }
  } catch {
    // The message is already sent; a missing Sent copy is not worth failing over.
  }

  // The id inside the raw message is the builder's; the SMTP step did not write one.
  return { messageId: built.messageId || info?.messageId || '', accepted: info?.accepted || recipients, filedInSent };
}
