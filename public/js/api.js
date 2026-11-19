// Client de l'API leaderboard.
async function request(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* réponse vide */
  }
  if (!res.ok) throw new Error(data?.error || `Erreur ${res.status}`);
  return data;
}

export const api = {
  startRun: () => request('/api/runs', { method: 'POST', body: '{}' }),
  submitScore: (payload) => request('/api/scores', { method: 'POST', body: JSON.stringify(payload) }),
  topScores: (period = 'all', limit = 10) => request(`/api/scores?period=${encodeURIComponent(period)}&limit=${limit}`),
};
