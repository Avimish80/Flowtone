import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import aiRoutes from './routes/ai.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ──────────────────────────────────────────────────────────
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. curl, mobile apps)
      if (!origin) return callback(null, true);
      // Allow localhost:5173 (Vite dev server)
      if (origin === 'http://localhost:5173') return callback(null, true);
      // Allow any https domain (production deployments)
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

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`GigFlow server running on http://localhost:${PORT}`);
});
