import { createClient } from '@supabase/supabase-js';

const CHALLONGE_BASE_URL = 'https://api.challonge.com/v2.1';
const CHALLONGE_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/vnd.api+json',
  'Authorization-Type': 'v1',
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
    body: JSON.stringify(body, null, 2),
  };
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function getSupabase() {
  const url = requiredEnv('VITE_SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY');
  return createClient(url, key, { auth: { persistSession: false } });
}

function getChallongeHeaders() {
  return { ...CHALLONGE_HEADERS, Authorization: requiredEnv('CHALLONGE_API_KEY') };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) {
    const message = data?.errors?.detail || data?.errors?.[0]?.detail || data?.message || data?.error || text || `${response.status} ${response.statusText}`;
    throw new Error(`Challonge request failed: ${message}`);
  }
  return data;
}

function ensureJsonPath(path) {
  if (path.includes('?')) return path;
  if (path.endsWith('.json')) return path;
  return `${path}.json`;
}

async function challongeGet(path, query = {}) {
  const apiPath = path.startsWith('http') ? path : `${CHALLONGE_BASE_URL}${ensureJsonPath(path)}`;
  const url = new URL(apiPath);
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  });
  return fetchJson(url.toString(), { headers: getChallongeHeaders() });
}

function asArray(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.tournaments)) return payload.tournaments;
  if (Array.isArray(payload?.participants)) return payload.participants;
  if (Array.isArray(payload?.matches)) return payload.matches;
  if (Array.isArray(payload)) return payload;
  return payload?.data ? [payload.data] : [];
}

function attrs(item) { return item?.attributes || item?.tournament || item?.participant || item?.match || item || {}; }

function relationId(item, ...keys) {
  for (const key of keys) {
    const direct = item?.[key] ?? item?.attributes?.[key] ?? item?.match?.[key] ?? item?.participant?.[key];
    if (direct !== undefined && direct !== null) return String(direct);
    const rel = item?.relationships?.[key]?.data;
    if (rel?.id !== undefined && rel?.id !== null) return String(rel.id);
  }
  return null;
}

function tournamentName(tournament) {
  const a = attrs(tournament);
  return String(a.name || a.full_name || a.fullName || tournament.name || `Challonge ${tournament.id}`).trim();
}

function participantName(participant) {
  const a = attrs(participant);
  return String(a.name || a.display_name || a.displayName || a.username || participant.name || `Participant ${participant.id}`).trim();
}

function parseTeamAndManager(name) {
  const clean = String(name || '').trim();
  const bracketed = clean.match(/^(.*?)\s*[–—-]?\s*\((.*?)\)\s*$/);
  if (bracketed) return { teamName: bracketed[1].trim() || clean, managerName: bracketed[2].trim() || 'TBC Manager' };
  return { teamName: clean, managerName: 'TBC Manager' };
}

function parseScores(match) {
  const a = attrs(match);
  const scores = a.scores_csv || a.scoresCsv || a.score_csv || a.scoreCsv || a.scores || a.score;
  if (typeof scores === 'string') {
    const first = scores.split(',')[0].trim();
    const found = first.match(/(-?\d+)\s*[-:]\s*(-?\d+)/);
    if (found) return { home_score: Number(found[1]), away_score: Number(found[2]) };
  }
  const home = a.player1_score ?? a.player1Score ?? a.home_score ?? a.homeScore ?? a.team1_score ?? a.team1Score;
  const away = a.player2_score ?? a.player2Score ?? a.away_score ?? a.awayScore ?? a.team2_score ?? a.team2Score;
  if (home !== undefined && away !== undefined && home !== null && away !== null) return { home_score: Number(home), away_score: Number(away) };
  return { home_score: null, away_score: null };
}

function matchRound(match) {
  const a = attrs(match);
  const raw = a.round ?? a.round_number ?? a.roundNumber ?? a.identifier ?? 'Round';
  const number = Number(raw);
  if (Number.isFinite(number)) {
    if (number < 0) return `Losers R${Math.abs(number)}`;
    if (number === 1) return 'R32';
    if (number === 2) return 'R16';
    if (number === 3) return 'QF';
    if (number === 4) return 'SF';
    if (number >= 5) return 'Final';
  }
  return String(raw || 'Round');
}

function matchOrder(match, index) {
  const a = attrs(match);
  return Number(a.suggested_play_order || a.suggestedPlayOrder || a.match_order || a.matchOrder || a.identifier || index + 1) || index + 1;
}

