import { useEffect, useMemo, useState } from 'react';
import KnockoutBracket from './KnockoutBracket.jsx';
import MatchComments from './MatchComments.jsx';
import WinnersArchive from './WinnersArchive.jsx';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const ROUND_ORDER = ['R64', 'R32', 'R16', 'QF', 'SF', 'Final'];
const RULES_URL = 'https://smtop100.blog/youth-cup-format-rules/';
const ROUND_LABELS = { R64: 'Round of 64', R32: 'Round of 32', R16: 'Round of 16', QF: 'Quarter-finals', SF: 'Semi-finals', Final: 'Final' };

const entryKey = (id) => String(id || '');
const isCompleted = (match) => match.status === 'played' || match.status === 'forfeit';
const teamName = (entry, fallback) => entry?.teams?.name || fallback || 'TBC';
const managerName = (entry) => entry?.managers?.display_name || entry?.managers?.name || 'TBC';
const roundIndex = (round) => { const index = ROUND_ORDER.indexOf(round); return index >= 0 ? index : 99; };
const roundLabel = (round) => ROUND_LABELS[round] || round || 'Round';
const parseDate = (dateString) => { if (!dateString) return null; const [year, month, day] = String(dateString).slice(0, 10).split('-').map(Number); const date = new Date(Date.UTC(year, month - 1, day)); return Number.isNaN(date.getTime()) ? null : date; };
const todayUtc = () => { const now = new Date(); return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())); };
const formatDate = (dateString) => { const date = parseDate(dateString); return date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : (dateString || ''); };
const formatShortDate = (dateString) => { const date = parseDate(dateString); return date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : (dateString || ''); };
const dateKey = (bracket, round) => `${bracket || 'Cup'}|${round || 'Round'}`;

