// Encrypts mail passwords at rest (AES-256-GCM). The key is MAIL_SECRET_KEY
// when set; otherwise it is derived from the Supabase service-role key, which
// the server already holds and which already grants full database access, so
// deriving from it widens nothing. Set MAIL_SECRET_KEY before moving to a new
// Supabase project, or every connected mailbox has to be reconnected once.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'crypto';

const VERSION = 'v1';
let cachedKey = null;
let warned = false;

function getKey() {
  if (cachedKey) return cachedKey;
  const explicit = process.env.MAIL_SECRET_KEY?.trim();
  if (explicit) {
    cachedKey = createHash('sha256').update(explicit, 'utf8').digest();
    return cachedKey;
  }
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!base) {
    throw new Error('MAIL_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set to store mail credentials.');
  }
  if (!warned) {
    warned = true;
    console.warn('[mail] MAIL_SECRET_KEY is not set; deriving the mail credential key from the service-role key.');
  }
  cachedKey = Buffer.from(hkdfSync('sha256', base, 'flowtone-mail-accounts', 'mail-credentials-v1', 32));
  return cachedKey;
}

export function encryptSecret(plain) {
  if (typeof plain !== 'string' || !plain) throw new Error('Nothing to encrypt');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.');
}

export function decryptSecret(stored) {
  const [version, ivB64, tagB64, dataB64] = String(stored || '').split('.');
  if (version !== VERSION || !ivB64 || !tagB64 || !dataB64) {
    throw new Error('Stored mail credential is unreadable; reconnect the mailbox.');
  }
  const key = getKey();
  try {
    // Everything that can reject a damaged value sits inside the try: a bad
    // IV or tag throws before any decryption starts.
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Stored mail credential could not be decrypted (key changed?); reconnect the mailbox.');
  }
}