function matchStatus(match, score) {
  const state = String(attrs(match).state || attrs(match).status || '').toLowerCase();
  if (state.includes('complete') || state.includes('played') || state === 'closed' || state === 'complete') return 'played';
  if (Number.isFinite(score.home_score) && Number.isFinite(score.away_score)) return 'played';
  return 'scheduled';
}

async function findOrCreate(supabase, table, match, row) {
  const existing = await supabase.from(table).select('id').match(match).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return existing.data.id;
  const created = await supabase.from(table).insert(row).select('id').single();
  if (created.error) throw created.error;
  return created.data.id;
}

async function updateActualEntries(supabase, tournamentId) {
  const count = await supabase.from('tournament_entries').select('id', { count: 'exact', head: true }).eq('tournament_id', tournamentId);
  await supabase.from('tournaments').update({ actual_entries: count.count || 0 }).eq('id', tournamentId);
}

async function listTournaments(event) {
  const page = event.queryStringParameters?.page || '1';
  const perPage = event.queryStringParameters?.perPage || '25';
  const payload = await challongeGet('/tournaments', { 'page[number]': page, 'page[size]': perPage });
  return json(200, {
    ok: true,
    authMode: 'v1_api_key',
    tournaments: asArray(payload).map((item) => ({ id: String(item.id || attrs(item).id), name: tournamentName(item), attributes: attrs(item) })),
  });
}

