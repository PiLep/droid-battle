// Serveur Droid Battle : sert le jeu statique + API du leaderboard.
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createStore, VALID_PERIODS } from './db.js';
import { newRun, validateSubmission } from './scoring.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080; // Clever Cloud (Docker) attend le port 8080

let SECRET = process.env.SCORE_SECRET;
if (!SECRET) {
  SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('[server] SCORE_SECRET absent : secret aléatoire (les parties en cours sont invalidées au redémarrage)');
}

// --- Stockage (avec mode dégradé si la base ne répond pas) -----------------
let store = null;
let storeError = null;

async function initStore() {
  try {
    store = await createStore();
    storeError = null;
  } catch (err) {
    storeError = err;
    console.error('[db] base indisponible, nouvel essai dans 15 s :', err.message);
    setTimeout(initStore, 15_000).unref();
  }
}

function requireStore(res) {
  if (store) return true;
  res.status(503).json({ error: 'Leaderboard momentanément indisponible' });
  return false;
}

// --- Limitation de débit très simple, en mémoire ---------------------------
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [key, list] of hits) {
      const fresh = list.filter((t) => now - t < windowMs);
      if (fresh.length) hits.set(key, fresh);
      else hits.delete(key);
    }
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip;
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      res.set('Retry-After', String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: 'Trop de requêtes, réessaie dans un instant' });
    }
    list.push(now);
    hits.set(key, list);
    next();
  };
}

// --- App --------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? 1)); // reverse proxy Clever Cloud

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'self'",
  });
  next();
});

app.use(express.json({ limit: '2kb' }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: store ? store.kind : 'down' });
});

app.post('/api/runs', rateLimit({ windowMs: 10 * 60_000, max: 60 }), (req, res) => {
  res.json(newRun(SECRET));
});

app.get('/api/scores', async (req, res, next) => {
  if (!requireStore(res)) return;
  const period = VALID_PERIODS.includes(req.query.period) ? req.query.period : 'all';
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
  try {
    const scores = await store.top(period, limit);
    res.set('Cache-Control', 'no-store');
    res.json({ period, scores });
  } catch (err) {
    next(err);
  }
});

app.post('/api/scores', rateLimit({ windowMs: 10 * 60_000, max: 12 }), async (req, res, next) => {
  if (!requireStore(res)) return;
  const result = validateSubmission(req.body, { secret: SECRET });
  if (!result.ok) return res.status(400).json({ error: result.error });
  try {
    const saved = await store.insert(result.entry);
    if (!saved) return res.status(409).json({ error: 'Cette partie a déjà été enregistrée' });
    res.status(201).json({ rank: saved.rank });
  } catch (err) {
    next(err);
  }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Route inconnue' }));

// Polices auto-hébergées (pas d'appel à Google Fonts)
const fontOpts = { maxAge: '30d', immutable: true };
app.use('/fonts/orbitron', express.static(path.join(ROOT, 'node_modules/@fontsource/orbitron/files'), fontOpts));
app.use('/fonts/rajdhani', express.static(path.join(ROOT, 'node_modules/@fontsource/rajdhani/files'), fontOpts));

// HTML/JS/CSS revalidés à chaque chargement (ETag => 304) : pas de mélange de versions après un déploiement
app.use(
  express.static(path.join(ROOT, 'public'), {
    setHeaders(res, filePath) {
      res.set('Cache-Control', /\.(html|js|css)$/.test(filePath) ? 'no-cache' : 'public, max-age=86400');
    },
  }),
);

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Requête invalide' });
  }
  console.error('[server]', err);
  res.status(500).json({ error: 'Erreur serveur' });
});

const server = app.listen(PORT, () => console.log(`[server] Droid Battle sur http://localhost:${PORT}`));
initStore();

function shutdown(signal) {
  console.log(`[server] ${signal} reçu, arrêt…`);
  server.close(async () => {
    await store?.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
