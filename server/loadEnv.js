// Load .env into process.env BEFORE any other module initializes.
// This must be the very first import in index.js: ES module imports are
// hoisted and evaluated before the importer's body runs, so modules that
// read process.env at their top level (supabaseAdmin.js, routes/push.js)
// would otherwise capture values from before the .env file was parsed.
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const envFile = readFileSync(join(__dirname, '.env'), 'utf8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    process.env[key] = val; // always override
  }
} catch { /* .env not found — rely on real env vars */ }
