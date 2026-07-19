const ROUND_ORDER = ['R64', 'R32', 'R16', 'QF', 'SF', 'Final'];
const ROUND_LABELS = { R64: 'Round of 64', R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-finals', SF: 'Semi-finals', Final: 'Final' };

const key = (value) => String(value || '');
const isCompleted = (match) => match.status === 'played' || match.status === 'forfeit';
const roundIndex = (round) => { const index = ROUND_ORDER.indexOf(round); return index >= 0 ? index : 99; };
const roundLabel = (round) => ROUND_LABELS[round] || round || 'Round';
const managerName = (entry) => entry?.managers?.display_name || entry?.managers?.name || 'TBC';
const clubName = (entry) => entry?.teams?.name || 'TBC';
const describeManager = (entry) => managerName(entry) !== 'TBC' ? `${managerName(entry)}'s ${clubName(entry)}` : clubName(entry);

function parseDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}
function todayUtc() { const now = new Date(); return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())); }
function sortMatches(a, b) {
  return (parseDate(a.fixture_date)?.getTime() || 0) - (parseDate(b.fixture_date)?.getTime() || 0)
    || String(a.groups?.code || a.bracket || '').localeCompare(String(b.groups?.code || b.bracket || ''))
    || roundIndex(a.round) - roundIndex(b.round)
    || Number(a.match_order || 0) - Number(b.match_order || 0);
}
function tablesByEntry(tables) {
  const map = new Map();
  tables.forEach((table) => table.rows.forEach((row) => map.set(key(row.entry_id), { ...row, group_code: table.groupCode })));
  return map;
}
function entriesById(entries) { return new Map(entries.map((entry) => [key(entry.id), entry])); }
function resultScore(match) { return `${match.home_score}–${match.away_score}`; }
function winnerSide(match) {
  const home = Number(match.home_score); const away = Number(match.away_score);
  if (home > away) return 'home';
  if (away > home) return 'away';
  return 'draw';
}
function groupPositionText(row) {
  if (!row?.group_position) return '';
  return row.group_position === 1 ? 'top of the group' : row.group_position === 2 ? 'in the second qualification place' : row.group_position === 3 ? 'in the Shield place' : 'outside the qualification places';
}

function completedNarrative(match, entryMap, rowMap) {
  const homeEntry = entryMap.get(key(match.home_entry_id));
  const awayEntry = entryMap.get(key(match.away_entry_id));
  const homeRow = rowMap.get(key(match.home_entry_id));
  const awayRow = rowMap.get(key(match.away_entry_id));
  const group = match.groups?.code || homeRow?.group_code || awayRow?.group_code || 'group';
  const side = winnerSide(match);
  const forfeitSuffix = match.status === 'forfeit' ? ' The result was recorded as a forfeit.' : '';

  if (side === 'draw') {
    return {
      type: 'result',
      tag: `Group ${group} talking point`,
      story: `${clubName(homeEntry)} and ${clubName(awayEntry)} shared the points in a ${resultScore(match)} draw. ${clubName(homeEntry)} are now ${groupPositionText(homeRow)}, while ${clubName(awayEntry)} are ${groupPositionText(awayRow)}.${forfeitSuffix}`,
      score: 35,
    };
  }

  const winnerEntry = side === 'home' ? homeEntry : awayEntry;
  const loserEntry = side === 'home' ? awayEntry : homeEntry;
  const winnerRow = side === 'home' ? homeRow : awayRow;
  const margin = Math.abs(Number(match.home_score) - Number(match.away_score));
  const tag = match.status === 'forfeit' ? 'Forfeit changes the picture' : margin >= 3 ? 'Statement win' : winnerRow?.group_position === 1 ? 'New group leader' : 'Opening-round mover';
  const type = match.status === 'forfeit' ? 'forfeit' : margin >= 3 ? 'statement' : winnerRow?.group_position === 1 ? 'leader' : 'result';
  const story = `${describeManager(winnerEntry)} beat ${clubName(loserEntry)} ${resultScore(match)}${match.status === 'forfeit' ? ' by forfeit' : ''} and are now ${groupPositionText(winnerRow)} in Group ${group}. ${margin >= 3 ? 'That goal difference could matter later.' : 'The first table has already started to take shape.'}`;
  return { type, tag, story, score: 45 + margin * 3 + (winnerRow?.group_position === 1 ? 8 : 0) + (match.status === 'forfeit' ? 6 : 0) };
}