function roundSort(a, b) {
  return String(a.bracket || '').localeCompare(String(b.bracket || '')) || roundIndex(a.round) - roundIndex(b.round) || Number(a.match_order || 0) - Number(b.match_order || 0) || Number(a.leg || 1) - Number(b.leg || 1);
}
function groupSort(a, b) {
  return String(a.groups?.code || '').localeCompare(String(b.groups?.code || '')) || String(a.round || '').localeCompare(String(b.round || ''), undefined, { numeric: true }) || Number(a.match_order || 0) - Number(b.match_order || 0);
}
function tableSort(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
  if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
  if (a.seed && b.seed && a.seed !== b.seed) return a.seed - b.seed;
  return a.team_name.localeCompare(b.team_name);
}
function dateRange(row) {
  if (!row?.leg1_date && !row?.leg2_date) return '—';
  if (row.leg1_date && row.leg2_date) return `${formatShortDate(row.leg1_date)} & ${formatShortDate(row.leg2_date)}`;
  return formatShortDate(row.leg1_date || row.leg2_date);
}
function sectionDateLabel(matches) {
  const dates = [...new Set(matches.map((match) => match.fixture_date).filter(Boolean))].sort();
  if (!dates.length) return '';
  if (dates.length === 1) return formatDate(dates[0]);
  return `${formatDate(dates[0])} / ${formatDate(dates[dates.length - 1])}`;
}
function applyRoundDates(matches, roundDates) {
  const dateMap = new Map((roundDates || []).map((row) => [dateKey(row.bracket, row.round), row]));
  return matches.map((match) => {
    if (match.fixture_date || match.stage !== 'knockout') return match;
    const row = dateMap.get(dateKey(match.bracket || 'Cup', match.round));
    if (!row) return match;
    const fixtureDate = Number(match.leg || 1) === 2 ? (row.leg2_date || row.leg1_date) : row.leg1_date;
    return fixtureDate ? { ...match, fixture_date: fixtureDate } : match;
  });
}
function groupMatches(matches) {
  return matches.reduce((groups, match) => {
    const key = match.stage === 'group' ? `Group ${match.groups?.code || 'Ungrouped'}` : `${match.bracket || 'Knockout'} · ${roundLabel(match.round || 'Round')}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(match);
    return groups;
  }, {});
}
const bracketsFrom = (matches) => [...new Set(matches.filter((match) => match.stage === 'knockout').map((match) => match.bracket || 'Cup'))].sort((a, b) => String(a).localeCompare(String(b)));
const roundsFrom = (matches) => [...new Set(matches.filter((match) => match.stage === 'knockout').map((match) => match.round || 'Round'))].sort((a, b) => roundIndex(a) - roundIndex(b) || String(a).localeCompare(String(b)));
const groupCodesFrom = (matches) => [...new Set(matches.filter((match) => match.stage === 'group').map((match) => match.groups?.code || 'Ungrouped'))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
function matchSideClass(match, side) {
  if (!isCompleted(match) || match.home_score === null || match.away_score === null) return 'result-side';
  const homeWon = Number(match.home_score) > Number(match.away_score);
  const awayWon = Number(match.away_score) > Number(match.home_score);
  if (side === 'home' && homeWon) return 'result-side winner';
  if (side === 'away' && awayWon) return 'result-side winner';
  if ((side === 'home' && awayWon) || (side === 'away' && homeWon)) return 'result-side loser';
  return 'result-side draw';
}
function blankTableRow(entry) {
  return { entry_id: entry.id, team_name: entry.teams?.name || 'Unknown team', manager_name: managerName(entry), seed: entry.seed, rating: entry.rating, pot: entry.pot, group_code: entry.group_code, prize_draw_eligible: entry.prize_draw_eligible, played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0, group_position: null };
}
function buildTables(entries, matches) {
  const byGroup = entries.reduce((groups, entry) => { const code = entry.group_code || 'Ungrouped'; if (!groups[code]) groups[code] = []; groups[code].push(entry); return groups; }, {});
  return Object.entries(byGroup).sort(([a], [b]) => a.localeCompare(b)).map(([groupCode, groupEntries]) => {
    const rowsById = new Map(groupEntries.map((entry) => [entry.id, blankTableRow(entry)]));
    matches.filter((match) => match.stage === 'group' && (match.groups?.code || groupCode) === groupCode).filter(isCompleted).forEach((match) => {
      const home = rowsById.get(match.home_entry_id);
      const away = rowsById.get(match.away_entry_id);
      if (!home || !away) return;
      const hs = Number(match.home_score || 0), as = Number(match.away_score || 0);
      home.played += 1; away.played += 1; home.goals_for += hs; home.goals_against += as; away.goals_for += as; away.goals_against += hs;
      if (hs > as) { home.wins += 1; home.points += 3; away.losses += 1; }
      else if (as > hs) { away.wins += 1; away.points += 3; home.losses += 1; }
      else { home.draws += 1; away.draws += 1; home.points += 1; away.points += 1; }
    });
    const rows = [...rowsById.values()].map((row) => ({ ...row, goal_difference: row.goals_for - row.goals_against })).sort(tableSort).map((row, index) => ({ ...row, group_position: index + 1 }));
    return { groupCode, rows };
  });
}
const allTableRows = (tables) => tables.flatMap((table) => table.rows.map((row) => ({ ...row, group_code: table.groupCode })));
const rowsByFinish = (tables, position) => allTableRows(tables).filter((row) => row.group_position === position).sort(tableSort);
const seedRows = (entries) => [...entries].sort((a, b) => Number(a.seed || 9999) - Number(b.seed || 9999) || Number(b.rating || 0) - Number(a.rating || 0) || String(a.teams?.name || '').localeCompare(String(b.teams?.name || '')));
const ordinal = (position) => position === 1 ? '1st' : position === 2 ? '2nd' : position === 3 ? '3rd' : `${position}th`;
const rankMedal = (index) => index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '';
const roundDateSummary = (rows) => [...rows].sort((a, b) => String(a.bracket || '').localeCompare(String(b.bracket || '')) || roundIndex(a.round) - roundIndex(b.round)).filter((row) => row.leg1_date || row.leg2_date);
function scheduleMatrix(rows) {
  const brackets = [...new Set(rows.map((row) => row.bracket || 'Cup'))].sort((a, b) => String(a).localeCompare(String(b)));
  const rounds = [...new Set(rows.map((row) => row.round || 'Round'))].sort((a, b) => roundIndex(a) - roundIndex(b) || String(a).localeCompare(String(b)));
  const lookup = new Map(rows.map((row) => [dateKey(row.bracket, row.round), row]));
  return { brackets, rounds, lookup };
}
function groupFixtureSchedule(matches) {
  const rows = new Map();
  matches.filter((match) => match.stage === 'group').forEach((match) => {
    const key = match.round || 'Group round';
    if (!rows.has(key)) rows.set(key, { round: key, dates: new Set(), fixtures: 0 });
    const row = rows.get(key);
    row.fixtures += 1;
    if (match.fixture_date) row.dates.add(match.fixture_date);
  });
  return [...rows.values()].map((row) => ({ ...row, dates: [...row.dates].sort() })).sort((a, b) => String(a.round).localeCompare(String(b.round), undefined, { numeric: true }));
}
const groupScheduleDate = (row) => !row.dates.length ? 'Date TBC' : row.dates.length === 1 ? formatShortDate(row.dates[0]) : `${formatShortDate(row.dates[0])} – ${formatShortDate(row.dates[row.dates.length - 1])}`;
const upcomingMatches = (matches) => { const today = todayUtc(); return matches.filter((match) => !isCompleted(match) && parseDate(match.fixture_date) && parseDate(match.fixture_date) >= today).sort((a, b) => parseDate(a.fixture_date) - parseDate(b.fixture_date) || roundSort(a, b)); };
const countdownText = (match) => { const date = parseDate(match?.fixture_date); if (!date) return 'Date TBC'; const days = Math.round((date - todayUtc()) / 86400000); if (days === 0) return 'Today'; if (days === 1) return 'Tomorrow'; return days > 1 ? `${days} days` : 'In progress'; };
const fixtureTitle = (match) => `${teamName(match.home_entry, match.home_placeholder)} v ${teamName(match.away_entry, match.away_placeholder)}`;
function competitionStats(matches, entries, tables, forfeits) {
  const played = matches.filter(isCompleted);
  const goals = played.reduce((total, match) => total + Number(match.home_score || 0) + Number(match.away_score || 0), 0);
  const groupLeaders = tables.flatMap((table) => table.rows.filter((row) => row.group_position === 1)).length;
  return { teams: entries.length, fixtures: matches.length, played: played.length, remaining: matches.length - played.length, goals, avgGoals: played.length ? (goals / played.length).toFixed(2) : '—', groupLeaders, forfeits: forfeits.length };
}
const latestWinner = (ordered) => [...ordered].reverse().find((leg) => leg.winner_entry_id)?.winner_entry_id || null;
function decisionText(winnerName, firstAway, secondAway, decidingLeg) {
  if (firstAway !== secondAway) return `away goals ${firstAway}-${secondAway}`;
  if (!decidingLeg) return winnerName === 'FET/manual winner needed' ? 'FET/manual decision needed' : 'tie-break';
  if (decidingLeg.home_extra_time_score !== null || decidingLeg.away_extra_time_score !== null) return `FET ${decidingLeg.home_extra_time_score ?? 0}-${decidingLeg.away_extra_time_score ?? 0}`;
  if (decidingLeg.home_penalty_score !== null || decidingLeg.away_penalty_score !== null) return `penalties ${decidingLeg.home_penalty_score ?? 0}-${decidingLeg.away_penalty_score ?? 0}`;
  return String(decidingLeg.decided_by || 'tie-break').replace(/_/g, ' ');
}
function finalSummary(matches, bracket) {
  const finals = matches.filter((match) => match.stage === 'knockout' && match.bracket === bracket && match.round === 'Final').sort((a, b) => Number(a.leg || 1) - Number(b.leg || 1));
  if (!finals.length || finals.some((match) => !isCompleted(match))) return null;
  const first = finals[0], firstId = first.home_entry_id, secondId = first.away_entry_id;
  const firstName = teamName(first.home_entry, first.home_placeholder), secondName = teamName(first.away_entry, first.away_placeholder);
  let firstAgg = 0, secondAgg = 0, firstAway = 0, secondAway = 0;
  finals.forEach((leg) => { const home = Number(leg.home_score || 0), away = Number(leg.away_score || 0); if (leg.home_entry_id === firstId) { firstAgg += home; secondAgg += away; secondAway += away; } else { firstAgg += away; secondAgg += home; firstAway += away; } });
  const winnerId = firstAgg > secondAgg ? firstId : secondAgg > firstAgg ? secondId : firstAway > secondAway ? firstId : secondAway > firstAway ? secondId : latestWinner(finals);
  const winnerName = winnerId === firstId ? firstName : winnerId === secondId ? secondName : 'FET/manual winner needed';
  const decidingLeg = [...finals].reverse().find((leg) => leg.decided_by || leg.home_extra_time_score !== null || leg.away_extra_time_score !== null || leg.home_penalty_score !== null || leg.away_penalty_score !== null);
  const decision = firstAgg === secondAgg ? decisionText(winnerName, firstAway, secondAway, decidingLeg) : null;
  return { bracket, winnerName, firstName, secondName, aggregate: `${firstAgg}-${secondAgg}`, decision, legs: finals };
}

function honourType(row) { const value = `${row?.honour || ''} ${row?.tournaments?.name || ''}`.toLowerCase(); return value.includes('shield') ? 'shield' : 'cup'; }
function honourSeason(row) { const match = String(row?.tournaments?.name || '').match(/S\s*(\d+)/i); return match ? Number(match[1]) : 0; }
function entryById(entries) { return new Map(entries.map((entry) => [entryKey(entry.id), entry])); }
function describeEntry(entry) { return `${entry?.teams?.name || 'TBC'}${entry?.managers ? ` (${managerName(entry)})` : ''}`; }
function groupRowsMap(tables) { const map = new Map(); tables.forEach((table) => table.rows.forEach((row) => map.set(entryKey(row.entry_id), row))); return map; }
function groupFixtureTotals(matches) {
  const totals = new Map();
  matches.filter((match) => match.stage === 'group').forEach((match) => [match.home_entry_id, match.away_entry_id].forEach((id) => totals.set(entryKey(id), (totals.get(entryKey(id)) || 0) + 1)));
  return totals;
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
    if (type === 'shield') record.shieldWins += 1; else record.cupWins += 1;
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
function decorateSpotlight(match, pressure, prestige, entriesMap) {
  const homeEntry = entriesMap.get(entryKey(match.home_entry_id));
  const awayEntry = entriesMap.get(entryKey(match.away_entry_id));
  const home = prestige.get(entryKey(match.home_entry_id)) || { score: 0, reasons: [], storyTypes: new Set(), topSeed: 9999 };
  const away = prestige.get(entryKey(match.away_entry_id)) || { score: 0, reasons: [], storyTypes: new Set(), topSeed: 9999 };
  const seedGap = Math.abs((home.topSeed || 9999) - (away.topSeed || 9999));
  const underdogEntry = (home.topSeed || 9999) > (away.topSeed || 9999) ? homeEntry : awayEntry;
  const favouriteEntry = underdogEntry === homeEntry ? awayEntry : homeEntry;
  const holderEntry = home.storyTypes?.has('holder') ? homeEntry : away.storyTypes?.has('holder') ? awayEntry : null;
  const pedigreeReasons = [...home.reasons, ...away.reasons].filter((reason) => !reason.includes('seed')).slice(0, 2);
  if (pressure.score >= 25) return { type: 'stakes', tag: pressure.tag, story: pressure.story };
  if (holderEntry) return { type: 'holder', tag: 'Holder watch', story: `${describeEntry(holderEntry)} begin their defence under the spotlight.` };
  if (seedGap >= 20 && Math.min(home.topSeed || 9999, away.topSeed || 9999) <= 8) return { type: 'underdog', tag: 'Upset watch', story: `${describeEntry(underdogEntry)} get a shot at a major scalp against ${describeEntry(favouriteEntry)}.` };
  if (homeEntry?.managers || awayEntry?.managers) {
    const managerEntry = (home.score >= away.score ? homeEntry : awayEntry) || homeEntry || awayEntry;
    if (managerEntry?.managers) return { type: 'manager', tag: 'Manager spotlight', story: `${managerName(managerEntry)} has ${managerEntry.teams?.name || 'his side'} in one of the round's sharper storylines.` };
  }
  if (pedigreeReasons.length) return { type: 'pedigree', tag: 'Honours pedigree', story: `A fixture with history: ${pedigreeReasons.join(' and ')} involved.` };
  if (Math.min(home.topSeed || 9999, away.topSeed || 9999) <= 8) return { type: 'seed', tag: 'Seed under pressure', story: `A top seed has an early chance to justify the billing — or give the group a twist.` };
  return { type: pressure.type || 'spotlight', tag: pressure.tag, story: pressure.story };
}
function fixtureSpotlights(matches, entries, honours, tables, tournamentId) {
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
    const upsetBonus = seedGap >= 20 && Math.min(homePrestige.topSeed || 9999, awayPrestige.topSeed || 9999) <= 8 ? 10 : 0;
    const narrative = decorateSpotlight(match, pressure, prestige, entriesMap);
    return { ...match, spotlightScore: pressure.score + homePrestige.score + awayPrestige.score + upsetBonus, spotlightTag: narrative.tag, spotlightStory: narrative.story, spotlightType: narrative.type };
  }).sort((a, b) => b.spotlightScore - a.spotlightScore || groupSort(a, b));
  const wantedTypes = ['holder', 'stakes', 'underdog', 'manager', 'pedigree', 'seed'];
  const selected = [];
  const usedTeams = new Set();
  const usedGroups = new Set();
  for (const type of wantedTypes) {
    const match = scored.find((candidate) => candidate.spotlightType === type && !selected.some((chosen) => chosen.id === candidate.id) && !usedTeams.has(entryKey(candidate.home_entry_id)) && !usedTeams.has(entryKey(candidate.away_entry_id)) && !usedGroups.has(candidate.groups?.code || candidate.bracket || 'fixture'));
    if (match) {
      selected.push(match);
      usedTeams.add(entryKey(match.home_entry_id)); usedTeams.add(entryKey(match.away_entry_id));
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

export default function PublicTournamentPage({ tournamentId }) {
  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState([]);
  const [entries, setEntries] = useState([]);
  const [roundDates, setRoundDates] = useState([]);
  const [honours, setHonours] = useState([]);
  const [forfeits, setForfeits] = useState([]);
  const [status, setStatus] = useState('Loading tournament...');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [selectedBracket, setSelectedBracket] = useState('all');
  const [selectedRound, setSelectedRound] = useState('all');

  useEffect(() => { if (hasSupabaseConfig && supabase && tournamentId) loadTournament(); }, [tournamentId]);

  const datedMatches = useMemo(() => applyRoundDates(matches, roundDates), [matches, roundDates]);
  const winners = useMemo(() => bracketsFrom(datedMatches).map((bracket) => finalSummary(datedMatches, bracket)).filter(Boolean), [datedMatches]);
  const hasHistoricWinners = honours.some((row) => Number(row.tournament_id) !== Number(tournamentId) && String(row.honour || '').toLowerCase().includes('winner'));
  const groupOptions = useMemo(() => groupCodesFrom(datedMatches), [datedMatches]);
  const knockoutBracketOptions = useMemo(() => bracketsFrom(datedMatches), [datedMatches]);
  const knockoutRoundOptions = useMemo(() => roundsFrom(datedMatches.filter((match) => selectedBracket === 'all' || (match.bracket || 'Cup') === selectedBracket)), [datedMatches, selectedBracket]);
  const filteredGroupMatches = useMemo(() => datedMatches.filter((match) => match.stage === 'group' && (selectedGroup === 'all' || (match.groups?.code || 'Ungrouped') === selectedGroup)).sort(groupSort), [datedMatches, selectedGroup]);
  const filteredKnockoutMatches = useMemo(() => datedMatches.filter((match) => match.stage === 'knockout' && (selectedBracket === 'all' || (match.bracket || 'Cup') === selectedBracket) && (selectedRound === 'all' || (match.round || 'Round') === selectedRound)).sort(roundSort), [datedMatches, selectedBracket, selectedRound]);
  const groupResults = useMemo(() => groupMatches(filteredGroupMatches), [filteredGroupMatches]);
  const knockoutResults = useMemo(() => groupMatches(filteredKnockoutMatches), [filteredKnockoutMatches]);
  const knockoutBrackets = useMemo(() => bracketsFrom(datedMatches), [datedMatches]);
  const tables = useMemo(() => buildTables(entries, datedMatches), [entries, datedMatches]);
  const orderedSeeds = useMemo(() => seedRows(entries), [entries]);
  const finishTables = useMemo(() => [1, 2, 3].map((position) => ({ position, rows: rowsByFinish(tables, position) })), [tables]);
  const scheduleRows = useMemo(() => roundDateSummary(roundDates), [roundDates]);
  const groupScheduleRows = useMemo(() => groupFixtureSchedule(datedMatches), [datedMatches]);
  const nextFixtures = useMemo(() => upcomingMatches(datedMatches), [datedMatches]);
  const featured = useMemo(() => fixtureSpotlights(datedMatches, entries, honours, tables, tournamentId), [datedMatches, entries, honours, tables, tournamentId]);
  const stats = useMemo(() => competitionStats(datedMatches, entries, tables, forfeits), [datedMatches, entries, tables, forfeits]);

  async function loadTournament() {
    setStatus('Loading tournament page...');
    const tournamentResult = await supabase.from('tournaments').select('id, name, status, rules_notes, secondary_bracket_name, max_entries, actual_entries, group_count, teams_per_group, knockout_teams').eq('id', tournamentId).maybeSingle();
    if (tournamentResult.error || !tournamentResult.data) { setStatus('Tournament not found.'); return; }
    const [matchesResult, entriesResult, roundDatesResult] = await Promise.all([
      supabase.from('matches').select('id, stage, round, leg, match_order, fixture_date, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, decided_by, home_extra_time_score, away_extra_time_score, home_penalty_score, away_penalty_score, status, bracket, home_placeholder, away_placeholder, groups(id, code, name), home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(id, name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(id, name))').eq('tournament_id', tournamentId),
      supabase.from('tournament_entries').select('id, seed, rating, pot, group_code, prize_draw_eligible, teams(id, name), managers(id, name, display_name)').eq('tournament_id', tournamentId).order('seed', { ascending: true }),
      supabase.from('tournament_round_dates').select('id, bracket, round, leg1_date, leg2_date').eq('tournament_id', tournamentId),
    ]);
    setTournament(tournamentResult.data);
    setMatches(matchesResult.error ? [] : (matchesResult.data || []));
    setEntries(entriesResult.error ? [] : (entriesResult.data || []));
    setRoundDates(roundDatesResult.error ? [] : (roundDatesResult.data || []));
    setSelectedGroup('all'); setSelectedBracket('all'); setSelectedRound('all');
    if (matchesResult.error) { setStatus('Could not load fixtures: ' + matchesResult.error.message); return; }
    setStatus('Tournament page loaded.');
    Promise.all([
      supabase.from('honours').select('id, honour, position, tournament_id, tournaments(id, name), entry:tournament_entries!honours_entry_id_fkey(id, teams(id, name), managers(id, name, display_name))').order('tournament_id', { ascending: false }),
      supabase.from('forfeits').select('id, reason, penalty, affects_prize_draw, match_id, forfeiting_entry:tournament_entries!forfeits_forfeiting_entry_id_fkey(id, teams(id, name), managers(id, name, display_name))'),
    ]).then(([honoursResult, forfeitsResult]) => {
      if (!honoursResult.error) setHonours(honoursResult.data || []);
      if (!forfeitsResult.error) { const currentMatchIds = new Set((matchesResult.data || []).map((match) => match.id)); setForfeits((forfeitsResult.data || []).filter((row) => currentMatchIds.has(row.match_id))); }
    }).catch(() => {});
  }

  if (!hasSupabaseConfig || !supabase) return <main className="app-shell"><section className="warning-card"><strong>Supabase is not connected.</strong></section></main>;
  if (!tournament) return <main className="app-shell"><section className="card"><h1>Tournament page</h1><p className="status">{status}</p></section></main>;
  const nextFixture = nextFixtures[0];

  return <main className="app-shell public-archive tournament-hub">
    <section className="hero tournament-hero"><p className="eyebrow">Top 100 Youth Cup Hub</p><h1>{tournament.name}</h1><p>{tournament.status || 'draft'} · {stats.played} results · {stats.remaining} fixtures remaining · {stats.goals} goals</p><div className="hero-countdown"><span>Next fixture</span><strong>{nextFixture ? countdownText(nextFixture) : 'Complete'}</strong><small>{nextFixture ? `${formatDate(nextFixture.fixture_date)} · ${fixtureTitle(nextFixture)}` : 'No upcoming fixtures listed'}</small></div></section>
    <nav className="public-section-nav" aria-label="Tournament sections"><a href="#summary">Summary</a><a href="#featured">Featured</a><a href="#winners">Winners</a><a href="#groups">Groups</a><a href="#knockout">Knockout</a><a href="#rankings">Best placed tables</a><a href="#fair-play">Fair Play</a><a href="#brackets">Bracket</a></nav>
    <section id="summary" className="card format-summary-card"><div className="public-section-toolbar"><div><p className="eyebrow">Competition summary</p><h2>Tournament overview</h2></div><a className="public-link-button" href={RULES_URL} target="_blank" rel="noreferrer">Read full rules</a></div><div className="hub-stat-grid"><StatCard label="Teams" value={tournament.actual_entries || entries.length || tournament.max_entries || '—'} note={tournament.group_count && tournament.teams_per_group ? `${tournament.group_count} groups of ${tournament.teams_per_group}` : 'Registered entrants'} /><StatCard label="Fixtures" value={stats.fixtures} note={`${stats.played} played, ${stats.remaining} remaining`} /><StatCard label="Goals" value={stats.goals} note={`${stats.avgGoals} per completed match`} /><StatCard label="Forfeits" value={stats.forfeits} note="Fair Play / prize draw watch" /></div><p className="muted">Teams are seeded by average rating into pots for the group draw. Knockout seeding is explained by the best 1st, 2nd and 3rd place tables below.</p>{groupScheduleRows.length > 0 && <GroupSchedule rows={groupScheduleRows} />}{scheduleRows.length > 0 && <KnockoutSchedule rows={scheduleRows} />}</section>
    <section id="featured" className="card"><p className="eyebrow">Spotlight fixtures</p><h2>This week's storylines</h2><div className="featured-match-grid">{featured.length ? featured.map((match) => <FeaturedMatch key={match.id} match={match} tournamentId={tournamentId} />) : <p className="muted">No upcoming featured fixtures yet.</p>}</div></section>
    <section id="winners" className="card winners-card"><p className="eyebrow">Winners</p><h2>Current and previous winners</h2>{winners.length > 0 && <div className="overview-metrics compact-metrics">{winners.map((winner) => <article className="winner-summary-card" key={winner.bracket}><span>🏆 {winner.bracket} winner</span><strong>{winner.winnerName}</strong><small>{winner.firstName} {winner.aggregate} {winner.secondName}{winner.decision ? ` · ${winner.decision}` : ''}</small><div className="mini-results">{winner.legs.map((leg) => <p key={leg.id}>{Number(leg.leg) === 1 ? '1st leg' : '2nd leg'}: {teamName(leg.home_entry, leg.home_placeholder)} {leg.home_score}-{leg.away_score} {teamName(leg.away_entry, leg.away_placeholder)}</p>)}</div></article>)}</div>}{!winners.length && !hasHistoricWinners && <p className="muted">No completed finals yet.</p>}<WinnersArchive rows={honours} currentTournamentId={tournamentId} /></section>
    <section id="groups" className="card"><div className="public-section-toolbar"><div><p className="eyebrow">Group fixtures and results</p><h2>{selectedGroup === 'all' ? 'All groups' : `Group ${selectedGroup}`}</h2></div>{groupOptions.length > 1 && <label className="public-group-filter">Group<select value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)}><option value="all">All groups</option>{groupOptions.map((code) => <option key={code} value={code}>Group {code}</option>)}</select></label>}</div><ResultSections sections={groupResults} tournamentId={tournamentId} /></section>
    <section id="knockout" className="card"><div className="public-section-toolbar"><div><p className="eyebrow">Knockout fixtures and results</p><h2>{selectedBracket === 'all' ? 'All competitions' : selectedBracket}{selectedRound !== 'all' ? ` · ${roundLabel(selectedRound)}` : ''}</h2></div><div className="public-filter-pair">{knockoutBracketOptions.length > 1 && <label className="public-group-filter">Competition<select value={selectedBracket} onChange={(event) => { setSelectedBracket(event.target.value); setSelectedRound('all'); }}><option value="all">All competitions</option>{knockoutBracketOptions.map((bracket) => <option key={bracket} value={bracket}>{bracket}</option>)}</select></label>}{knockoutRoundOptions.length > 1 && <label className="public-group-filter">Round<select value={selectedRound} onChange={(event) => setSelectedRound(event.target.value)}><option value="all">All rounds</option>{knockoutRoundOptions.map((round) => <option key={round} value={round}>{roundLabel(round)}</option>)}</select></label>}</div></div><ResultSections sections={knockoutResults} tournamentId={tournamentId} /></section>
    {tables.length > 0 && <section id="rankings" className="card"><p className="eyebrow">Best placed tables</p><h2>Best 1st, 2nd and 3rd placed teams</h2><p className="muted">Medals highlight the strongest records in each finishing band. Sorting is points, goal difference, goals scored, then original seed.</p><div className="finish-grid">{finishTables.map((table) => <section className="finish-card" key={table.position}><h3>{ordinal(table.position)} placed teams</h3><div className="standings-wrap"><table className="standings-table mini-standings"><thead><tr><th>Rank</th><th>Team</th><th>Grp</th><th>Pts</th><th>GD</th><th>GF</th><th>Seed</th></tr></thead><tbody>{table.rows.map((row, index) => <tr key={row.entry_id} className={index < 3 ? 'medal-row' : ''}><td>{rankMedal(index)} {index + 1}</td><td><strong>{row.team_name}</strong><span>{row.manager_name}</span></td><td>{row.group_code}</td><td><strong>{row.points}</strong></td><td>{row.goal_difference > 0 ? '+' + row.goal_difference : row.goal_difference}</td><td>{row.goals_for}</td><td>{row.seed || '—'}</td></tr>)}</tbody></table></div></section>)}</div></section>}
    <section id="statistics" className="card"><p className="eyebrow">Statistics</p><h2>Tournament numbers</h2><div className="hub-stat-grid"><StatCard label="Completed" value={stats.played} note="Results entered" /><StatCard label="Remaining" value={stats.remaining} note="Fixtures still to play" /><StatCard label="Group winners" value={stats.groupLeaders} note="Current first-place teams" /><StatCard label="Top scorers" value="Future" note="Ready for player scorers data" /></div></section>
    <section id="fair-play" className="card"><p className="eyebrow">Fair Play / forfeits</p><h2>Prize draw eligibility watch</h2><FairPlay forfeits={forfeits} entries={entries} /></section>
    {orderedSeeds.length > 0 && <section id="seedings" className="card"><p className="eyebrow">Draw transparency</p><h2>Rating seedings and pots</h2><div className="standings-wrap"><table className="standings-table seed-table"><thead><tr><th>Seed</th><th>Team</th><th>Manager</th><th>Rating</th><th>Pot</th><th>Group</th></tr></thead><tbody>{orderedSeeds.map((entry) => <tr key={entry.id}><td><strong>{entry.seed || '—'}</strong></td><td><strong>{entry.teams?.name || 'Unknown team'}</strong></td><td>{managerName(entry)}</td><td>{entry.rating ?? '—'}</td><td>{entry.pot ?? '—'}</td><td>{entry.group_code || '—'}</td></tr>)}</tbody></table></div></section>}
    {knockoutBrackets.length > 0 && <section id="brackets" className="card"><p className="eyebrow">Full bracket</p><h2>Cup and Shield bracket</h2><div className="public-bracket-stack">{knockoutBrackets.map((bracket) => <KnockoutBracket key={bracket} title={`${bracket} bracket`} matches={datedMatches.filter((match) => (match.bracket || 'Cup') === bracket)} />)}</div></section>}
  </main>;
}

