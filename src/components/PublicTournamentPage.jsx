import { useEffect, useMemo, useState } from 'react';
import KnockoutBracket from './KnockoutBracket.jsx';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const ROUND_ORDER = ['R64', 'R32', 'R16', 'QF', 'SF', 'Final'];
const RULES_URL = 'https://smtop100.blog/youth-cup-format-rules/';

function isCompleted(match) { return match.status === 'played' || match.status === 'forfeit'; }
function teamName(entry, fallback) { return entry?.teams?.name || fallback || 'TBC'; }
function roundIndex(round) { const index = ROUND_ORDER.indexOf(round); return index >= 0 ? index : 99; }
function roundSort(a, b) { return String(a.bracket || '').localeCompare(String(b.bracket || '')) || roundIndex(a.round) - roundIndex(b.round) || Number(a.match_order || 0) - Number(b.match_order || 0) || Number(a.leg || 1) - Number(b.leg || 1); }
function groupSort(a, b) { return String(a.groups?.code || '').localeCompare(String(b.groups?.code || '')) || String(a.round || '').localeCompare(String(b.round || ''), undefined, { numeric: true }) || Number(a.match_order || 0) - Number(b.match_order || 0); }
function tableSort(a, b) { if (b.points !== a.points) return b.points - a.points; if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference; if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for; if (a.seed && b.seed && a.seed !== b.seed) return a.seed - b.seed; return a.team_name.localeCompare(b.team_name); }
function formatDate(dateString) { if (!dateString) return ''; const [year, month, day] = String(dateString).slice(0, 10).split('-').map(Number); const date = new Date(Date.UTC(year, month - 1, day)); if (Number.isNaN(date.getTime())) return dateString; return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
function sectionDateLabel(matches) { const dates = [...new Set(matches.map((match) => match.fixture_date).filter(Boolean))].sort(); if (!dates.length) return ''; if (dates.length === 1) return formatDate(dates[0]); return `${formatDate(dates[0])} / ${formatDate(dates[dates.length - 1])}`; }
function dateKey(bracket, round) { return `${bracket || 'Cup'}|${round || 'Round'}`; }
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
function latestWinner(ordered) { return [...ordered].reverse().find((leg) => leg.winner_entry_id)?.winner_entry_id || null; }
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
  const first = finals[0];
  const firstId = first.home_entry_id;
  const secondId = first.away_entry_id;
  const firstName = teamName(first.home_entry, first.home_placeholder);
  const secondName = teamName(first.away_entry, first.away_placeholder);
  let firstAgg = 0, secondAgg = 0, firstAway = 0, secondAway = 0;
  finals.forEach((leg) => {
    const home = Number(leg.home_score || 0), away = Number(leg.away_score || 0);
    if (leg.home_entry_id === firstId) { firstAgg += home; secondAgg += away; secondAway += away; }
    else { firstAgg += away; secondAgg += home; firstAway += away; }
  });
  let winnerId = null;
  if (firstAgg > secondAgg) winnerId = firstId;
  else if (secondAgg > firstAgg) winnerId = secondId;
  else if (firstAway > secondAway) winnerId = firstId;
  else if (secondAway > firstAway) winnerId = secondId;
  else winnerId = latestWinner(finals);
  const winnerName = winnerId === firstId ? firstName : winnerId === secondId ? secondName : 'FET/manual winner needed';
  const decidingLeg = [...finals].reverse().find((leg) => leg.decided_by || leg.home_extra_time_score !== null || leg.away_extra_time_score !== null || leg.home_penalty_score !== null || leg.away_penalty_score !== null);
  const decision = firstAgg === secondAgg ? decisionText(winnerName, firstAway, secondAway, decidingLeg) : null;
  return { bracket, winnerName, firstName, secondName, aggregate: `${firstAgg}-${secondAgg}`, decision, legs: finals };
}
function groupMatches(matches) { return matches.reduce((groups, match) => { const key = match.stage === 'group' ? `Group ${match.groups?.code || 'Ungrouped'}` : `${match.bracket || 'Knockout'} · ${match.round || 'Round'}`; if (!groups[key]) groups[key] = []; groups[key].push(match); return groups; }, {}); }
function bracketsFrom(matches) { return [...new Set(matches.filter((match) => match.stage === 'knockout').map((match) => match.bracket || 'Cup'))].sort((a, b) => String(a).localeCompare(String(b))); }
function roundsFrom(matches) { return [...new Set(matches.filter((match) => match.stage === 'knockout').map((match) => match.round || 'Round'))].sort((a, b) => roundIndex(a) - roundIndex(b) || String(a).localeCompare(String(b))); }
function groupCodesFrom(matches) { return [...new Set(matches.filter((match) => match.stage === 'group').map((match) => match.groups?.code || 'Ungrouped'))].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true })); }
function matchSideClass(match, side) {
  if (!isCompleted(match) || match.home_score === null || match.away_score === null) return 'result-side';
  const homeWon = Number(match.home_score) > Number(match.away_score);
  const awayWon = Number(match.away_score) > Number(match.home_score);
  if (side === 'home' && homeWon) return 'result-side winner';
  if (side === 'away' && awayWon) return 'result-side winner';
  if ((side === 'home' && awayWon) || (side === 'away' && homeWon)) return 'result-side loser';
  return 'result-side draw';
}
function blankTableRow(entry) { return { entry_id: entry.id, team_name: entry.teams?.name || 'Unknown team', manager_name: entry.managers?.display_name || entry.managers?.name || 'TBC', seed: entry.seed, rating: entry.rating, pot: entry.pot, group_code: entry.group_code, played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0, goal_difference: 0, points: 0, group_position: null }; }
function buildTables(entries, matches) {
  const byGroup = entries.reduce((groups, entry) => { const code = entry.group_code || 'Ungrouped'; if (!groups[code]) groups[code] = []; groups[code].push(entry); return groups; }, {});
  return Object.entries(byGroup).sort(([a], [b]) => a.localeCompare(b)).map(([groupCode, groupEntries]) => {
    const rowsById = new Map(groupEntries.map((entry) => [entry.id, blankTableRow(entry)]));
    matches.filter((match) => match.stage === 'group' && (match.groups?.code || groupCode) === groupCode).filter(isCompleted).forEach((match) => {
      const home = rowsById.get(match.home_entry_id), away = rowsById.get(match.away_entry_id);
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
function allTableRows(tables) { return tables.flatMap((table) => table.rows.map((row) => ({ ...row, group_code: table.groupCode }))); }
function rowsByFinish(tables, position) { return allTableRows(tables).filter((row) => row.group_position === position).sort(tableSort); }
function seedRows(entries) { return [...entries].sort((a, b) => Number(a.seed || 9999) - Number(b.seed || 9999) || Number(b.rating || 0) - Number(a.rating || 0) || String(a.teams?.name || '').localeCompare(String(b.teams?.name || ''))); }
function ordinal(position) { return position === 1 ? '1st' : position === 2 ? '2nd' : position === 3 ? '3rd' : `${position}th`; }
function roundDateSummary(rows) {
  return [...rows].sort((a, b) => String(a.bracket || '').localeCompare(String(b.bracket || '')) || roundIndex(a.round) - roundIndex(b.round)).filter((row) => row.leg1_date || row.leg2_date);
}

export default function PublicTournamentPage({ tournamentId }) {
  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState([]);
  const [entries, setEntries] = useState([]);
  const [roundDates, setRoundDates] = useState([]);
  const [status, setStatus] = useState('Loading tournament...');
  const [selectedGroup, setSelectedGroup] = useState('all');
  const [selectedBracket, setSelectedBracket] = useState('all');
  const [selectedRound, setSelectedRound] = useState('all');

  useEffect(() => { if (hasSupabaseConfig && supabase && tournamentId) loadTournament(); }, [tournamentId]);

  const datedMatches = useMemo(() => applyRoundDates(matches, roundDates), [matches, roundDates]);
  const winners = useMemo(() => bracketsFrom(datedMatches).map((bracket) => finalSummary(datedMatches, bracket)).filter(Boolean), [datedMatches]);
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
  const finishTables = useMemo(() => [1, 2, 3, 4].map((position) => ({ position, rows: rowsByFinish(tables, position) })), [tables]);
  const scheduleRows = useMemo(() => roundDateSummary(roundDates), [roundDates]);
  const fixtureCount = datedMatches.filter((match) => !isCompleted(match)).length;
  const resultCount = datedMatches.filter(isCompleted).length;

  async function loadTournament() {
    setStatus('Loading tournament page...');
    const tournamentResult = await supabase.from('tournaments').select('id, name, status, rules_notes, secondary_bracket_name, max_entries, actual_entries, group_count, teams_per_group, knockout_teams').eq('id', tournamentId).maybeSingle();
    if (tournamentResult.error || !tournamentResult.data) { setStatus('Tournament not found.'); return; }
    const [matchesResult, entriesResult, roundDatesResult] = await Promise.all([
      supabase.from('matches').select('id, stage, round, leg, match_order, fixture_date, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, decided_by, home_extra_time_score, away_extra_time_score, home_penalty_score, away_penalty_score, status, bracket, home_placeholder, away_placeholder, groups(id, code, name), home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(id, name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(id, name))').eq('tournament_id', tournamentId),
      supabase.from('tournament_entries').select('id, seed, rating, pot, group_code, teams(id, name), managers(id, name, display_name)').eq('tournament_id', tournamentId).order('seed', { ascending: true }),
      supabase.from('tournament_round_dates').select('id, bracket, round, leg1_date, leg2_date').eq('tournament_id', tournamentId),
    ]);
    if (matchesResult.error) { setStatus('Could not load results: ' + matchesResult.error.message); return; }
    if (entriesResult.error) { setStatus('Could not load seedings: ' + entriesResult.error.message); return; }
    setTournament(tournamentResult.data);
    setMatches(matchesResult.data || []);
    setEntries(entriesResult.data || []);
    setRoundDates(roundDatesResult.error ? [] : (roundDatesResult.data || []));
    setSelectedGroup('all'); setSelectedBracket('all'); setSelectedRound('all');
    setStatus('Tournament page loaded.');
  }

  if (!hasSupabaseConfig || !supabase) return <main className="app-shell"><section className="warning-card"><strong>Supabase is not connected.</strong></section></main>;
  if (!tournament) return <main className="app-shell"><section className="card"><h1>Tournament page</h1><p className="status">{status}</p></section></main>;

  return <main className="app-shell public-archive">
    <section className="hero"><p className="eyebrow">Top 100 Tournament</p><h1>{tournament.name}</h1><p>Status: {tournament.status || 'draft'} · {resultCount} results · {fixtureCount} fixtures remaining</p></section>
    <section className="card format-summary-card"><div className="public-section-toolbar"><div><p className="eyebrow">Tournament format</p><h2>Youth Cup format and rules</h2></div><a className="public-link-button" href={RULES_URL} target="_blank" rel="noreferrer">Read full rules</a></div><div className="format-summary-grid"><article><span>Entrants</span><strong>{tournament.actual_entries || entries.length || tournament.max_entries || '—'}</strong><small>{tournament.max_entries ? `Maximum ${tournament.max_entries}` : 'Registered teams'}</small></article><article><span>Groups</span><strong>{tournament.group_count || '—'}</strong><small>{tournament.teams_per_group ? `${tournament.teams_per_group} teams per group` : 'Group stage'}</small></article><article><span>Knockout</span><strong>{tournament.knockout_teams || '32'}</strong><small>Seeded by group finishing record</small></article><article><span>Secondary bracket</span><strong>{tournament.secondary_bracket_name || 'Shield'}</strong><small>For qualifying non-Cup teams</small></article></div><p className="muted">Teams are seeded by average rating into pots for the group draw. Group tables are ranked by points, goal difference and goals scored, then seeds are used for transparency when comparing teams across groups. Knockout ties show aggregate, away goals and fictional extra time decisions where needed.</p>{scheduleRows.length > 0 && <div className="schedule-summary"><h3>Knockout schedule</h3><div className="schedule-pill-row">{scheduleRows.map((row) => <span className="schedule-pill" key={`${row.bracket}-${row.round}`}>{row.bracket} {row.round}: {formatDate(row.leg1_date)}{row.leg2_date ? ` / ${formatDate(row.leg2_date)}` : ''}</span>)}</div></div>}</section>
    <section className="card winners-card"><p className="eyebrow">Winners</p><div className="overview-metrics compact-metrics">{winners.length ? winners.map((winner) => <article className="winner-summary-card" key={winner.bracket}><span>🏆 {winner.bracket} winner</span><strong>{winner.winnerName}</strong><small>{winner.firstName} {winner.aggregate} {winner.secondName}{winner.decision ? ` · ${winner.decision}` : ''}</small><div className="mini-results">{winner.legs.map((leg) => <p key={leg.id}>{Number(leg.leg) === 1 ? '1st leg' : '2nd leg'}: {teamName(leg.home_entry, leg.home_placeholder)} {leg.home_score}-{leg.away_score} {teamName(leg.away_entry, leg.away_placeholder)}</p>)}</div></article>) : <p className="muted">No completed finals yet.</p>}</div></section>
    {orderedSeeds.length > 0 && <section className="card"><p className="eyebrow">Draw transparency</p><h2>Rating seedings and pots</h2><div className="standings-wrap"><table className="standings-table seed-table"><thead><tr><th>Seed</th><th>Team</th><th>Manager</th><th>Rating</th><th>Pot</th><th>Group</th></tr></thead><tbody>{orderedSeeds.map((entry) => <tr key={entry.id}><td><strong>{entry.seed || '—'}</strong></td><td><strong>{entry.teams?.name || 'Unknown team'}</strong></td><td>{entry.managers?.display_name || entry.managers?.name || 'TBC'}</td><td>{entry.rating ?? '—'}</td><td>{entry.pot ?? '—'}</td><td>{entry.group_code || '—'}</td></tr>)}</tbody></table></div></section>}
    {tables.length > 0 && <section className="card"><p className="eyebrow">Qualification transparency</p><h2>Cross-group finishing rankings</h2><p className="muted">These tables compare every 1st, 2nd, 3rd and 4th placed team using points, goal difference, goals scored, then seed. They explain knockout qualification and seeding.</p><div className="finish-grid">{finishTables.map((table) => <section className="finish-card" key={table.position}><h3>{ordinal(table.position)} placed teams</h3><div className="standings-wrap"><table className="standings-table mini-standings"><thead><tr><th>Rank</th><th>Team</th><th>Grp</th><th>Pts</th><th>GD</th><th>GF</th><th>Seed</th></tr></thead><tbody>{table.rows.map((row, index) => <tr key={row.entry_id}><td>{index + 1}</td><td><strong>{row.team_name}</strong></td><td>{row.group_code}</td><td><strong>{row.points}</strong></td><td>{row.goal_difference > 0 ? '+' + row.goal_difference : row.goal_difference}</td><td>{row.goals_for}</td><td>{row.seed || '—'}</td></tr>)}</tbody></table></div></section>)}</div></section>}
    {knockoutBrackets.length > 0 && <section className="card"><p className="eyebrow">Bracket</p><div className="public-bracket-stack">{knockoutBrackets.map((bracket) => <KnockoutBracket key={bracket} title={`${bracket} bracket`} matches={datedMatches.filter((match) => (match.bracket || 'Cup') === bracket)} />)}</div></section>}
    <section className="card"><div className="public-section-toolbar"><div><p className="eyebrow">Knockout fixtures and results</p><h2>{selectedBracket === 'all' ? 'All competitions' : selectedBracket}{selectedRound !== 'all' ? ` · ${selectedRound}` : ''}</h2></div><div className="public-filter-pair">{knockoutBracketOptions.length > 1 && <label className="public-group-filter">Competition<select value={selectedBracket} onChange={(event) => { setSelectedBracket(event.target.value); setSelectedRound('all'); }}><option value="all">All competitions</option>{knockoutBracketOptions.map((bracket) => <option key={bracket} value={bracket}>{bracket}</option>)}</select></label>}{knockoutRoundOptions.length > 1 && <label className="public-group-filter">Round<select value={selectedRound} onChange={(event) => setSelectedRound(event.target.value)}><option value="all">All rounds</option>{knockoutRoundOptions.map((round) => <option key={round} value={round}>{round}</option>)}</select></label>}</div></div><ResultSections sections={knockoutResults} /></section>
    <section className="card"><div className="public-section-toolbar"><div><p className="eyebrow">Group fixtures and results</p><h2>{selectedGroup === 'all' ? 'All groups' : `Group ${selectedGroup}`}</h2></div>{groupOptions.length > 1 && <label className="public-group-filter">Group<select value={selectedGroup} onChange={(event) => setSelectedGroup(event.target.value)}><option value="all">All groups</option>{groupOptions.map((code) => <option key={code} value={code}>Group {code}</option>)}</select></label>}</div><ResultSections sections={groupResults} /></section>
  </main>;
}

function ResultSections({ sections }) {
  const entries = Object.entries(sections);
  if (!entries.length) return <p className="muted">No fixtures or results yet.</p>;
  return <div className="fixture-sections">{entries.map(([title, matches]) => { const dateLabel = sectionDateLabel(matches); return <section className="fixture-section" key={title}><div className="fixture-section-header"><h3>{title}{dateLabel ? ` · ${dateLabel}` : ''}</h3><span>{matches.length} fixtures</span></div><div className="fixture-card-list">{matches.map((match) => <article className={isCompleted(match) ? 'fixture-card played result-highlight-card' : 'fixture-card'} key={match.id}>{match.fixture_date && <p className="fixture-date public-fixture-date">{formatDate(match.fixture_date)}</p>}<div className="fixture-teams result-teams"><strong className={matchSideClass(match, 'home')}>{teamName(match.home_entry, match.home_placeholder)}</strong><span className="fixture-score">{isCompleted(match) ? `${match.home_score} - ${match.away_score}` : 'v'}</span><strong className={matchSideClass(match, 'away')}>{teamName(match.away_entry, match.away_placeholder)}</strong></div><div className="fixture-actions"><span>{match.round}{match.leg ? ` · ${Number(match.leg) === 1 ? '1st leg' : '2nd leg'}` : ''}</span></div></article>)}</div></section>; })}</div>;
}
