// Stockage du leaderboard : PostgreSQL (add-on Clever Cloud) ou mémoire en fallback local.
import pg from 'pg';

const PERIODS = {
  all: null,
  week: '7 days',
  day: '1 day',
};

const MIGRATION = `
CREATE TABLE IF NOT EXISTS scores (
  id          SERIAL PRIMARY KEY,
  run_id      TEXT        NOT NULL UNIQUE,
  name        VARCHAR(16) NOT NULL,
  score       INTEGER     NOT NULL CHECK (score >= 0),
  wave        INTEGER     NOT NULL CHECK (wave >= 1),
  kills       INTEGER     NOT NULL CHECK (kills >= 0),
  droid       VARCHAR(16) NOT NULL,
  duration_ms INTEGER     NOT NULL CHECK (duration_ms >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scores_score_idx   ON scores (score DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS scores_created_idx ON scores (created_at DESC);
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function sslOption(mode) {
  return mode ? { rejectUnauthorized: false } : false;
}

// Essaie SSL puis sans SSL (sauf si PG_SSL est forcé), avec quelques tentatives
// pour laisser le temps à la base de répondre au démarrage.
async function connectPool(uri) {
  const forced = process.env.PG_SSL;
  const modes = forced === 'true' ? [true] : forced === 'false' ? [false] : [true, false];
  const max = Number(process.env.PG_POOL_MAX) || 4; // plan DEV Clever Cloud : 5 connexions max
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt++) {
    for (const ssl of modes) {
      const pool = new pg.Pool({
        connectionString: uri,
        ssl: sslOption(ssl),
        max,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
      });
      try {
        const client = await pool.connect();
        client.release();
        pool.on('error', (err) => console.error('[db] erreur pool :', err.message));
        console.log(`[db] PostgreSQL connecté (ssl=${ssl}, pool=${max})`);
        return pool;
      } catch (err) {
        lastErr = err;
        await pool.end().catch(() => {});
      }
    }
    console.warn(`[db] connexion échouée (tentative ${attempt}/5) : ${lastErr?.message}`);
    await sleep(1000 * attempt);
  }
  throw lastErr;
}

function pgStore(pool) {
  return {
    kind: 'postgres',
    async top(period, limit) {
      const interval = PERIODS[period] ?? null;
      const { rows } = await pool.query(
        `SELECT name, score, wave, kills, droid, duration_ms, created_at
           FROM scores
          WHERE ($1::interval IS NULL OR created_at > now() - $1::interval)
          ORDER BY score DESC, created_at ASC
          LIMIT $2`,
        [interval, limit],
      );
      return rows.map((r) => ({
        name: r.name,
        score: r.score,
        wave: r.wave,
        kills: r.kills,
        droid: r.droid,
        durationMs: r.duration_ms,
        createdAt: r.created_at,
      }));
    },
    async insert(entry) {
      const { rows } = await pool.query(
        `INSERT INTO scores (run_id, name, score, wave, kills, droid, duration_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (run_id) DO NOTHING
         RETURNING id`,
        [entry.runId, entry.name, entry.score, entry.wave, entry.kills, entry.droid, entry.durationMs],
      );
      if (!rows.length) return null; // run déjà enregistré
      const rank = await pool.query('SELECT COUNT(*)::int + 1 AS rank FROM scores WHERE score > $1', [entry.score]);
      return { rank: rank.rows[0].rank };
    },
    async close() {
      await pool.end();
    },
  };
}

function memoryStore() {
  const rows = [];
  const runIds = new Set();
  return {
    kind: 'memory',
    async top(period, limit) {
      const interval = PERIODS[period];
      const minDate = interval === '7 days' ? Date.now() - 7 * 864e5 : interval === '1 day' ? Date.now() - 864e5 : 0;
      return rows
        .filter((r) => r.createdAt.getTime() > minDate)
        .sort((a, b) => b.score - a.score || a.createdAt - b.createdAt)
        .slice(0, limit)
        .map(({ runId, ...pub }) => pub);
    },
    async insert(entry) {
      if (runIds.has(entry.runId)) return null;
      runIds.add(entry.runId);
      rows.push({ ...entry, createdAt: new Date() });
      if (rows.length > 2000) {
        rows.sort((a, b) => b.score - a.score);
        rows.length = 1000;
      }
      return { rank: rows.filter((r) => r.score > entry.score).length + 1 };
    },
    async close() {},
  };
}

export async function createStore() {
  const uri = process.env.POSTGRESQL_ADDON_URI || process.env.DATABASE_URL;
  if (!uri) {
    console.warn('[db] POSTGRESQL_ADDON_URI absent : leaderboard en mémoire (perdu au redémarrage)');
    return memoryStore();
  }
  const pool = await connectPool(uri);
  await pool.query(MIGRATION);
  return pgStore(pool);
}

export const VALID_PERIODS = Object.keys(PERIODS);