async function importTournament(event) {
  const body = JSON.parse(event.body || '{}');
  const challongeTournamentId = String(body.challongeTournamentId || body.tournamentId || '').trim();
  if (!challongeTournamentId) return json(400, { ok: false, error: 'Missing challongeTournamentId' });

  const supabase = getSupabase();
  const [tournamentPayload, participantsPayload, matchesPayload] = await Promise.all([
    challongeGet(`/tournaments/${encodeURIComponent(challongeTournamentId)}`),
    challongeGet(`/tournaments/${encodeURIComponent(challongeTournamentId)}/participants`, { 'page[size]': 250 }),
    challongeGet(`/tournaments/${encodeURIComponent(challongeTournamentId)}/matches`, { 'page[size]': 250 }),
  ]);

  const tournamentItem = asArray(tournamentPayload)[0] || tournamentPayload.data || tournamentPayload.tournament || tournamentPayload;
  const participants = asArray(participantsPayload);
  const challongeMatches = asArray(matchesPayload);
  const importedTournamentName = body.tournamentName || tournamentName(tournamentItem);
  const seasonCode = body.seasonCode || 'Imported';
  const competitionName = body.competitionName || 'Challonge Import';

  const seasonNumber = Number(String(seasonCode).replace(/[^0-9]/g, '')) || null;
  const seasonId = await findOrCreate(supabase, 'seasons', { code: seasonCode }, { code: seasonCode, number: seasonNumber });
  const competitionId = await findOrCreate(supabase, 'competitions', { name: competitionName }, { name: competitionName, competition_type: body.competitionType || 'imported' });

  const existingTournament = await supabase.from('tournaments').select('id').eq('source', 'challonge').eq('source_id', challongeTournamentId).maybeSingle();
  if (existingTournament.error) throw existingTournament.error;

  let tournamentId = existingTournament.data?.id;
  if (!tournamentId) {
    const created = await supabase.from('tournaments').insert({
      season_id: seasonId,
      competition_id: competitionId,
      name: importedTournamentName,
      status: body.status || 'archived',
      format: body.format || 'challonge_import',
      source: 'challonge',
      source_id: challongeTournamentId,
      max_entries: participants.length,
      actual_entries: participants.length,
      group_count: body.groupCount || null,
      teams_per_group: body.teamsPerGroup || null,
      knockout_teams: body.knockoutTeams || null,
      secondary_bracket_name: body.secondaryBracketName || null,
      rules_notes: 'Imported from Challonge API v1-key auth',
    }).select('id').single();
    if (created.error) throw created.error;
    tournamentId = created.data.id;
  } else {
    const updated = await supabase.from('tournaments').update({ name: importedTournamentName, max_entries: participants.length, actual_entries: participants.length }).eq('id', tournamentId);
    if (updated.error) throw updated.error;
  }

  const participantToEntry = new Map();
  let importedParticipants = 0;
  for (const participant of participants) {
    const participantAttrs = attrs(participant);
    const challongeParticipantId = String(participant.id || participantAttrs.id);
    const { teamName, managerName } = parseTeamAndManager(participantName(participant));
    const seed = Number(participantAttrs.seed || participantAttrs.rank || importedParticipants + 1) || importedParticipants + 1;
    const teamId = await findOrCreate(supabase, 'teams', { name: teamName }, { name: teamName, active: true });
    const managerId = await findOrCreate(supabase, 'managers', { name: managerName }, { name: managerName, display_name: managerName, canonical_name: managerName.toLowerCase(), active: true });

    const existingEntry = await supabase.from('tournament_entries').select('id').eq('tournament_id', tournamentId).eq('team_id', teamId).maybeSingle();
    if (existingEntry.error) throw existingEntry.error;
    let entryId = existingEntry.data?.id;
    const entryRow = { tournament_id: tournamentId, team_id: teamId, manager_id: managerId, seed, rating: null, entry_status: 'active', prize_draw_eligible: true, notes: `challonge_participant_id:${challongeParticipantId}` };
    if (!entryId) {
      const createdEntry = await supabase.from('tournament_entries').insert(entryRow).select('id').single();
      if (createdEntry.error) throw createdEntry.error;
      entryId = createdEntry.data.id;
    } else {
      const updatedEntry = await supabase.from('tournament_entries').update(entryRow).eq('id', entryId);
      if (updatedEntry.error) throw updatedEntry.error;
    }
    participantToEntry.set(challongeParticipantId, entryId);
    importedParticipants += 1;
  }

  let importedMatches = 0;
  let updatedMatches = 0;
  for (let index = 0; index < challongeMatches.length; index += 1) {
    const match = challongeMatches[index];
    const a = attrs(match);
    const challongeMatchId = String(match.id || a.id || a.match_id || a.matchId || index + 1);
    const player1 = relationId(match, 'player1', 'player1_id', 'player1Id', 'participant1', 'participant1_id', 'participant1Id');
    const player2 = relationId(match, 'player2', 'player2_id', 'player2Id', 'participant2', 'participant2_id', 'participant2Id');
    const homeEntryId = player1 ? participantToEntry.get(String(player1)) : null;
    const awayEntryId = player2 ? participantToEntry.get(String(player2)) : null;
    const score = parseScores(match);
    const status = matchStatus(match, score);
    const winnerParticipantId = relationId(match, 'winner', 'winner_id', 'winnerId');
    const loserParticipantId = relationId(match, 'loser', 'loser_id', 'loserId');

    const row = {
      tournament_id: tournamentId,
      stage: body.stage || 'knockout',
      round: body.round || matchRound(match),
      leg: 1,
      match_order: matchOrder(match, index),
      scheduled_at: a.scheduled_time || a.scheduledTime || null,
      fixture_date: a.scheduled_time ? String(a.scheduled_time).slice(0, 10) : null,
      home_entry_id: homeEntryId || null,
      away_entry_id: awayEntryId || null,
      home_placeholder: homeEntryId ? null : (player1 ? `Challonge participant ${player1}` : 'TBC'),
      away_placeholder: awayEntryId ? null : (player2 ? `Challonge participant ${player2}` : 'TBC'),
      home_score: Number.isFinite(score.home_score) ? score.home_score : null,
      away_score: Number.isFinite(score.away_score) ? score.away_score : null,
      winner_entry_id: winnerParticipantId ? participantToEntry.get(String(winnerParticipantId)) || null : null,
      loser_entry_id: loserParticipantId ? participantToEntry.get(String(loserParticipantId)) || null : null,
      status,
      source_id: challongeTournamentId,
      challonge_match_id: challongeMatchId,
      bracket: body.bracket || 'Cup',
      played_at: status === 'played' ? (a.completed_at || a.completedAt || new Date().toISOString()) : null,
      published: true,
    };

    const existingMatch = await supabase.from('matches').select('id').eq('tournament_id', tournamentId).eq('challonge_match_id', challongeMatchId).maybeSingle();
    if (existingMatch.error) throw existingMatch.error;
    if (existingMatch.data?.id) {
      const updated = await supabase.from('matches').update(row).eq('id', existingMatch.data.id);
      if (updated.error) throw updated.error;
      updatedMatches += 1;
    } else {
      const created = await supabase.from('matches').insert(row);
      if (created.error) throw created.error;
      importedMatches += 1;
    }
  }

  await updateActualEntries(supabase, tournamentId);
  return json(200, { ok: true, authMode: 'v1_api_key', tournamentId, importedTournamentName, importedParticipants, importedMatches, updatedMatches, challongeTournamentId });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  try {
    if (event.httpMethod === 'GET') return await listTournaments(event);
    if (event.httpMethod === 'POST') return await importTournament(event);
    return json(405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    console.error(error);
    return json(500, { ok: false, error: error.message });
  }
}
