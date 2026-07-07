#!/usr/bin/env node

import { createClient } from '@supabase/supabase-js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_CLUBS_FILE = 'data/honours-clubs.csv';
const DEFAULT_MANAGERS_FILE = 'data/honours-managers.csv';
const CLUB_COLUMNS = ['Youth Cup', 'Youth Shield'];
const HONOUR_BY_COLUMN = {
  'Youth Cup': 'Youth Cup Winner',
  'Youth Shield': 'Shield Winner',
};

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || fallback : fallback;
}

const legacySingleFile = argValue('--file', '');
const clubsFile = argValue('--clubs', legacySingleFile || DEFAULT_CLUBS_FILE);
const managersFile = argValue('--managers', legacySingleFile ? '' : DEFAULT_MANAGERS_FILE);
const dryRun = process.argv.includes('--dry-run');
const verbose = process.argv.includes('--verbose');

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Use the service-role key locally only. Never expose it in Vite or Netlify public env vars.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function normalize(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }

  row.push(cell);
  if (row.some((value) => String(value || '').trim())) rows.push(row);
  return rows;
}

function rowsFromCsv(text) {
  const parsed = parseCsv(text).filter((row) => row.some((cell) => String(cell || '').trim()));
  if (!parsed.length) return [];
  const headers = parsed[0].map((header) => String(header || '').trim());
  return parsed.slice(1).map((row) => {
    const object = {};
    headers.forEach((header, index) => { object[header] = String(row[index] ?? '').trim(); });
    return object;
  });
}

async function loadRows(file, optional = false) {
  if (!file) return [];
  const absolute = path.resolve(process.cwd(), file);
  try {
    const text = await readFile(absolute, 'utf8');
    return file.endsWith('.json') ? JSON.parse(text) : rowsFromCsv(text);
  } catch (error) {
    if (optional && error.code === 'ENOENT') return [];
    throw new Error(`Could not read ${file}: ${error.message}`);
  }
}

function readSeason(row) {
  return String(row.Season || row.season || row.SEASON || row.S || row.s || '').trim();
}

function seasonCode(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return /^s\d+$/i.test(raw) ? raw.toUpperCase() : `S${raw.replace(/^s/i, '')}`;
}

function bySeason(rows = []) {
  const lookup = new Map();
  rows.forEach((row) => {
    const season = seasonCode(readSeason(row));
    if (season) lookup.set(season, row);
  });
  return lookup;
}

function managerFromRow(row, competition) {
  if (!row) return '';
  return String(row[competition] || row.manager || row.Manager || '').trim();
}

function toHonourRows(clubRows, managerRows = []) {
  const output = [];
  const managerLookup = bySeason(managerRows);

  clubRows.forEach((clubRow) => {
    const season = seasonCode(readSeason(clubRow));
    if (!season) return;

    if (clubRow.competition || clubRow.Competition || clubRow.honour || clubRow.Honour) {
      const competition = String(clubRow.competition || clubRow.Competition || '').trim();
      const team = String(clubRow.team || clubRow.Team || clubRow.club || clubRow.Club || '').trim();
      const manager = String(clubRow.manager || clubRow.Manager || '').trim();
      const honour = String(clubRow.honour || clubRow.Honour || `${competition} Winner`).trim();
      const position = Number(clubRow.position || clubRow.Position || 1) || 1;
      if (competition && team) output.push({ season, competition, team, manager, honour, position });
      return;
    }

    const managerRow = managerLookup.get(season);
    CLUB_COLUMNS.forEach((competition) => {
      const team = String(clubRow[competition] || '').trim();
      if (!team) return;
      output.push({
        season,
        competition,
        team,
        manager: managerFromRow(managerRow, competition),
        honour: HONOUR_BY_COLUMN[competition] || `${competition} Winner`,
        position: 1,
      });
    });
  });

  return output;
}

async function maybeSingle(table, select, filters) {
  let query = supabase.from(table).select(select);
  filters.forEach(([column, value]) => { query = query.eq(column, value); });
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`${table} lookup failed: ${error.message}`);
  return data;
}

async function insertRow(table, values) {
  if (dryRun) return { id: `dry-${table}-${JSON.stringify(values)}` };
  const { data, error } = await supabase.from(table).insert(values).select('id').single();
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
  return data;
}

async function findOrCreateSeason(code) {
  const existing = await maybeSingle('seasons', 'id, code', [['code', code]]);
  if (existing) return existing;
  const number = Number(String(code).replace(/[^0-9]/g, '')) || null;
  return insertRow('seasons', { code, number });
}

