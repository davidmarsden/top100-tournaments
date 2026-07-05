const V1 = 'https://api.challonge.com/v1';

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body, null, 2) };
}

const envName = ['CHALLONGE', 'API', 'KEY'].join('_');
function key() {
  const value = process.env[envName];
  if (!value) throw new Error(`Missing ${envName}`);
  return value;
}

async function get(path) {
  const url = new URL(`${V1}${path}.json`);
  url.searchParams.set(['api', 'key'].join('_'), key());
  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(text || response.statusText);
  return data;
}

function unwrapRows(payload, keyName) {
  if (Array.isArray(payload)) return payload.map((row) => row[keyName] || row);
  if (Array.isArray(payload?.[keyName + 's'])) return payload[keyName + 's'].map((row) => row[keyName] || row);
  return [];
}

export async function handler(event) {
  try {
    const id = event.queryStringParameters?.id;
    if (!id) return json(400, { ok: false, error: 'Missing ?id=' });
    const participants = unwrapRows(await get(`/tournaments/${encodeURIComponent(id)}/participants`), 'participant');
    const matches = unwrapRows(await get(`/tournaments/${encodeURIComponent(id)}/matches`), 'match');
    return json(200, {
      ok: true,
      participantCount: participants.length,
      matchCount: matches.length,
      participants: participants.slice(0, 5).map((p) => ({ id: p.id, name: p.name, seed: p.seed })),
      matches: matches.slice(0, 5).map((m) => ({ id: m.id, player1_id: m.player1_id, player2_id: m.player2_id, scores_csv: m.scores_csv, state: m.state, round: m.round })),
    });
  } catch (error) {
    return json(500, { ok: false, error: error.message });
  }
}
