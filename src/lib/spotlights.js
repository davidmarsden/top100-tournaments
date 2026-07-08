const ROUND_ORDER = ['R64', 'R32', 'R16', 'QF', 'SF', 'Final'];
const ROUND_LABELS = { R64: 'Round of 64', R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-finals', SF: 'Semi-finals', Final: 'Final' };

function entryKey(id) { return String(id || ''); }
function roundIndex(round) { const index = ROUND_ORDER.indexOf(round); return index >= 0 ? index : 99; }
function roundLabel(round) { return ROUND_LABELS[round] || round || 'Round'; }
function isCompleted(match) { return match.status === 'played' || match.status === 'forfeit'; }
function parseDate(dateString) {
  if (!dateString) return null;
  const [year, month, day] = String(dateString).slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}
function todayUtc() { const now = new Date(); return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())); }
function roundSort(a, b) {
  return String(a.bracket || '').localeCompare(String(b.bracket || '')) || roundIndex(a.round) - roundIndex(b.round) || Number(a.match_order || 0) - Number(b.match_order || 0) || Number(a.leg || 1) - Number(b.leg || 1);
}
function groupSort(a, b) {
  return String(a.groups?.code || '').localeCompare(String(b.groups?.code || '')) || String(a.round || '').localeCompare(String(b.round || ''), undefined, { numeric: true }) || Number(a.match_order || 0) - Number(b.match_order || 0);
}
function managerName(entry) { return entry?.managers?.display_name || entry?.managers?.name || 'TBC'; }
function describeEntry(entry) { return `${entry?.teams?.name || 'TBC'}${entry?.managers ? ` (${managerName(entry)})` : ''}`; }
function describeManager(entry) {
  const manager = managerName(entry);
  const club = entry?.teams?.name || 'their side';
  return manager && manager !== 'TBC' ? `${manager}'s ${club}` : club;
}
function honourType(row) {
  const value = `${row?.honour || ''} ${row?.tournaments?.name || ''}`.toLowerCase();
  return value.includes('shield') ? 'shield' : 'cup';
}
function honourSeason(row) {
  const match = String(row?.tournaments?.name || '').match(/S\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}
function entryById(entries) { return new Map(entries.map((entry) => [entryKey(entry.id), entry])); }
function groupRowsMap(tables) {
  const map = new Map();
  tables.forEach((table) => table.rows.forEach((row) => map.set(entryKey(row.entry_id), row)));
  return map;
}
function groupFixtureTotals(matches) {
  const totals = new Map();
  matches.filter((match) => match.stage === 'group').forEach((match) => {
    [match.home_entry_id, match.away_entry_id].forEach((id) => totals.set(entryKey(id), (totals.get(entryKey(id)) || 0) + 1));
  });
  return totals;
}
function upcomingMatches(matches) {
  const today = todayUtc();
  return matches.filter((match) => !isCompleted(match) && parseDate(match.fixture_date) && parseDate(match.fixture_date) >= today).sort((a, b) => parseDate(a.fixture_date) - parseDate(b.fixture_date) || roundSort(a, b));
}
function buildPrestige(entries, honours, currentTournamentId) {
  const byTeam = new Map(entries.map((entry) => [entry.teams?.name, entry]));
  const latestSeason = Math.max(0, ...honours.map(honourSeason));
  const prestige = new Map(entries.map((entry) => [entryKey(entry.id), { score: 0, reasons: [], storyTypes: new Set(), cupWins: 0, shieldWins: 0, topSeed: entry.seed || 9999 }]));

  honours.filter((row) => Number(row.tournament_id) !== Number(currentTournamentId)).forEach((row) => {
    const entry = byTeam.get(row.entry?.teams?.name);
    if (!entry) return;
    const record = prestige.get(entryKey(entry.id));
    const type = honourType(row);
    if (type === 'shield') record.shieldWins += 1;
    else record.cupWins += 1;
    record.score += type === 'shield' ? 7 : 10;
    if (honourSeason(row) === latestSeason) {
      record.score += 24;
      record.storyTypes.add('holder');
      record.reasons.push(type === 'shield' ? 'current Shield holder' : 'current Youth Cup holder');
    }
  });

  prestige.forEach((record) => {
    if (record.topSeed <= 4) { record.score += 16; record.storyTypes.add('seed'); record.reasons.push(`top-${record.topSeed} seed`); }
    else if (record.topSeed <= 8) { record.score += 12; record.storyTypes.add('seed'); record.reasons.push('top-8 seed'); }
    else if (record.topSeed <= 16) { record.score += 7; record.storyTypes.add('seed'); record.reasons.push('top-16 seed'); }
    const titles = record.cupWins + record.shieldWins;
    if (titles >= 3) { record.storyTypes.add('pedigree'); record.reasons.push(`${titles} historic youth honours`); }
    else if (titles > 0 && !record.reasons.some((reason) => reason.includes('holder'))) { record.storyTypes.add('pedigree'); record.reasons.push('former youth winner'); }
  });

  return prestige;
}
function tablePressure(match, tables, totals) {
  if (match.stage !== 'group') return { score: 0, type: 'knockout', tag: match.round || 'Knockout tie', story: `${match.bracket || 'Cup'} ${roundLabel(match.round)} fixture.` };
  const rows = groupRowsMap(tables);
  const home = rows.get(entryKey(match.home_entry_id));
  const away = rows.get(entryKey(match.away_entry_id));
  const group = match.groups?.code || home?.group_code || away?.group_code || 'group';
  if (!home || !away || Math.max(home.played, away.played) === 0) return { score: 0, type: 'early', tag: `Group ${group} spotlight`, story: `Early Group ${group} marker with seeding and tournament pedigree in play.` };

  const late = Math.max(home.played, away.played) >= 4;
  const topTwo = home.group_position <= 2 && away.group_position <= 2;
  const nearLine = Math.abs(home.group_position - away.group_position) <= 2 || Math.abs(home.points - away.points) <= 3;
  const homeRemaining = Math.max(0, (totals.get(entryKey(match.home_entry_id)) || 6) - home.played);
  const awayRemaining = Math.max(0, (totals.get(entryKey(match.away_entry_id)) || 6) - away.played);

  if (late && topTwo) return { score: 35, type: 'stakes', tag: 'Winner-takes-control', story: `Top-of-the-group pressure: a win could put either side in control of Group ${group}.` };
  if (late && nearLine) return { score: 28, type: 'stakes', tag: 'Qualification pressure', story: `Qualification places are tightening in Group ${group}; dropped points here could be expensive.` };
  if (topTwo) return { score: 18, type: 'stakes', tag: 'Group lead at stake', story: `Both teams are in the early Group ${group} chase and can make a statement here.` };
  if (homeRemaining <= 2 || awayRemaining <= 2) return { score: 16, type: 'stakes', tag: 'Must-move week', story: `With games running out, this could reshape the Group ${group} qualification picture.` };
  return { score: 0, type: 'table', tag: `Group ${group} fixture`, story: `${home.team_name} and ${away.team_name} are separated by ${Math.abs(home.points - away.points)} point${Math.abs(home.points - away.points) === 1 ? '' : 's'} in Group ${group}.` };
}
function knockoutStory(match, prestige) {
  if (match.stage !== 'knockout') return null;
  const home = prestige.get(entryKey(match.home_entry_id)) || { score: 0, reasons: [] };
  const away = prestige.get(entryKey(match.away_entry_id)) || { score: 0, reasons: [] };
  const reasons = [...home.reasons, ...away.reasons].slice(0, 2);
  return { score: 20 + home.score + away.score, type: 'knockout', tag: `${match.bracket || 'Cup'} ${roundLabel(match.round)}`, story: reasons.length ? `Knockout tie with ${reasons.join(' and ')} involved.` : 'A place in the next round is on the line.' };
}
function pickHomeUnderdog(match, homePrestige, awayPrestige, homeEntry, awayEntry) {
  const homeSeed = homePrestige.topSeed || 9999;
  const awaySeed = awayPrestige.topSeed || 9999;
  const seedGap = homeSeed - awaySeed;
  if (seedGap >= 14 && awaySeed <= 16) return { underdog: homeEntry, favourite: awayEntry };
  return null;
}
function decorateSpotlight(match, pressure, prestige, entriesMap) {
  const homeEntry = entriesMap.get(entryKey(match.home_entry_id));
  const awayEntry = entriesMap.get(entryKey(match.away_entry_id));
  const home = prestige.get(entryKey(match.home_entry_id)) || { score: 0, reasons: [], storyTypes: new Set(), topSeed: 9999 };
  const away = prestige.get(entryKey(match.away_entry_id)) || { score: 0, reasons: [], storyTypes: new Set(), topSeed: 9999 };
  const group = match.groups?.code || 'group';
  const holderEntry = home.storyTypes?.has('holder') ? homeEntry : away.storyTypes?.has('holder') ? awayEntry : null;
  const holderRecord = home.storyTypes?.has('holder') ? home : away.storyTypes?.has('holder') ? away : null;
  const homeUnderdog = pickHomeUnderdog(match, home, away, homeEntry, awayEntry);
  const pedigreeReasons = [...home.reasons, ...away.reasons].filter((reason) => !reason.includes('seed') && !reason.includes('holder')).slice(0, 2);
  const topSeedEntry = (home.topSeed || 9999) < (away.topSeed || 9999) ? homeEntry : awayEntry;
  const topSeed = Math.min(home.topSeed || 9999, away.topSeed || 9999);

  if (pressure.score >= 25) return { type: 'stakes', tag: pressure.tag, story: pressure.story };
  if (holderEntry) {
    const label = holderRecord?.shieldWins > holderRecord?.cupWins ? 'Shield holders' : 'Youth Cup holders';
    return { type: 'holder', tag: 'Holder watch', story: `${describeManager(holderEntry)} arrive as ${label}. The first job is simple enough: avoid becoming someone else's headline.` };
  }
  if (homeUnderdog) {
    return { type: 'underdog', tag: 'Home underdog watch', story: `${describeManager(homeUnderdog.underdog)} have home advantage against ${describeManager(homeUnderdog.favourite)}. This is exactly the sort of tie where the favourite has to stay switched on.` };
  }
  if (match.stage === 'group' && topSeed <= 8) {
    return { type: 'seed', tag: 'Seed under pressure', story: `${describeManager(topSeedEntry)} are seeded to set the pace in Group ${group}. These are the fixtures favourites are expected to win cleanly.` };
  }
  if (homeEntry?.managers && awayEntry?.managers && managerName(homeEntry) !== 'TBC' && managerName(awayEntry) !== 'TBC') {
    return { type: 'manager', tag: 'Manager duel', story: `${managerName(homeEntry)} and ${managerName(awayEntry)} get a direct tactical read on each other here. The result may matter less than the message it sends.` };
  }
  if (pedigreeReasons.length) {
    return { type: 'pedigree', tag: 'Honours pedigree', story: `There is Youth Cup history on show here: ${pedigreeReasons.join(' and ')}. That gives this one a bit more weight than an ordinary group fixture.` };
  }
  if (match.stage === 'knockout') {
    return { type: 'knockout', tag: `${match.bracket || 'Cup'} ${roundLabel(match.round)}`, story: `${describeEntry(homeEntry)} against ${describeEntry(awayEntry)}. No table maths now, just survive and move on.` };
  }
  return { type: 'spotlight', tag: `Group ${group} watch`, story: `${describeEntry(homeEntry)} meet ${describeEntry(awayEntry)} in a fixture that should help define the shape of Group ${group}.` };
}

export function fixtureSpotlights(matches, entries, honours, tables, tournamentId) {
  const upcoming = upcomingMatches(matches);
  if (!upcoming.length) return [];
  const firstDate = upcoming[0].fixture_date;
  const candidates = upcoming.filter((match) => match.fixture_date === firstDate);
  const prestige = buildPrestige(entries, honours, tournamentId);
  const totals = groupFixtureTotals(matches);
  const entriesMap = entryById(entries);
  const scored = candidates.map((match) => {
    const homePrestige = prestige.get(entryKey(match.home_entry_id)) || { score: 0, topSeed: 9999 };
    const awayPrestige = prestige.get(entryKey(match.away_entry_id)) || { score: 0, topSeed: 9999 };
    const pressure = knockoutStory(match, prestige) || tablePressure(match, tables, totals);
    const seedGap = Math.abs((homePrestige.topSeed || 9999) - (awayPrestige.topSeed || 9999));
    const homeUnderdogBonus = pickHomeUnderdog(match, homePrestige, awayPrestige) ? 10 : 0;
    const narrative = decorateSpotlight(match, pressure, prestige, entriesMap);
    return { ...match, spotlightScore: pressure.score + homePrestige.score + awayPrestige.score + (seedGap >= 28 ? 4 : 0) + homeUnderdogBonus, spotlightTag: narrative.tag, spotlightStory: narrative.story, spotlightType: narrative.type };
  }).sort((a, b) => b.spotlightScore - a.spotlightScore || groupSort(a, b));

  const wantedTypes = ['holder', 'stakes', 'underdog', 'seed', 'manager', 'pedigree', 'knockout', 'spotlight'];
  const selected = [];
  const usedTeams = new Set();
  const usedGroups = new Set();

  for (const type of wantedTypes) {
    const match = scored.find((candidate) => candidate.spotlightType === type && !selected.some((chosen) => chosen.id === candidate.id) && !usedTeams.has(entryKey(candidate.home_entry_id)) && !usedTeams.has(entryKey(candidate.away_entry_id)) && !usedGroups.has(candidate.groups?.code || candidate.bracket || 'fixture'));
    if (match) {
      selected.push(match);
      usedTeams.add(entryKey(match.home_entry_id));
      usedTeams.add(entryKey(match.away_entry_id));
      usedGroups.add(match.groups?.code || match.bracket || 'fixture');
      if (selected.length >= 4) break;
    }
  }

  for (const match of scored) {
    if (selected.length >= 4) break;
    if (!selected.some((chosen) => chosen.id === match.id)) selected.push(match);
  }

  return selected;
}
