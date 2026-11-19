import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanName, maxPlausibleScore, newRun, validateSubmission } from '../server/scoring.js';

const SECRET = 'test-secret';

function submission(overrides = {}, now = Date.now()) {
  const run = newRun(SECRET, now - 120_000); // partie lancée il y a 2 min
  return { ...run, name: 'Pilote', score: 4200, wave: 4, kills: 25, droid: 'striker', durationMs: 90_000, ...overrides };
}

test('accepte une soumission cohérente', () => {
  const r = validateSubmission(submission(), { secret: SECRET });
  assert.equal(r.ok, true);
  assert.equal(r.entry.name, 'Pilote');
});

test('rejette un jeton falsifié ou signé avec un autre secret', () => {
  assert.equal(validateSubmission(submission({ token: 'abc' }), { secret: SECRET }).ok, false);
  assert.equal(validateSubmission(submission(), { secret: 'autre' }).ok, false);
});

test('rejette une durée supérieure au temps réellement écoulé', () => {
  const r = validateSubmission(submission({ durationMs: 10 * 60_000 }), { secret: SECRET });
  assert.equal(r.ok, false);
});

test('rejette une vague atteinte trop vite', () => {
  const r = validateSubmission(submission({ wave: 30, kills: 200, durationMs: 20_000 }), { secret: SECRET });
  assert.equal(r.ok, false);
});

test('rejette un score impossible', () => {
  const r = validateSubmission(submission({ score: maxPlausibleScore(4, 25) + 1 }), { secret: SECRET });
  assert.equal(r.ok, false);
});

test('rejette un droïde inconnu', () => {
  assert.equal(validateSubmission(submission({ droid: 'tank' }), { secret: SECRET }).ok, false);
});

test('nettoie et valide les pseudos', () => {
  assert.equal(cleanName('  Néo   Pilote '), 'Néo Pilote');
  assert.equal(cleanName('x'), null);
  assert.equal(cleanName('<script>'), null);
  assert.equal(cleanName('a'.repeat(17)), null);
  assert.equal(cleanName(42), null);
});
