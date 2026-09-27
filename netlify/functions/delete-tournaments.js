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

async function selectAll(builder, pageSize=1000) {
  const rows=[];
  for(let from=0;;from+=pageSize){
    const {data,error}=await builder(from,from+pageSize-1);
    if(error) throw error;
    rows.push(...(data||[]));
    if((data||[]).length<pageSize) return rows;
  }
}

async function deleteByTournament(db, table, ids) {
  const { error } = await db.from(table).delete().in('tournament_id', ids);
  if (error && !String(error.message || '').includes('does not exist')) throw error;
}

async function deleteByMatch(db, table, ids) {
  const batchSize = 250;
  for (let offset = 0; offset < ids.length; offset += batchSize) {
    const { error } = await db.from(table).delete().in('match_id', ids.slice(offset, offset + batchSize));
    if (error && !String(error.message || '').includes('does not exist')) throw error;
  }
}

async function deleteMatchesForTournamentTeardown(db, ids) {
  // Knockout-only matches cannot be deleted individually. Give the service-role
  // maintenance path an explicit transaction-safe teardown RPC, then remove any
  // remaining standard/legacy fixtures normally.
  for (const tournamentId of ids) {
    const { error } = await db.rpc('delete_knockout_matches_for_tournament_teardown', {
      p_tournament_id: tournamentId,
    });
    if (error) throw error;
  }
  await deleteByTournament(db, 'matches', ids);
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
    const matchRows = await selectAll((from,to)=>db.from('matches').select('id').in('tournament_id',ids).range(from,to));
    const matchIds = matchRows.map((row) => row.id);

    // Arrangement cascades enqueue bounded evidence keys; the scheduled cleanup
    // worker removes Storage objects only after relational deletion succeeds.

    await deleteByTournament(db, 'match_comments', ids);
    await deleteByTournament(db, 'achievements', ids);
    await deleteByTournament(db, 'honours', ids);
    await deleteByTournament(db, 'tournament_round_dates', ids);
    await deleteByMatch(db, 'forfeits', matchIds);
    await deleteByMatch(db, 'match_comments', matchIds);
    await deleteMatchesForTournamentTeardown(db, ids);
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