async function findOrCreateCompetition(name) {
  const existing = await maybeSingle('competitions', 'id, name', [['name', name]]);
  if (existing) return existing;
  return insertRow('competitions', { name, competition_type: 'Youth' });
}

async function findOrCreateTeam(name) {
  const existing = await maybeSingle('teams', 'id, name', [['name', name]]);
  if (existing) return existing;
  return insertRow('teams', { name, active: true });
}

async function findOrCreateManager(name) {
  if (!name) return null;
  let existing = await maybeSingle('managers', 'id, name, display_name', [['display_name', name]]);
  if (existing) return existing;
  existing = await maybeSingle('managers', 'id, name, display_name', [['name', name]]);
  if (existing) return existing;
  return insertRow('managers', { name, display_name: name, canonical_name: normalize(name), active: true });
}

async function findOrCreateTournament({ season, competition }) {
  const seasonRow = await findOrCreateSeason(season);
  const competitionRow = await findOrCreateCompetition(competition);
  const name = `${season} ${competition}`;

  let existing = await maybeSingle('tournaments', 'id, name', [['season_id', seasonRow.id], ['competition_id', competitionRow.id]]);
  if (existing) return existing;

  existing = await maybeSingle('tournaments', 'id, name', [['name', name]]);
  if (existing) return existing;

  return insertRow('tournaments', {
    season_id: seasonRow.id,
    competition_id: competitionRow.id,
    name,
    status: 'archived',
    actual_entries: 0,
  });
}

async function updateEntryManager(entryId, managerId) {
  if (!managerId || dryRun) return;
  const { error } = await supabase.from('tournament_entries').update({ manager_id: managerId }).eq('id', entryId).is('manager_id', null);
  if (error) throw new Error(`tournament_entries manager update failed: ${error.message}`);
}

async function findOrCreateEntry({ tournamentId, teamId, managerId }) {
  const filters = [['tournament_id', tournamentId], ['team_id', teamId]];
  const existing = await maybeSingle('tournament_entries', 'id, manager_id', filters);
  if (existing) {
    await updateEntryManager(existing.id, managerId);
    return existing;
  }

  const values = {
    tournament_id: tournamentId,
    team_id: teamId,
    manager_id: managerId || null,
    entry_status: 'historic',
  };
  return insertRow('tournament_entries', values);
}

async function honourExists({ tournamentId, entryId, honour }) {
  const existing = await maybeSingle('honours', 'id', [['tournament_id', tournamentId], ['entry_id', entryId], ['honour', honour]]);
  return Boolean(existing);
}

async function importHonour(row) {
  const tournament = await findOrCreateTournament(row);
  const team = await findOrCreateTeam(row.team);
  const manager = await findOrCreateManager(row.manager);
  const entry = await findOrCreateEntry({ tournamentId: tournament.id, teamId: team.id, managerId: manager?.id || null });

  const exists = await honourExists({ tournamentId: tournament.id, entryId: entry.id, honour: row.honour });
  if (exists) return { action: 'skipped', row };

  if (!dryRun) {
    const { error } = await supabase.from('honours').insert({
      tournament_id: tournament.id,
      entry_id: entry.id,
      honour: row.honour,
      position: row.position,
    });
    if (error) throw new Error(`honours insert failed: ${error.message}`);
  }

  return { action: dryRun ? 'would-import' : 'imported', row };
}

async function main() {
  const clubRows = await loadRows(clubsFile);
  const managerRows = await loadRows(managersFile, true);
  const honourRows = toHonourRows(clubRows, managerRows);

  if (!honourRows.length) {
    console.error(`No Youth Cup honours found in ${clubsFile}.`);
    process.exit(1);
  }

  if (!managerRows.length && !legacySingleFile) {
    console.warn(`No manager file found at ${managersFile}. Importing club winners without managers.`);
  }

  const counts = { imported: 0, skipped: 0, 'would-import': 0 };

  for (const row of honourRows) {
    const result = await importHonour(row);
    counts[result.action] = (counts[result.action] || 0) + 1;
    if (verbose) console.log(`${result.action}: ${row.season} ${row.competition} — ${row.team}${row.manager ? ` (${row.manager})` : ''}`);
  }

  console.log('Youth honours import complete.');
  console.log({ clubsFile, managersFile: managerRows.length ? managersFile : null, ...counts });
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
