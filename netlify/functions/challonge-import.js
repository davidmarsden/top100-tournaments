import { createClient } from '@supabase/supabase-js';

const V2 = 'https://api.challonge.com/v2.1';
const V1 = 'https://api.challonge.com/v1';
const V2_HEADERS = {
  Accept: 'application/json',
  'Content-Type': 'application/vnd.api+json',
  'Authorization-Type': 'v1',
};
const GROUP_CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

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

function env(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing environment variable: ${name}`);
  return value;
}

function apiKey() { return env('CHALLONGE_API_KEY'); }

function dbClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY or VITE_SUPABASE_ANON_KEY');
  return createClient(env('VITE_SUPABASE_URL'), key, { auth: { persistSession: false } });
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const e = new Error(data?.errors?.detail || data?.errors?.[0]?.detail || data?.message || data?.error || text || `${res.status} ${res.statusText}`);
    e.statusCode = res.status;
    throw e;
  }
  return data;
}

function pathJson(path) { return path.endsWith('.json') ? path : `${path}.json`; }

async function getV2(path, query = {}) {
  const url = new URL(`${V2}${pathJson(path)}`);
  Object.entries(query).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && url.searchParams.set(k, v));
  return fetchJson(url.toString(), { headers: { ...V2_HEADERS, Authorization: apiKey() } });
}

async function getV1(path, query = {}) {
  const url = new URL(`${V1}${pathJson(path)}`);
  url.searchParams.set('api_key', apiKey());
  Object.entries(query).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && url.searchParams.set(k, v));
  return fetchJson(url.toString(), { headers: { Accept: 'application/json' } });
}

async function firstSuccessful(requests) {
  const attempts = [];
  for (const r of requests) {
    try { return { source: r.source, data: await r.run() }; }
    catch (e) { attempts.push({ source: r.source, message: e.message, statusCode: e.statusCode }); }
  }
  const e = new Error(attempts.map((a) => `${a.source}: ${a.message}`).join(' | '));
  e.attempts = attempts;
  throw e;
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
function s(v) { return v === undefined || v === null || typeof v === 'object' ? '' : String(v).trim(); }
function itemId(item) { const a = attrs(item); return s(item?.id || a.id || item?.tournament?.id || item?.participant?.id || item?.match?.id); }
function normalAlias(value) { return s(value).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function addId(set, value) { const clean = s(value); if (!clean) return; set.add(clean); const normalized = normalAlias(clean); if (normalized) set.add(normalized); const digits = clean.match(/\d+/g)?.join(''); if (digits) set.add(digits); }
function deepIds(value, set, depth = 0) { if (!value || depth > 4) return; if (typeof value !== 'object') return addId(set, value); addId(set, value.id); addId(set, value.participant_id); addId(set, value.participantId); addId(set, value.player_id); addId(set, value.playerId); addId(set, value.challonge_id); addId(set, value.challongeId); Object.values(value).forEach((v) => deepIds(v, set, depth + 1)); }
function participantAliases(p) { const set = new Set(); addId(set, itemId(p)); deepIds(p, set); deepIds(attrs(p), set); return [...set]; }

function relationValues(item, ...keys) {
  const a = attrs(item);
  const values = [];
  for (const key of keys) {
    values.push(item?.[key], a?.[key], item?.match?.[key], item?.participant?.[key], item?.relationships?.[key]?.data, a?.relationships?.[key]?.data);
  }
  return values.filter((value) => value !== undefined && value !== null);
}

function relationAliases(item, ...keys) {
  const set = new Set();
  relationValues(item, ...keys).forEach((value) => deepIds(value, set));
  return [...set];
}

function relationId(item, ...keys) {
  return relationAliases(item, ...keys)[0] || null;
}

function nestedName(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value !== 'object') return '';
  const a = attrs(value);
  return String(a.name || a.display_name || a.displayName || a.username || value.name || '').trim();
}

function relationNames(item, side) {
  const a = attrs(item);
  const keys = side === 1
    ? ['player1_name', 'player1Name', 'participant1_name', 'participant1Name', 'team1_name', 'team1Name', 'player1', 'participant1', 'team1']
    : ['player2_name', 'player2Name', 'participant2_name', 'participant2Name', 'team2_name', 'team2Name', 'player2', 'participant2', 'team2'];
  const names = new Set();
  keys.forEach((key) => {
    [item?.[key], a?.[key], item?.match?.[key], item?.relationships?.[key]?.data, a?.relationships?.[key]?.data].forEach((value) => {
      const name = nestedName(value);
      if (name) {
        names.add(name);
        const parsed = parseTeamAndManager(name);
        if (parsed.teamName) names.add(parsed.teamName);
      }
    });
  });
  return [...names];
}

function tournamentName(t) { const a = attrs(t); return String(a.name || a.full_name || a.fullName || t?.name || `Challonge ${itemId(t)}`).trim(); }
function participantName(p) { const a = attrs(p); return String(a.name || a.display_name || a.displayName || a.username || p?.name || `Participant ${itemId(p)}`).trim(); }
function parseTeamAndManager(name) { const clean = String(name || '').trim(); const m = clean.match(/^(.*?)\s*[–—-]?\s*\((.*?)\)\s*$/); return m ? { teamName: m[1].trim() || clean, managerName: m[2].trim() || 'TBC Manager' } : { teamName: clean, managerName: 'TBC Manager' }; }
function slugify(value = '') { return String(value || '').trim().toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function seasonNumberFromCode(value = '') { const match = String(value || '').match(/(\d+)/); return match ? Number(match[1]) : null; }
function seasonSlugFromCode(value = '') { const number = seasonNumberFromCode(value); return number ? `s${number}` : slugify(value); }
function competitionTypeSlug(name = '') { const text = String(name || '').toLowerCase(); if (text.includes('world')) return 'world-club-cup'; if (text.includes('youth') || text.includes('shield')) return 'youth-cup'; return slugify(name) || 'challonge-import'; }

function parseScores(match) {
  const a = attrs(match);
  const raw = a.scores_csv || a.scoresCsv || a.score_csv || a.scoreCsv || a.scores || a.score;
  if (typeof raw === 'string') {
    const m = raw.split(',')[0].trim().match(/(-?\d+)\s*[-:]\s*(-?\d+)/);
    if (m) return { home_score: Number(m[1]), away_score: Number(m[2]) };
  }
  const home = a.player1_score ?? a.player1Score ?? a.home_score ?? a.homeScore ?? a.team1_score ?? a.team1Score;
  const away = a.player2_score ?? a.player2Score ?? a.away_score ?? a.awayScore ?? a.team2_score ?? a.team2Score;
  return home !== undefined && away !== undefined && home !== null && away !== null ? { home_score: Number(home), away_score: Number(away) } : { home_score: null, away_score: null };
}

function knockoutRound(match) {
  const raw = attrs(match).round ?? attrs(match).round_number ?? attrs(match).roundNumber ?? attrs(match).identifier ?? 'Round';
  const n = Number(raw);
  if (Number.isFinite(n)) {
    if (n < 0) return `Losers R${Math.abs(n)}`;
    if (n === 1) return 'R32';
    if (n === 2) return 'R16';
    if (n === 3) return 'QF';
    if (n === 4) return 'SF';
    if (n >= 5) return 'Final';
  }
  return String(raw || 'Round');
}

function groupRound(match, index) {
  const a = attrs(match);
  const raw = a.round ?? a.round_number ?? a.roundNumber ?? a.group_round ?? a.groupRound ?? a.identifier;
  const n = Number(raw);
  if (Number.isFinite(n)) return `MD${Math.max(1, n)}`;
  return `MD${index + 1}`;
}

function matchOrder(match, i) { const a = attrs(match); return Number(a.suggested_play_order || a.suggestedPlayOrder || a.match_order || a.matchOrder || a.identifier || i + 1) || i + 1; }
function matchStatus(match, score) { const state = String(attrs(match).state || attrs(match).status || '').toLowerCase(); if (state.includes('complete') || state.includes('played') || state === 'closed') return 'played'; return Number.isFinite(score.home_score) && Number.isFinite(score.away_score) ? 'played' : 'scheduled'; }
function groupKey(match) { const a = attrs(match); const raw = a.group_id || a.groupId || a.group_identifier || a.groupIdentifier || a.group_name || a.groupName || relationId(match, 'group'); if (!raw) return 'Ungrouped'; const clean = String(raw).trim(); const number = Number(clean); if (Number.isFinite(number) && number > 0 && number <= 26) return GROUP_CODES[number - 1]; return clean.replace(/^Group\s+/i, ''); }
function cleanUnique(values) { return [...new Set(values.map((v) => String(v || '').trim()).filter(Boolean))]; }

async function selectByNames(db, table, names) { if (!names.length) return []; const { data, error } = await db.from(table).select('id, name').in('name', names); if (error) throw error; return data || []; }
async function insertRows(db, table, rows) { if (!rows.length) return []; const { data, error } = await db.from(table).insert(rows).select('id, name'); if (error) throw error; return data || []; }
async function findOrCreateOne(db, table, match, row) { const existing = await db.from(table).select('id').match(match).maybeSingle(); if (existing.error) throw existing.error; if (existing.data) return existing.data.id; const created = await db.from(table).insert(row).select('id').single(); if (created.error) throw created.error; return created.data.id; }
async function routeMetadata(db, body, seasonCode, competitionName, tournamentNameValue) {
  const worldSlug = slugify(body.gameWorldSlug || body.gameWorldName || 'top-100') || 'top-100';
  const worldName = body.gameWorldName || (worldSlug === 'regen' ? 'Top 100 Regen' : 'Top 100');
  const compSlug = slugify(body.competitionSlug || competitionTypeSlug(competitionName)) || 'youth-cup';
  const compName = compSlug === 'youth-cup' ? 'Youth Cup' : competitionName;
  try {
    const gameWorldId = await findOrCreateOne(db, 'game_worlds', { slug: worldSlug }, { name: worldName, slug: worldSlug, display_order: worldSlug === 'top-100' ? 1 : 100 });
    const competitionTypeId = await findOrCreateOne(db, 'competition_types', { slug: compSlug }, { name: compName, slug: compSlug, default_secondary_bracket_name: compSlug === 'youth-cup' ? 'Shield' : null });
    const seasonNumber = seasonNumberFromCode(seasonCode || tournamentNameValue);
    return { game_world_id: gameWorldId, competition_type_id: competitionTypeId, season_number: seasonNumber, public_slug: seasonNumber ? `s${seasonNumber}` : seasonSlugFromCode(seasonCode || tournamentNameValue), slug: slugify(tournamentNameValue), is_public: true, archive_quality: 'complete' };
  } catch {
    return {};
  }
}

async function loadV2TournamentPages(path, maxPages = 10) {
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const data = page === 1 ? await getV2(path) : await getV2(path, { page });
    const rows = asArray(data);
    if (!rows.length) break;
    all.push(...rows);
  }
  return all;
}

async function loadV1TournamentPages(path, maxPages = 10) {
  const all = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const data = await getV1(path, { page });
    const rows = asArray(data);
    if (!rows.length) break;
    all.push(...rows);
  }
  return all;
}

async function loadBundle(id) {
  return firstSuccessful([
    { source: 'v2.1 headers', run: async () => ({ tournament: await getV2(`/tournaments/${encodeURIComponent(id)}`), participants: await getV2(`/tournaments/${encodeURIComponent(id)}/participants`), matches: await getV2(`/tournaments/${encodeURIComponent(id)}/matches`) }) },
    { source: 'legacy v1 query api_key', run: async () => ({ tournament: await getV1(`/tournaments/${encodeURIComponent(id)}`), participants: await getV1(`/tournaments/${encodeURIComponent(id)}/participants`), matches: await getV1(`/tournaments/${encodeURIComponent(id)}/matches`) }) },
  ]);
}

function normalizedBundle(bundle) {
  const tournament = asArray(bundle.data.tournament)[0] || bundle.data.tournament?.tournament || bundle.data.tournament?.data || bundle.data.tournament;
  const participants = asArray(bundle.data.participants);
  const matches = asArray(bundle.data.matches);
  const parsedParticipants = participants.map((p, i) => ({ challongeParticipantId: itemId(p), aliases: participantAliases(p), seed: Number(attrs(p).seed || attrs(p).rank || i + 1) || i + 1, ...parseTeamAndManager(participantName(p)) }));
  return { source: bundle.source, tournament, participants, matches, parsedParticipants };
}

function isGroupImport(body, tournament) {
  if (body.stage === 'group') return true;
  if (body.stage === 'knockout') return false;
  const a = attrs(tournament);
  const name = tournamentName(tournament).toLowerCase();
  return Boolean(a.group_stage_enabled) && (String(a.state || '').includes('group') || name.includes('group stage') || (!name.includes('knockout') && !name.includes('shield')));
}

async function listTournaments(event) {
  const maxPages = Number(event.queryStringParameters?.maxPages || 10);
  const result = await firstSuccessful([
    { source: 'v2.1 page-by-page', run: () => loadV2TournamentPages('/tournaments', maxPages) },
    { source: 'legacy v1 page-by-page', run: () => loadV1TournamentPages('/tournaments', maxPages) },
  ]);
  return json(200, { ok: true, authMode: result.source, tournaments: asArray(result.data).map((item) => ({ id: itemId(item), name: tournamentName(item), attributes: attrs(item) })) });
}

async function previewTournament(body) {
  const id = String(body.challongeTournamentId || body.tournamentId || '').trim();
  if (!id) return json(400, { ok: false, error: 'Missing challongeTournamentId' });
  const bundle = normalizedBundle(await loadBundle(id));
  const groupStage = isGroupImport(body, bundle.tournament);
  return json(200, {
    ok: true,
    mode: 'preview',
    authMode: bundle.source,
    challongeTournamentId: id,
    tournamentName: body.tournamentName || tournamentName(bundle.tournament),
    detectedStage: groupStage ? 'group' : 'knockout',
    participantsCount: bundle.parsedParticipants.length,
    matchesCount: bundle.matches.length,
    sampleParticipants: bundle.parsedParticipants.slice(0, 12),
    sampleMatches: bundle.matches.slice(0, 8).map((m, i) => ({ id: itemId(m), round: groupStage ? groupRound(m, i) : knockoutRound(m), group: groupStage ? groupKey(m) : null, order: matchOrder(m, i), player1: relationAliases(m, 'player1', 'player1_id', 'player1Id', 'participant1', 'participant1_id', 'participant1Id'), player2: relationAliases(m, 'player2', 'player2_id', 'player2Id', 'participant2', 'participant2_id', 'participant2Id'), player1Names: relationNames(m, 1), player2Names: relationNames(m, 2), score: parseScores(m), status: matchStatus(m, parseScores(m)) })),
  });
}

async function upsertGroups(db, tournamentId, matches) {
  const keys = cleanUnique(matches.map((m) => groupKey(m))).filter((key) => key !== 'Ungrouped');
  if (!keys.length) return new Map();
  const existing = await db.from('groups').select('id, code').eq('tournament_id', tournamentId);
  if (existing.error) throw existing.error;
  const byCode = new Map((existing.data || []).map((g) => [g.code, g.id]));
  const rows = keys.filter((code) => !byCode.has(code)).map((code, i) => ({ tournament_id: tournamentId, code, name: `Group ${code}`, group_order: GROUP_CODES.indexOf(code) >= 0 ? GROUP_CODES.indexOf(code) + 1 : i + 1 }));
  if (rows.length) {
    const inserted = await db.from('groups').insert(rows).select('id, code');
    if (inserted.error) throw inserted.error;
    inserted.data.forEach((g) => byCode.set(g.code, g.id));
  }
  return byCode;
}

async function importTournament(body) {
  const id = String(body.challongeTournamentId || body.tournamentId || '').trim();
  if (!id) return json(400, { ok: false, error: 'Missing challongeTournamentId' });
  const db = dbClient();
  const bundle = normalizedBundle(await loadBundle(id));
  const groupStage = isGroupImport(body, bundle.tournament);
  const seasonCode = body.seasonCode || 'Imported';
  const competitionName = body.competitionName || 'Challonge Import';
  const seasonId = await findOrCreateOne(db, 'seasons', { code: seasonCode }, { code: seasonCode, number: Number(String(seasonCode).replace(/[^0-9]/g, '')) || null });
  const competitionId = await findOrCreateOne(db, 'competitions', { name: competitionName }, { name: competitionName, competition_type: body.competitionType || 'imported' });

  const existingTournament = await db.from('tournaments').select('id').eq('source', 'challonge').eq('source_id', id).maybeSingle();
  if (existingTournament.error) throw existingTournament.error;
  let tournamentId = existingTournament.data?.id;
  const a = attrs(bundle.tournament);
  const groupSize = Number(a.group_stage_options?.group_size || 0) || null;
  const tournamentNameValue = body.tournamentName || tournamentName(bundle.tournament);
  const metadata = await routeMetadata(db, body, seasonCode, competitionName, tournamentNameValue);
  const tournamentRow = {
    season_id: seasonId,
    competition_id: competitionId,
    name: tournamentNameValue,
    status: body.status || 'archived',
    format: groupStage ? 'challonge_group_import' : 'challonge_knockout_import',
    source: 'challonge',
    source_id: id,
    max_entries: bundle.parsedParticipants.length,
    actual_entries: bundle.parsedParticipants.length,
    group_count: groupSize ? Math.ceil(bundle.parsedParticipants.length / groupSize) : null,
    teams_per_group: groupSize,
    knockout_teams: body.knockoutTeams || null,
    secondary_bracket_name: body.secondaryBracketName || null,
    rules_notes: `Imported from Challonge API using ${bundle.source}`,
    ...metadata,
  };
  if (!tournamentId) {
    const created = await db.from('tournaments').insert(tournamentRow).select('id').single();
    if (created.error) throw created.error;
    tournamentId = created.data.id;
  } else {
    const updated = await db.from('tournaments').update(tournamentRow).eq('id', tournamentId);
    if (updated.error) throw updated.error;
  }

  const teamNames = cleanUnique(bundle.parsedParticipants.map((p) => p.teamName));
  const managerNames = cleanUnique(bundle.parsedParticipants.map((p) => p.managerName));
  let teams = await selectByNames(db, 'teams', teamNames);
  await insertRows(db, 'teams', teamNames.filter((name) => !teams.some((t) => t.name === name)).map((name) => ({ name, active: true })));
  teams = await selectByNames(db, 'teams', teamNames);
  let managers = await selectByNames(db, 'managers', managerNames);
  await insertRows(db, 'managers', managerNames.filter((name) => !managers.some((m) => m.name === name)).map((name) => ({ name, display_name: name, canonical_name: name.toLowerCase(), active: true })));
  managers = await selectByNames(db, 'managers', managerNames);

  const teamMap = new Map(teams.map((t) => [t.name, t.id]));
  const managerMap = new Map(managers.map((m) => [m.name, m.id]));
  const existingEntries = await db.from('tournament_entries').select('id, team_id').eq('tournament_id', tournamentId);
  if (existingEntries.error) throw existingEntries.error;
  const entryByTeam = new Map((existingEntries.data || []).map((e) => [e.team_id, e.id]));
  const newEntries = bundle.parsedParticipants.filter((p) => !entryByTeam.has(teamMap.get(p.teamName))).map((p) => ({ tournament_id: tournamentId, team_id: teamMap.get(p.teamName), manager_id: managerMap.get(p.managerName), seed: p.seed, rating: null, entry_status: 'active', prize_draw_eligible: true, notes: `challonge_participant_id:${p.challongeParticipantId}; aliases:${p.aliases.join('|')}` }));
  if (newEntries.length) {
    const inserted = await db.from('tournament_entries').insert(newEntries).select('id, team_id');
    if (inserted.error) throw inserted.error;
    inserted.data.forEach((e) => entryByTeam.set(e.team_id, e.id));
  }

  const participantToEntry = new Map();
  const participantNameToEntry = new Map();
  const participantToTeamName = new Map();
  const entryToTeamName = new Map();
  bundle.parsedParticipants.forEach((p) => {
    const entryId = entryByTeam.get(teamMap.get(p.teamName));
    if (entryId) entryToTeamName.set(entryId, p.teamName);
    [p.challongeParticipantId, ...p.aliases].forEach((alias) => {
      addId(new Set(), alias);
      const clean = s(alias);
      const normalized = normalAlias(alias);
      if (clean) {
        participantToEntry.set(clean, entryId);
        participantToTeamName.set(clean, p.teamName);
      }
      if (normalized) {
        participantToEntry.set(normalized, entryId);
        participantToTeamName.set(normalized, p.teamName);
      }
      const digits = clean.match(/\d+/g)?.join('');
      if (digits) {
        participantToEntry.set(digits, entryId);
        participantToTeamName.set(digits, p.teamName);
      }
    });
    [p.teamName, participantName(bundle.participants.find((raw) => itemId(raw) === p.challongeParticipantId))].filter(Boolean).forEach((name) => participantNameToEntry.set(normalAlias(name), entryId));
  });

  function resolveEntry(match, side) {
    const aliases = side === 1
      ? relationAliases(match, 'player1', 'player1_id', 'player1Id', 'participant1', 'participant1_id', 'participant1Id')
      : relationAliases(match, 'player2', 'player2_id', 'player2Id', 'participant2', 'participant2_id', 'participant2Id');
    for (const alias of aliases) {
      const direct = participantToEntry.get(s(alias)) || participantToEntry.get(normalAlias(alias));
      if (direct) return direct;
    }
    for (const name of relationNames(match, side)) {
      const byName = participantNameToEntry.get(normalAlias(name));
      if (byName) return byName;
    }
    return null;
  }

  function resolveTeamName(match, side, entryId) {
    if (entryId && entryToTeamName.get(entryId)) return entryToTeamName.get(entryId);
    const aliases = side === 1
      ? relationAliases(match, 'player1', 'player1_id', 'player1Id', 'participant1', 'participant1_id', 'participant1Id')
      : relationAliases(match, 'player2', 'player2_id', 'player2Id', 'participant2', 'participant2_id', 'participant2Id');
    for (const alias of aliases) {
      const name = participantToTeamName.get(s(alias)) || participantToTeamName.get(normalAlias(alias));
      if (name) return name;
    }
    const embeddedName = relationNames(match, side)[0];
    return embeddedName ? parseTeamAndManager(embeddedName).teamName : null;
  }

  const deleted = await db.from('matches').delete().eq('tournament_id', tournamentId).eq('source_id', id);
  if (deleted.error) throw deleted.error;
  const groupMap = groupStage ? await upsertGroups(db, tournamentId, bundle.matches) : new Map();

  let unresolvedPlayers = 0;
  const unresolvedExamples = [];
  const matchRows = bundle.matches.map((match, index) => {
    const attr = attrs(match);
    const player1Aliases = relationAliases(match, 'player1', 'player1_id', 'player1Id', 'participant1', 'participant1_id', 'participant1Id');
    const player2Aliases = relationAliases(match, 'player2', 'player2_id', 'player2Id', 'participant2', 'participant2_id', 'participant2Id');
    const score = parseScores(match);
    const status = matchStatus(match, score);
    const winnerAliases = relationAliases(match, 'winner', 'winner_id', 'winnerId');
    const loserAliases = relationAliases(match, 'loser', 'loser_id', 'loserId');
    const homeEntryId = resolveEntry(match, 1);
    const awayEntryId = resolveEntry(match, 2);
    const homeTeamName = resolveTeamName(match, 1, homeEntryId);
    const awayTeamName = resolveTeamName(match, 2, awayEntryId);
    if (player1Aliases.length && !homeEntryId) unresolvedPlayers += 1;
    if (player2Aliases.length && !awayEntryId) unresolvedPlayers += 1;
    if ((!homeEntryId || !awayEntryId) && unresolvedExamples.length < 8) unresolvedExamples.push({ matchId: itemId(match), player1Aliases, player2Aliases, player1Names: relationNames(match, 1), player2Names: relationNames(match, 2) });
    const winnerEntryId = winnerAliases.map((alias) => participantToEntry.get(s(alias)) || participantToEntry.get(normalAlias(alias))).find(Boolean) || null;
    const loserEntryId = loserAliases.map((alias) => participantToEntry.get(s(alias)) || participantToEntry.get(normalAlias(alias))).find(Boolean) || null;
    const gKey = groupKey(match);
    return {
      tournament_id: tournamentId,
      group_id: groupStage ? (groupMap.get(gKey) || null) : null,
      stage: body.stage || (groupStage ? 'group' : 'knockout'),
      round: groupStage ? groupRound(match, index) : knockoutRound(match),
      leg: 1,
      match_order: matchOrder(match, index),
      scheduled_at: attr.scheduled_time || attr.scheduledTime || null,
      fixture_date: attr.scheduled_time ? String(attr.scheduled_time).slice(0, 10) : null,
      home_entry_id: homeEntryId,
      away_entry_id: awayEntryId,
      home_placeholder: homeTeamName || (player1Aliases[0] ? `Challonge participant ${player1Aliases[0]}` : 'TBC'),
      away_placeholder: awayTeamName || (player2Aliases[0] ? `Challonge participant ${player2Aliases[0]}` : 'TBC'),
      home_score: Number.isFinite(score.home_score) ? score.home_score : null,
      away_score: Number.isFinite(score.away_score) ? score.away_score : null,
      winner_entry_id: winnerEntryId,
      loser_entry_id: loserEntryId,
      status,
      source_id: id,
      challonge_match_id: itemId(match) || String(index + 1),
      bracket: body.bracket || (groupStage ? null : 'Cup'),
      played_at: status === 'played' ? (attr.completed_at || attr.completedAt || new Date().toISOString()) : null,
      published: true,
    };
  });

  let importedMatches = 0;
  for (let i = 0; i < matchRows.length; i += 500) {
    const chunk = matchRows.slice(i, i + 500);
    if (chunk.length) {
      const inserted = await db.from('matches').insert(chunk);
      if (inserted.error) throw inserted.error;
      importedMatches += chunk.length;
    }
  }
  return json(200, { ok: true, mode: 'import', authMode: bundle.source, tournamentId, importedTournamentName: tournamentRow.name, importedParticipants: bundle.parsedParticipants.length, importedMatches, updatedMatches: 0, unresolvedPlayers, unresolvedExamples, detectedStage: groupStage ? 'group' : 'knockout', challongeTournamentId: id });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(200, { ok: true });
  try {
    if (event.httpMethod === 'GET') return await listTournaments(event);
    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body || '{}');
      return body.action === 'preview' ? await previewTournament(body) : await importTournament(body);
    }
    return json(405, { ok: false, error: 'Method not allowed' });
  } catch (error) {
    return json(error.statusCode || 500, { ok: false, error: error.message, attempts: error.attempts || null });
  }
}
