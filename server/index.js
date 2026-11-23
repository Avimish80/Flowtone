import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import aiRoutes from './routes/ai.js';
import pushRoutes from './routes/push.js';
import gmailRoutes from './routes/gmail.js';
import calendarRoutes from './routes/calendar.js';
import billingRoutes, { handleStripeWebhook } from './routes/billing.js';
import meRoutes from './routes/me.js';
import publicRoutes from './routes/public.js';
import calendarClassifyRoutes from './routes/calendarClassify.js';
import mailRoutes from './routes/mail.js';
import { requireAuthenticatedUser } from './lib/auth.js';
import { startScheduler } from './scheduler.js';

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
      // The iOS app (Capacitor) serves its bundle from capacitor://localhost
      if (origin === 'capacitor://localhost') return callback(null, true);
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
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), handleStripeWebhook);
// An invoice email carries the business logo inside its HTML, far past the
// default 100 KB. This parser runs first for that one route; the general one
// below then leaves the already-parsed body alone.
app.use('/api/mail/send', express.json({ limit: '8mb' }));
app.use(express.json());

// ─── Routes ────────────────────────────────────────────────────────
app.use('/api/ai', requireAuthenticatedUser, aiRoutes);
app.use('/api/ai', requireAuthenticatedUser, calendarClassifyRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/gmail', gmailRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/mail', mailRoutes);
app.use('/api/billing', billingRoutes);
app.use('/api/me', meRoutes);
app.use('/api/public', publicRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Flowtone server running on http://localhost:${PORT}`);
  startScheduler();
});