function upcomingNarrative(match, entryMap, rowMap) {
  const homeEntry = entryMap.get(key(match.home_entry_id));
  const awayEntry = entryMap.get(key(match.away_entry_id));
  const homeRow = rowMap.get(key(match.home_entry_id));
  const awayRow = rowMap.get(key(match.away_entry_id));
  const group = match.groups?.code || homeRow?.group_code || awayRow?.group_code || 'group';

  if (match.stage === 'knockout') return { type: 'knockout', tag: `${match.bracket || 'Cup'} ${roundLabel(match.round)}`, story: `${clubName(homeEntry)} face ${clubName(awayEntry)} with a place in the next round at stake.`, score: 50 };
  if (homeRow?.played || awayRow?.played) {
    const gap = Math.abs(Number(homeRow?.points || 0) - Number(awayRow?.points || 0));
    const topClash = homeRow?.group_position <= 2 && awayRow?.group_position <= 2;
    return {
      type: topClash ? 'stakes' : 'table',
      tag: topClash ? 'Group lead at stake' : `Group ${group} pressure`,
      story: `${clubName(homeEntry)} are ${groupPositionText(homeRow)} and ${clubName(awayEntry)} are ${groupPositionText(awayRow)}. They are separated by ${gap} point${gap === 1 ? '' : 's'} before this fixture.`,
      score: topClash ? 42 : 28 - Math.min(gap, 10),
    };
  }
  const seedGap = Math.abs(Number(homeEntry?.seed || 999) - Number(awayEntry?.seed || 999));
  return {
    type: seedGap >= 20 ? 'underdog' : 'opening',
    tag: seedGap >= 20 ? 'Upset watch' : `Group ${group} opener`,
    story: seedGap >= 20 ? `${describeManager(homeEntry)} have a chance to upset the seedings against ${describeManager(awayEntry)}.` : `${describeManager(homeEntry)} meet ${describeManager(awayEntry)} as Group ${group} begins to take shape.`,
    score: seedGap >= 20 ? 30 : 15,
  };
}

function selectDistinct(candidates) {
  const selected = [];
  const usedTeams = new Set();
  const usedGroups = new Set();
  for (const candidate of candidates) {
    if (selected.length >= 4) break;
    const home = key(candidate.home_entry_id); const away = key(candidate.away_entry_id); const group = candidate.groups?.code || candidate.bracket || 'fixture';
    if ((usedTeams.has(home) || usedTeams.has(away)) && selected.length < 3) continue;
    if (usedGroups.has(group) && selected.length < 2) continue;
    selected.push(candidate); usedTeams.add(home); usedTeams.add(away); usedGroups.add(group);
  }
  for (const candidate of candidates) { if (selected.length >= 4) break; if (!selected.some((item) => item.id === candidate.id)) selected.push(candidate); }
  return selected;
}

export function fixtureSpotlights(matches, entries, honours, tables) {
  const entryMap = entriesById(entries);
  const rowMap = tablesByEntry(tables);
  const today = todayUtc();
  const completed = matches.filter((match) => isCompleted(match) && parseDate(match.fixture_date) && parseDate(match.fixture_date) <= today).sort((a, b) => sortMatches(b, a));
  const latestCompletedDate = completed[0]?.fixture_date;
  const recentResults = latestCompletedDate ? completed.filter((match) => match.fixture_date === latestCompletedDate) : [];
  const upcoming = matches.filter((match) => !isCompleted(match) && parseDate(match.fixture_date) && parseDate(match.fixture_date) >= today).sort(sortMatches);
  const nextDate = upcoming[0]?.fixture_date;
  const nextFixtures = nextDate ? upcoming.filter((match) => match.fixture_date === nextDate) : [];

  const candidates = [];
  recentResults.forEach((match) => { const narrative = completedNarrative(match, entryMap, rowMap); candidates.push({ ...match, spotlightType: narrative.type, spotlightTag: narrative.tag, spotlightStory: narrative.story, spotlightScore: narrative.score, spotlightIsResult: true }); });
  nextFixtures.forEach((match) => { const narrative = upcomingNarrative(match, entryMap, rowMap); candidates.push({ ...match, spotlightType: narrative.type, spotlightTag: narrative.tag, spotlightStory: narrative.story, spotlightScore: narrative.score, spotlightIsResult: false }); });

  return selectDistinct(candidates.sort((a, b) => b.spotlightScore - a.spotlightScore || sortMatches(a, b)));
}