function StatCard({ label, value, note }) { return <article className="hub-stat-card"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function FeaturedMatch({ match, tournamentId }) { return <article className={`featured-match-card spotlight-match-card spotlight-${match.spotlightType || 'default'}`}><span>{match.spotlightTag || (match.stage === 'knockout' ? `${match.bracket || 'Cup'} · ${roundLabel(match.round)}` : `${match.groups?.code ? `Group ${match.groups.code}` : 'Group stage'} · ${match.round}`)}</span><strong>{fixtureTitle(match)}</strong><small>{formatDate(match.fixture_date)} · {countdownText(match)}</small>{match.spotlightStory && <p>{match.spotlightStory}</p>}<MatchComments match={match} tournamentId={tournamentId} compact /></article>; }
function FairPlay({ forfeits, entries }) { const ineligible = entries.filter((entry) => entry.prize_draw_eligible === false); if (!forfeits.length && !ineligible.length) return <p className="muted">No forfeits recorded. Everyone remains in good standing for now.</p>; return <div className="fair-play-grid">{forfeits.map((row) => <article className="fair-play-card" key={`forfeit-${row.id}`}><strong>{teamName(row.forfeiting_entry)}</strong><span>{managerName(row.forfeiting_entry)}</span><small>{row.reason || 'Forfeit recorded'}{row.affects_prize_draw === false ? ' · prize draw unaffected' : ' · prize draw affected'}</small></article>)}{ineligible.map((entry) => <article className="fair-play-card" key={`entry-${entry.id}`}><strong>{entry.teams?.name || 'Unknown team'}</strong><span>{managerName(entry)}</span><small>Marked not eligible for prize draw</small></article>)}</div>; }
function GroupSchedule({ rows }) { return <div className="schedule-summary compact-schedule"><h3>Group fixture schedule</h3><div className="schedule-table-wrap"><table className="schedule-table"><thead><tr><th>Round</th><th>Date</th><th>Fixtures</th></tr></thead><tbody>{rows.map((row) => <tr key={row.round}><td>{row.round}</td><td>{groupScheduleDate(row)}</td><td>{row.fixtures}</td></tr>)}</tbody></table></div></div>; }
function KnockoutSchedule({ rows }) { const { brackets, rounds, lookup } = scheduleMatrix(rows); if (!rounds.length || !brackets.length) return null; return <div className="schedule-summary compact-schedule"><h3>Knockout schedule</h3><div className="schedule-table-wrap"><table className="schedule-table"><thead><tr><th>Round</th>{brackets.map((bracket) => <th key={bracket}>{bracket}</th>)}</tr></thead><tbody>{rounds.map((round) => <tr key={round}><td>{roundLabel(round)}</td>{brackets.map((bracket) => <td key={`${bracket}-${round}`}>{dateRange(lookup.get(dateKey(bracket, round)))}</td>)}</tr>)}</tbody></table></div></div>; }
function ResultSections({ sections, tournamentId }) { const entries = Object.entries(sections); if (!entries.length) return <p className="muted">No fixtures or results yet.</p>; return <div className="fixture-sections">{entries.map(([title, matches]) => { const dateLabel = sectionDateLabel(matches); return <section className="fixture-section" key={title}><div className="fixture-section-header"><h3>{title}{dateLabel ? ` · ${dateLabel}` : ''}</h3><span>{matches.length} fixtures</span></div><div className="fixture-card-list">{matches.map((match) => <article className={isCompleted(match) ? 'fixture-card played result-highlight-card' : 'fixture-card'} key={match.id}>{match.fixture_date && <p className="fixture-date public-fixture-date">{formatDate(match.fixture_date)}</p>}<div className="fixture-teams result-teams"><strong className={matchSideClass(match, 'home')}>{teamName(match.home_entry, match.home_placeholder)}</strong><span className="fixture-score">{isCompleted(match) ? `${match.home_score} - ${match.away_score}` : 'v'}</span><strong className={matchSideClass(match, 'away')}>{teamName(match.away_entry, match.away_placeholder)}</strong></div><div className="fixture-actions"><span>{roundLabel(match.round)}{match.leg ? ` · ${Number(match.leg) === 1 ? '1st leg' : '2nd leg'}` : ''}</span></div><MatchComments match={match} tournamentId={tournamentId} compact /></article>)}</div></section>; })}</div>; }
