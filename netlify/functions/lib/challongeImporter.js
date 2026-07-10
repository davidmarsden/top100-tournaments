import { createClient } from '@supabase/supabase-js';

const CHALLONGE_V1 = 'https://api.challonge.com/v1';

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

function database() {
  return createClient(
    requiredEnv('VITE_SUPABASE_URL'),
    requiredEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
  );
}

async function challonge(path, query = {}) {
  const url = new URL(`${CHALLONGE_V1}${path}.json`);
  url.searchParams.set('api_key', requiredEnv('CHALLONGE_API_KEY'));
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.errors?.join?.(', ') || payload?.message || text || `Challonge ${response.status}`);
  return payload;
}

function unwrap(value, key) {
  if (Array.isArray(value)) return value.map((row) => row?.[key] || row).filter(Boolean);
  if (value?.[key]) return value[key];
  return value || null;
}

function slugify(value = '') {
  return String(value).trim().toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function seasonNumber(value = '') {
  const match = String(value).match(/(?:^|\b)S(?:eason)?\s*(\d+)|\b(\d+)\b/i);
  return Number(match?.[1] || match?.[2] || 0) || null;
}

function parseParticipantName(value = '') {
  const clean = String(value).trim();
  const match = clean.match(/^(.*?)\s*\((.*?)\)\s*$/);
  if (!match) return { teamName: clean || 'Unknown team', managerName: 'TBC Manager' };
  return { teamName: match[1].trim() || clean, managerName: match[2].trim() || 'TBC Manager' };
}

function parseScore(scoresCsv) {
  const first = String(scoresCsv || '').split(',')[0].trim();
  const match = first.match(/(-?\d+)\s*[-:]\s*(-?\d+)/);
  return match ? { home: Number(match[1]), away: Number(match[2]) } : { home: null, away: null };
}

function roundName(round) {
  const number = Number(round);
  if (!Number.isFinite(number)) return String(round || 'Round');
  if (number < 0) return `Losers R${Math.abs(number)}`;
  if (number === 1) return 'R32';
  if (number === 2) return 'R16';
  if (number === 3) return 'QF';
  if (number === 4) return 'SF';
  return 'Final';
}

async function findOrCreate(db, table, match, insertRow) {
  const existing = await db.from(table).select('id').match(match).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data?.id) return existing.data.id;
  const created = await db.from(table).insert(insertRow).select('id').single();
  if (created.error) throw created.error;
  return created.data.id;
}

async function listTournaments() {
  const rows = unwrap(await challonge('/tournaments'), 'tournament') || [];
  return json(200, {
    ok: true,
    authMode: 'legacy v1 direct',
    tournaments: rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      attributes: row,
    })),
  });
}

async function loadTournamentBundle(id) {
  const [tournamentPayload, participantsPayload, matchesPayload] = await Promise.all([
    challonge(`/tournaments/${encodeURIComponent(id)}`),
    challonge(`/tournaments/${encodeURIComponent(id)}/participants`),
    challonge(`/tournaments/${encodeURIComponent(id)}/matches`),
  ]);
  return {
    tournament: unwrap(tournamentPayload, 'tournament'),
    participants: unwrap(participantsPayload, 'participant') || [],
    matches: unwrap(matchesPayload, 'match') || [],
  };
}

function previewBody(bundle, id, requestedName) {
  const participantById = new Map(bundle.participants.map((participant) => [String(participant.id), participant]));
  return {
    ok: true,
    mode: 'preview',
    authMode: 'legacy v1 direct',
    challongeTournamentId: id,
    tournamentName: requestedName || bundle.tournament?.name,
    detectedStage: 'knockout',
    participantsCount: bundle.participants.length,
    matchesCount: bundle.matches.length,
    sampleParticipants: bundle.participants.slice(0, 12).map((participant) => ({
      challongeParticipantId: String(participant.id),
      seed: participant.seed,
      ...parseParticipantName(participant.name),
    })),
    sampleMatches: bundle.matches.slice(0, 8).map((match) => ({
      id: String(match.id),
      player1Id: match.player1_id,
      player1Name: participantById.get(String(match.player1_id))?.name || null,
      player2Id: match.player2_id,
      player2Name: participantById.get(String(match.player2_id))?.name || null,
      round: roundName(match.round),
      score: parseScore(match.scores_csv),
      status: match.state,
    })),
  };
}

