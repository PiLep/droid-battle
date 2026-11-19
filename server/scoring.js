// Règles de validation des scores (anti-triche basique côté serveur).
// Doivent rester cohérentes avec public/js/config.js (SCORING).
import crypto from 'node:crypto';

export const DROIDS = ['striker', 'titan', 'viper'];
export const MAX_MULTIPLIER = 8;
export const MAX_KILL_POINTS = 500; // brute, l'ennemi standard le plus rentable
export const BOSS_POINTS = 5000; // × niveau du boss (vague / 5)
export const WAVE_BONUS = 250; // × vague
export const PERFECT_BONUS = 100; // × vague + 500
export const MIN_MS_PER_WAVE = 5000;

const NAME_RE = /^[\p{L}\p{N} _.\-]{2,16}$/u;

export function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.normalize('NFC').replace(/\s+/g, ' ').trim();
  return NAME_RE.test(name) ? name : null;
}

export function maxPlausibleScore(wave, kills) {
  const bosses = Math.floor(wave / 5);
  const bossPts = (BOSS_POINTS * bosses * (bosses + 1)) / 2;
  const wavePts = ((WAVE_BONUS + PERFECT_BONUS) * wave * (wave + 1)) / 2 + 500 * wave;
  return MAX_MULTIPLIER * (kills * MAX_KILL_POINTS + bossPts) + wavePts;
}

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// Renvoie { ok: true, entry } ou { ok: false, error }
export function validateSubmission(body, { secret, now = Date.now() }) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Requête invalide' };
  const { runId, startedAt, token, score, wave, kills, droid, durationMs } = body;

  if (typeof runId !== 'string' || !/^[a-f0-9]{32}$/.test(runId)) return { ok: false, error: 'Run invalide' };
  if (!Number.isInteger(startedAt) || typeof token !== 'string') return { ok: false, error: 'Run invalide' };
  if (!verifyRunToken(secret, runId, startedAt, token)) return { ok: false, error: 'Jeton de partie invalide' };

  const name = cleanName(body.name);
  if (!name) return { ok: false, error: 'Pseudo invalide (2 à 16 caractères : lettres, chiffres, espace, _ . -)' };
  if (!DROIDS.includes(droid)) return { ok: false, error: 'Droïde inconnu' };
  if (!isInt(wave, 1, 9999) || !isInt(kills, 0, wave * 80) || !isInt(score, 0, 2_000_000_000)) {
    return { ok: false, error: 'Statistiques incohérentes' };
  }
  if (!isInt(durationMs, 0, 12 * 3600_000)) return { ok: false, error: 'Durée incohérente' };

  const elapsed = now - startedAt;
  if (elapsed < 0 || elapsed > 12 * 3600_000) return { ok: false, error: 'Partie expirée' };
  if (durationMs > elapsed + 3000) return { ok: false, error: 'Durée incohérente' };
  if (durationMs < (wave - 1) * MIN_MS_PER_WAVE) return { ok: false, error: 'Durée incohérente' };
  if (score > maxPlausibleScore(wave, kills)) return { ok: false, error: 'Score incohérent' };

  return { ok: true, entry: { runId, name, score, wave, kills, droid, durationMs } };
}

export function signRun(secret, runId, startedAt) {
  return crypto.createHmac('sha256', secret).update(`${runId}.${startedAt}`).digest('base64url');
}

export function verifyRunToken(secret, runId, startedAt, token) {
  const expected = Buffer.from(signRun(secret, runId, startedAt));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export function newRun(secret, now = Date.now()) {
  const runId = crypto.randomBytes(16).toString('hex');
  return { runId, startedAt: now, token: signRun(secret, runId, now) };
}
