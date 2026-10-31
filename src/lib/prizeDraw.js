// Prize draws are run on the server (run_prize_draw). Each candidate's rank is
// sha256(seed + ':' + key) as lowercase hex, lowest first; the first N are the
// winners. This module re-computes that ranking in the browser so anyone can
// check a published draw from its seed and candidate list.

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function rankCandidates(seed, candidates) {
  const hashed = await Promise.all((candidates || []).map(async (candidate) => ({
    ...candidate,
    hash: await sha256Hex(`${seed}:${String(candidate.key || '').trim()}`),
  })));
  return hashed.sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0)).map((row, index) => ({ ...row, rank: index + 1 }));
}

export async function verifyDraw(draw) {
  if (!draw?.seed || !Array.isArray(draw.candidates)) return { ok: false, message: 'This draw has no seed or candidate list.' };
  if (!globalThis.crypto?.subtle) return { ok: false, message: 'This browser cannot compute SHA-256.' };
  const ranked = await rankCandidates(draw.seed, draw.candidates);
  const expected = ranked.slice(0, draw.winners_count).map((row) => row.key);
  const recorded = (draw.winners || []).map((row) => row.key);
  const ok = expected.length === recorded.length && expected.every((key, index) => key === recorded[index]);
  return {
    ok,
    ranked,
    message: ok
      ? `Verified: re-ranking all ${draw.candidates.length} entries from the published seed gives the same ${draw.winners_count} winner${draw.winners_count === 1 ? '' : 's'} in the same order.`
      : 'Verification failed: the recomputed winners do not match the recorded result.',
  };
}

// Candidate keys must be unique and stable. Managers use their id; names typed
// in by hand use their lower-cased name.
export function managerCandidate(row) {
  return { key: `manager:${row.manager_id}`, name: row.manager_name, club: row.team_name || null, manager_id: row.manager_id };
}

export function namedCandidate(name) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim();
  return { key: `name:${clean.toLowerCase()}`, name: clean, club: null, manager_id: null };
}

export function parseNameList(text) {
  const seen = new Set();
  return String(text || '')
    .split(/[\n,;]+/)
    .map(namedCandidate)
    .filter((candidate) => candidate.name && !seen.has(candidate.key) && seen.add(candidate.key));
}

export function formatDrawDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
