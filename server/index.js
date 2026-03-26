import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import cors from 'cors';
import aiRoutes from './routes/ai.js';
import pushRoutes from './routes/push.js';
import gmailRoutes from './routes/gmail.js';
import { startScheduler } from './scheduler.js';

// Load .env manually — works even if env vars are pre-set to empty
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

const app = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ──────────────────────────────────────────────────────────
// ALLOWED_ORIGINS env var can be a comma-separated list of production origins.
// Falls back to allowing any https:// if not set (safe default for personal apps).
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : null;

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. native apps, same-origin PWA)
      if (!origin) return callback(null, true);
      // Always allow localhost for development
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin)) return callback(null, true);
      // Allow local network IPs (phone on same WiFi during dev)
      if (/^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/.test(origin)) return callback(null, true);
      if (/^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/.test(origin)) return callback(null, true);
      // If ALLOWED_ORIGINS is set, enforce whitelist; otherwise allow any https://
      if (ALLOWED_ORIGINS) {
        if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
        return callback(new Error(`CORS: origin not allowed — ${origin}`));
      }
      if (origin.startsWith('https://')) return callback(null, true);
      callback(new Error(`CORS: origin not allowed — ${origin}`));
    },
    credentials: true,
  })
);

// ─── Body Parser ───────────────────────────────────────────────────
app.use(express.json());

// ─── Routes ────────────────────────────────────────────────────────
app.use('/api/ai', aiRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/gmail', gmailRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`GigFlow server running on http://localhost:${PORT}`);
  startScheduler();
});
