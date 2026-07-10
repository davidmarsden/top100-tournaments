import { createClient } from '@supabase/supabase-js';

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function env(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function adminClient() {
  return createClient(env('VITE_SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
}

function userClient(token) {
  return createClient(env('VITE_SUPABASE_URL'), env('VITE_SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
}

async function deleteByTournament(db, table, ids) {
  const { error } = await db.from(table).delete().in('tournament_id', ids);
  if (error && !String(error.message || '').includes('does not exist')) throw error;
}

async function deleteByMatch(db, table, ids) {
  if (!ids.length) return;
  const { error } = await db.from(table).delete().in('match_id', ids);
  if (error && !String(error.message || '').includes('does not exist')) throw error;
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });

  try {
    const authHeader = String(event.headers.authorization || event.headers.Authorization || '');
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) return json(401, { ok: false, error: 'Missing admin session' });

    const authDb = userClient(token);
    const { data: userData, error: userError } = await authDb.auth.getUser(token);
    if (userError || !userData?.user) return json(401, { ok: false, error: 'Invalid admin session' });
    const { data: isAdmin, error: adminError } = await authDb.rpc('is_admin');
    if (adminError || !isAdmin) return json(403, { ok: false, error: 'Admin access required' });

    const body = JSON.parse(event.body || '{}');
    const ids = [...new Set((body.ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (!ids.length) return json(400, { ok: false, error: 'No tournament IDs supplied' });

    const db = adminClient();
    const { data: matchRows, error: matchError } = await db.from('matches').select('id').in('tournament_id', ids);
    if (matchError) throw matchError;
    const matchIds = (matchRows || []).map((row) => row.id);

    await deleteByTournament(db, 'match_comments', ids);
    await deleteByTournament(db, 'achievements', ids);
    await deleteByTournament(db, 'honours', ids);
    await deleteByTournament(db, 'tournament_round_dates', ids);
    await deleteByMatch(db, 'forfeits', matchIds);
    await deleteByMatch(db, 'match_comments', matchIds);
    await deleteByTournament(db, 'matches', ids);
    await deleteByTournament(db, 'groups', ids);
    await deleteByTournament(db, 'tournament_entries', ids);
    await deleteByTournament(db, 'tournament_rounds', ids);
    await deleteByTournament(db, 'tournament_stages', ids);

    const { error: tournamentError } = await db.from('tournaments').delete().in('id', ids);
    if (tournamentError) throw tournamentError;

    return json(200, { ok: true, deletedTournamentIds: ids, deletedMatchCount: matchIds.length });
  } catch (error) {
    return json(500, { ok: false, error: error.message });
  }
}