async function importTournament(body) {
  const id = String(body.challongeTournamentId || body.tournamentId || '').trim();
  if (!id) return json(400, { ok: false, error: 'Missing challongeTournamentId' });

  const db = database();
  const bundle = await loadTournamentBundle(id);
  const seasonCode = String(body.seasonCode || 'Imported');
  const competitionName = String(body.competitionName || 'Youth Cup');
  const tournamentName = String(body.tournamentName || bundle.tournament?.name || `Challonge ${id}`);
  const seasonNo = seasonNumber(seasonCode) || seasonNumber(tournamentName);
  const gameWorldSlug = slugify(body.gameWorldSlug || 'top-100') || 'top-100';
  const gameWorldName = body.gameWorldName || (gameWorldSlug === 'regen' ? 'Top 100 Regen' : 'Top 100');
  const competitionSlug = slugify(body.competitionSlug || (competitionName.toLowerCase().includes('world') ? 'world-club-cup' : 'youth-cup'));

  const seasonId = await findOrCreate(db, 'seasons', { code: seasonCode }, { code: seasonCode, number: seasonNo });
  const competitionId = await findOrCreate(db, 'competitions', { name: competitionName }, { name: competitionName, competition_type: competitionSlug });
  const gameWorldId = await findOrCreate(db, 'game_worlds', { slug: gameWorldSlug }, { name: gameWorldName, slug: gameWorldSlug, display_order: gameWorldSlug === 'top-100' ? 1 : 100 });
  const competitionTypeId = await findOrCreate(db, 'competition_types', { slug: competitionSlug }, { name: competitionName, slug: competitionSlug, default_secondary_bracket_name: competitionSlug === 'youth-cup' ? 'Shield' : null });

  const tournamentRow = {
    season_id: seasonId,
    competition_id: competitionId,
    game_world_id: gameWorldId,
    competition_type_id: competitionTypeId,
    season_number: seasonNo,
    name: tournamentName,
    slug: slugify(tournamentName),
    public_slug: seasonNo ? `s${seasonNo}` : slugify(seasonCode),
    status: body.status || 'archived',
    format: 'challonge_knockout_import',
    source: 'challonge',
    source_id: id,
    max_entries: bundle.participants.length,
    actual_entries: bundle.participants.length,
    knockout_teams: bundle.participants.length,
    secondary_bracket_name: body.secondaryBracketName || null,
    rules_notes: 'Imported directly from Challonge legacy v1 API',
    is_public: true,
    archive_quality: 'complete',
  };

  const existingTournament = await db.from('tournaments').select('id').eq('source', 'challonge').eq('source_id', id).maybeSingle();
  if (existingTournament.error) throw existingTournament.error;
  let tournamentId = existingTournament.data?.id;
  if (tournamentId) {
    const updated = await db.from('tournaments').update(tournamentRow).eq('id', tournamentId);
    if (updated.error) throw updated.error;
  } else {
    const created = await db.from('tournaments').insert(tournamentRow).select('id').single();
    if (created.error) throw created.error;
    tournamentId = created.data.id;
  }

  const parsedParticipants = bundle.participants.map((participant, index) => ({
    participantId: String(participant.id),
    seed: Number(participant.seed || index + 1),
    ...parseParticipantName(participant.name),
  }));

  const participantToEntry = new Map();
  const participantToTeam = new Map();
  for (const participant of parsedParticipants) {
    const teamId = await findOrCreate(db, 'teams', { name: participant.teamName }, { name: participant.teamName, active: true });
    const managerId = await findOrCreate(db, 'managers', { name: participant.managerName }, { name: participant.managerName, display_name: participant.managerName, canonical_name: participant.managerName.toLowerCase(), active: true });
    let entry = await db.from('tournament_entries').select('id').eq('tournament_id', tournamentId).eq('team_id', teamId).maybeSingle();
    if (entry.error) throw entry.error;
    if (!entry.data?.id) {
      entry = await db.from('tournament_entries').insert({
        tournament_id: tournamentId,
        team_id: teamId,
        manager_id: managerId,
        seed: participant.seed,
        entry_status: 'active',
        prize_draw_eligible: true,
        notes: `challonge_participant_id:${participant.participantId}`,
      }).select('id').single();
      if (entry.error) throw entry.error;
    } else {
      const updateEntry = await db.from('tournament_entries').update({ manager_id: managerId, seed: participant.seed, notes: `challonge_participant_id:${participant.participantId}` }).eq('id', entry.data.id);
      if (updateEntry.error) throw updateEntry.error;
    }
    participantToEntry.set(participant.participantId, entry.data.id);
    participantToTeam.set(participant.participantId, participant.teamName);
  }

  const existingMatches = await db.from('matches').delete().eq('tournament_id', tournamentId);
  if (existingMatches.error) throw existingMatches.error;

  let unresolvedPlayers = 0;
  const unresolvedExamples = [];
  const matchRows = bundle.matches.map((match, index) => {
    const player1Id = match.player1_id === null || match.player1_id === undefined ? null : String(match.player1_id);
    const player2Id = match.player2_id === null || match.player2_id === undefined ? null : String(match.player2_id);
    const homeEntryId = player1Id ? participantToEntry.get(player1Id) || null : null;
    const awayEntryId = player2Id ? participantToEntry.get(player2Id) || null : null;
    const homeName = player1Id ? participantToTeam.get(player1Id) || null : null;
    const awayName = player2Id ? participantToTeam.get(player2Id) || null : null;
    if (player1Id && !homeEntryId) unresolvedPlayers += 1;
    if (player2Id && !awayEntryId) unresolvedPlayers += 1;
    if ((!homeEntryId || !awayEntryId) && unresolvedExamples.length < 10) unresolvedExamples.push({ matchId: match.id, player1Id, player2Id, homeName, awayName });
    const score = parseScore(match.scores_csv);
    const completed = ['complete', 'completed', 'closed'].includes(String(match.state || '').toLowerCase()) || (score.home !== null && score.away !== null);
    return {
      tournament_id: tournamentId,
      stage: 'knockout',
      round: roundName(match.round),
      leg: 1,
      match_order: Number(match.suggested_play_order || index + 1),
      scheduled_at: match.scheduled_time || null,
      fixture_date: match.scheduled_time ? String(match.scheduled_time).slice(0, 10) : null,
      home_entry_id: homeEntryId,
      away_entry_id: awayEntryId,
      home_placeholder: homeName || (player1Id ? `Challonge participant ${player1Id}` : 'TBC'),
      away_placeholder: awayName || (player2Id ? `Challonge participant ${player2Id}` : 'TBC'),
      home_score: score.home,
      away_score: score.away,
      winner_entry_id: match.winner_id ? participantToEntry.get(String(match.winner_id)) || null : null,
      loser_entry_id: match.loser_id ? participantToEntry.get(String(match.loser_id)) || null : null,
      status: completed ? 'played' : 'scheduled',
      source_id: id,
      challonge_match_id: String(match.id),
      bracket: body.bracket || 'Cup',
      played_at: completed ? (match.completed_at || new Date().toISOString()) : null,
      published: true,
    };
  });

  if (matchRows.length) {
    const inserted = await db.from('matches').insert(matchRows);
    if (inserted.error) throw inserted.error;
  }

  const [entryCheck, matchCheck] = await Promise.all([
    db.from('tournament_entries').select('id', { count: 'exact', head: true }).eq('tournament_id', tournamentId),
    db.from('matches').select('id', { count: 'exact', head: true }).eq('tournament_id', tournamentId),
  ]);
  if (entryCheck.error) throw entryCheck.error;
  if (matchCheck.error) throw matchCheck.error;

  return json(200, {
    ok: true,
    mode: 'import',
    authMode: 'legacy v1 direct',
    tournamentId,
    importedTournamentName: tournamentName,
    importedParticipants: parsedParticipants.length,
    importedMatches: matchRows.length,
    persistedEntries: entryCheck.count || 0,
    persistedMatches: matchCheck.count || 0,
    unresolvedPlayers,
    unresolvedExamples,
    challongeTournamentId: id,
  });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  try {
    if (event.httpMethod === 'GET') return await listTournaments();
    if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed' });
    const body = JSON.parse(event.body || '{}');
    const id = String(body.challongeTournamentId || body.tournamentId || '').trim();
    if (!id) return json(400, { ok: false, error: 'Missing challongeTournamentId' });
    if (body.action === 'preview') {
      const bundle = await loadTournamentBundle(id);
      return json(200, previewBody(bundle, id, body.tournamentName));
    }
    return await importTournament(body);
  } catch (error) {
    return json(500, { ok: false, error: error.message });
  }
}
