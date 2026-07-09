import fs from 'node:fs';

const path = 'netlify/functions/challonge-import.js';
let text = fs.readFileSync(path, 'utf8');

if (!text.includes('function slugify')) {
  text = text.replace(
    "function inferBracket(name) { return String(name || '').toLowerCase().includes('shield') ? 'Shield' : 'Cup'; }\n",
    "function inferBracket(name) { return String(name || '').toLowerCase().includes('shield') ? 'Shield' : 'Cup'; }\nfunction slugify(value = '') { return String(value || '').trim().toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }\nfunction seasonNumberFromCode(value = '') { const match = String(value || '').match(/(\\d+)/); return match ? Number(match[1]) : null; }\nfunction seasonSlugFromCode(value = '') { const number = seasonNumberFromCode(value); return number ? `s${number}` : slugify(value); }\nfunction competitionTypeSlug(name = '') { const text = String(name || '').toLowerCase(); if (text.includes('world')) return 'world-club-cup'; if (text.includes('youth') || text.includes('shield')) return 'youth-cup'; return slugify(name) || 'challonge-import'; }\n"
  );
}

if (!text.includes('async function routeMetadata')) {
  text = text.replace(
    "async function findOrCreateOne(db, table, match, row) { const existing = await db.from(table).select('id').match(match).maybeSingle(); if (existing.error) throw existing.error; if (existing.data) return existing.data.id; const created = await db.from(table).insert(row).select('id').single(); if (created.error) throw created.error; return created.data.id; }\n",
    "async function findOrCreateOne(db, table, match, row) { const existing = await db.from(table).select('id').match(match).maybeSingle(); if (existing.error) throw existing.error; if (existing.data) return existing.data.id; const created = await db.from(table).insert(row).select('id').single(); if (created.error) throw created.error; return created.data.id; }\nasync function routeMetadata(db, body, seasonCode, competitionName, tournamentNameValue) {\n  const worldSlug = slugify(body.gameWorldSlug || body.gameWorldName || 'top-100') || 'top-100';\n  const worldName = body.gameWorldName || (worldSlug === 'regen' ? 'Top 100 Regen' : 'Top 100');\n  const compSlug = slugify(body.competitionSlug || competitionTypeSlug(competitionName)) || 'youth-cup';\n  const compName = compSlug === 'youth-cup' ? 'Youth Cup' : competitionName;\n  try {\n    const gameWorldId = await findOrCreateOne(db, 'game_worlds', { slug: worldSlug }, { name: worldName, slug: worldSlug, display_order: worldSlug === 'top-100' ? 1 : 100 });\n    const competitionTypeId = await findOrCreateOne(db, 'competition_types', { slug: compSlug }, { name: compName, slug: compSlug, default_secondary_bracket_name: compSlug === 'youth-cup' ? 'Shield' : null });\n    const seasonNumber = seasonNumberFromCode(seasonCode || tournamentNameValue);\n    return { game_world_id: gameWorldId, competition_type_id: competitionTypeId, season_number: seasonNumber, public_slug: seasonNumber ? `s${seasonNumber}` : seasonSlugFromCode(seasonCode || tournamentNameValue), slug: slugify(tournamentNameValue), is_public: true, archive_quality: 'complete' };\n  } catch {\n    return {};\n  }\n}\n"
  );
}

text = text.replace(
  "  const tournamentRow = {\n    season_id: seasonId,\n    competition_id: competitionId,\n    name: body.tournamentName || tournamentName(bundle.tournament),",
  "  const tournamentNameValue = body.tournamentName || tournamentName(bundle.tournament);\n  const metadata = await routeMetadata(db, body, seasonCode, competitionName, tournamentNameValue);\n  const tournamentRow = {\n    season_id: seasonId,\n    competition_id: competitionId,\n    name: tournamentNameValue,"
);

text = text.replace(
  "    rules_notes: `Imported from Challonge API using ${bundle.source}`,\n  };",
  "    rules_notes: `Imported from Challonge API using ${bundle.source}`,\n    ...metadata,\n  };"
);

text = text.replace(
  "      const payload = await callImportFunction({ action: 'import', challongeTournamentId: selectedId, seasonCode, competitionName, tournamentName: tournamentName || selectedTournament?.name, bracket, status: statusValue });",
  "      const payload = await callImportFunction({ action: 'import', challongeTournamentId: selectedId, seasonCode, competitionName, tournamentName: tournamentName || selectedTournament?.name, bracket, status: statusValue, gameWorldName: 'Top 100', gameWorldSlug: 'top-100', competitionSlug: competitionName.toLowerCase().includes('world') ? 'world-club-cup' : 'youth-cup' });"
);

fs.writeFileSync(path, text);
