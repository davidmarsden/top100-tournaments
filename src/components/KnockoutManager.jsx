import { useEffect, useMemo, useState } from 'react';
import FixturesManager from './FixturesManager.jsx';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const ROUND_ORDER = ['R32', 'R16', 'QF', 'SF', 'Final'];
const NEXT_ROUND = { R32: 'R16', R16: 'QF', QF: 'SF', SF: 'Final' };

function isCompleted(match) {
  return match.status === 'played' || match.status === 'forfeit';
}

function blankRow(entry) {
  return {
    entry_id: entry.id,
    seed: entry.seed,
    team_name: entry.teams?.name || 'Unknown team',
    manager_name: entry.managers?.display_name || entry.managers?.name || 'TBC',
    group_code: entry.group_code,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points: 0,
  };
}

function compareRows(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
  if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
  if (a.seed && b.seed && a.seed !== b.seed) return a.seed - b.seed;
  return a.team_name.localeCompare(b.team_name);
}

function buildTables(entries, matches) {
  const byGroup = entries.reduce((groups, entry) => {
    const code = entry.group_code || 'Ungrouped';
    if (!groups[code]) groups[code] = [];
    groups[code].push(entry);
    return groups;
  }, {});

  return Object.entries(byGroup).sort(([a], [b]) => a.localeCompare(b)).map(([groupCode, groupEntries]) => {
    const rowsById = new Map(groupEntries.map((entry) => [entry.id, blankRow(entry)]));

    matches.filter((match) => (match.groups?.code || groupCode) === groupCode).filter(isCompleted).forEach((match) => {
      const home = rowsById.get(match.home_entry_id);
      const away = rowsById.get(match.away_entry_id);
      if (!home || !away) return;
      const homeScore = Number(match.home_score || 0);
      const awayScore = Number(match.away_score || 0);
      home.played += 1;
      away.played += 1;
      home.goals_for += homeScore;
      home.goals_against += awayScore;
      away.goals_for += awayScore;
      away.goals_against += homeScore;
      if (homeScore > awayScore) {
        home.wins += 1;
        home.points += 3;
        away.losses += 1;
      } else if (awayScore > homeScore) {
        away.wins += 1;
        away.points += 3;
        home.losses += 1;
      } else {
        home.draws += 1;
        away.draws += 1;
        home.points += 1;
        away.points += 1;
      }
    });

    const rows = [...rowsById.values()].map((row) => ({ ...row, goal_difference: row.goals_for - row.goals_against })).sort(compareRows).map((row, index) => ({ ...row, group_position: index + 1 }));
    return { groupCode, rows };
  });
}

function seedQualifiers(tables, position) {
  return tables.flatMap((table) => table.rows.filter((row) => row.group_position === position)).sort(compareRows).map((row, index) => ({ ...row, knockout_seed: index + 1 }));
}

function pairSeeds(teams, bracket, roundName) {
  const size = teams.length;
  const matches = [];
  for (let index = 0; index < Math.floor(size / 2); index += 1) {
    const home = teams[index];
    const away = teams[size - 1 - index];
    matches.push({ bracket, stage: 'knockout', round: roundName, leg: 1, match_order: index + 1, home_entry_id: home.entry_id, away_entry_id: away.entry_id, home_placeholder: home.team_name, away_placeholder: away.team_name, status: 'scheduled' });
  }
  return matches;
}

function entryName(entries, entryId, fallback) {
  const entry = entries.find((item) => item.id === entryId);
  return entry?.teams?.name || fallback || 'TBC';
}

function bracketRound(matches, bracket, round) {
  return matches.filter((match) => match.stage === 'knockout' && match.bracket === bracket && match.round === round).sort((a, b) => Number(a.match_order || 0) - Number(b.match_order || 0) || Number(a.leg || 1) - Number(b.leg || 1));
}

function legCount(bracket, round) {
  if (bracket === 'Cup') return round === 'R32' ? 1 : 2;
  if (bracket === 'Shield') return round === 'R32' || round === 'R16' ? 1 : 2;
  return 1;
}

function resolveTie(legs) {
  const orderedLegs = [...legs].sort((a, b) => Number(a.leg || 1) - Number(b.leg || 1));
  if (orderedLegs.some((leg) => !isCompleted(leg))) return { winnerId: null, reason: 'incomplete' };

  const first = orderedLegs[0];
  const firstTeamId = first.home_entry_id;
  const secondTeamId = first.away_entry_id;
  let firstAggregate = 0;
  let secondAggregate = 0;
  let firstAwayGoals = 0;
  let secondAwayGoals = 0;

  orderedLegs.forEach((leg) => {
    const homeScore = Number(leg.home_score || 0);
    const awayScore = Number(leg.away_score || 0);
    if (leg.home_entry_id === firstTeamId) {
      firstAggregate += homeScore;
      secondAggregate += awayScore;
      secondAwayGoals += awayScore;
    } else {
      firstAggregate += awayScore;
      secondAggregate += homeScore;
      firstAwayGoals += awayScore;
    }
  });

  if (firstAggregate > secondAggregate) return { winnerId: firstTeamId, loserId: secondTeamId, reason: 'aggregate' };
  if (secondAggregate > firstAggregate) return { winnerId: secondTeamId, loserId: firstTeamId, reason: 'aggregate' };

  if (orderedLegs.length > 1) {
    if (firstAwayGoals > secondAwayGoals) return { winnerId: firstTeamId, loserId: secondTeamId, reason: 'away_goals' };
    if (secondAwayGoals > firstAwayGoals) return { winnerId: secondTeamId, loserId: firstTeamId, reason: 'away_goals' };
  }

  return { winnerId: null, loserId: null, reason: 'fet_required' };
}

function tieWinners(source) {
  const ties = new Map();
  source.forEach((match) => {
    if (!ties.has(match.match_order)) ties.set(match.match_order, []);
    ties.get(match.match_order).push(match);
  });

  const winners = [];
  const unresolved = [];

  for (const [matchOrder, legs] of [...ties.entries()].sort(([a], [b]) => Number(a) - Number(b))) {
    const result = resolveTie(legs);
    if (!result.winnerId) unresolved.push({ matchOrder, reason: result.reason });
    else winners.push(result.winnerId);
  }

  return { winners, unresolved };
}

function nextRoundLabel(matches, bracket) {
  const existingRounds = ROUND_ORDER.filter((round) => bracketRound(matches, bracket, round).length > 0);
  const latestRound = existingRounds[existingRounds.length - 1];
  const nextRound = NEXT_ROUND[latestRound];
  return nextRound ? `Generate ${bracket} ${nextRound}` : `Next ${bracket} round`;
}

function testKnockoutScore(match) {
  const base = Number(match.match_order || 1) + Number(match.leg || 1) + (match.bracket === 'Shield' ? 2 : 0);
  const home = (base % 4) + 1;
  const away = base % 3;
  return home === away ? { home_score: home + 1, away_score: away } : { home_score: home, away_score: away };
}

function winnerLoserFor(match, homeScore, awayScore) {
  if (homeScore > awayScore) return { winner_entry_id: match.home_entry_id, loser_entry_id: match.away_entry_id };
  if (awayScore > homeScore) return { winner_entry_id: match.away_entry_id, loser_entry_id: match.home_entry_id };
  return { winner_entry_id: null, loser_entry_id: null };
}

export default function KnockoutManager({ selectedTournament }) {
  const [entries, setEntries] = useState([]);
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);

  const tournamentId = selectedTournament?.id;

  useEffect(() => {
    if (hasSupabaseConfig && supabase && tournamentId) loadData();
  }, [tournamentId]);

  const groupMatches = matches.filter((match) => match.stage === 'group');
  const knockoutMatches = matches.filter((match) => match.stage === 'knockout');
  const playedGroupMatches = groupMatches.filter(isCompleted);
  const groupComplete = groupMatches.length > 0 && playedGroupMatches.length === groupMatches.length;
  const tables = useMemo(() => buildTables(entries, groupMatches), [entries, groupMatches]);
  const cupQualifiers = useMemo(() => seedQualifiers(tables, 1).concat(seedQualifiers(tables, 2)).sort((a, b) => a.knockout_seed - b.knockout_seed), [tables]);
  const shieldHomeTeams = useMemo(() => seedQualifiers(tables, 3).sort((a, b) => a.knockout_seed - b.knockout_seed), [tables]);
  const proposedCup = useMemo(() => pairSeeds(cupQualifiers, 'Cup', 'R32'), [cupQualifiers]);

  async function loadData() {
    if (!tournamentId) return;
    setLoading(true);
    setStatus('Loading knockout data...');

    const [entriesResult, matchesResult] = await Promise.all([
      supabase.from('tournament_entries').select('id, tournament_id, team_id, manager_id, seed, rating, group_code, pot, teams(id, name), managers(id, name, display_name)').eq('tournament_id', tournamentId).order('seed', { ascending: true }),
      supabase.from('matches').select('id, tournament_id, group_id, stage, round, leg, match_order, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, status, bracket, home_placeholder, away_placeholder, groups(id, code, name)').eq('tournament_id', tournamentId).order('stage', { ascending: true }).order('bracket', { ascending: true }).order('round', { ascending: true }).order('match_order', { ascending: true }),
    ]);

    if (entriesResult.error) setStatus('Could not load entrants: ' + entriesResult.error.message);
    else if (matchesResult.error) setStatus('Could not load matches: ' + matchesResult.error.message);
    else {
      setEntries(entriesResult.data || []);
      setMatches(matchesResult.data || []);
      setStatus('Knockout data loaded from database.');
    }

    setLoading(false);
  }

  async function insertMatches(rows, successMessage) {
    setLoading(true);
    const { error } = await supabase.from('matches').insert(rows);
    if (error) setStatus('Save failed: ' + error.message);
    else {
      setStatus(successMessage);
      await loadData();
    }
    setLoading(false);
  }

  async function saveCupR32() {
    if (!groupComplete) return setStatus('Group stage is not complete yet.');
    if (bracketRound(knockoutMatches, 'Cup', 'R32').length > 0) return setStatus('Cup R32 already exists. Existing knockout results were not touched.');

    const rows = proposedCup.map((match) => ({ tournament_id: tournamentId, stage: 'knockout', round: 'R32', leg: 1, match_order: match.match_order, home_entry_id: match.home_entry_id, away_entry_id: match.away_entry_id, home_placeholder: match.home_placeholder, away_placeholder: match.away_placeholder, bracket: 'Cup', status: 'scheduled' }));
    await insertMatches(rows, 'Cup R32 saved. Play this round before generating the Shield R32.');
  }

  async function saveShieldR32() {
    const cupR32 = bracketRound(knockoutMatches, 'Cup', 'R32');
    if (!cupR32.length) return setStatus('Generate Cup R32 first.');
    if (cupR32.some((match) => !isCompleted(match) || !match.loser_entry_id)) return setStatus('Finish Cup R32 before generating Shield R32. One-leg draws require Fictional Extra Time/manual resolution first.');
    if (bracketRound(knockoutMatches, 'Shield', 'R32').length > 0) return setStatus('Shield R32 already exists.');

    const cupLosers = cupR32.map((match, index) => ({ entry_id: match.loser_entry_id, team_name: entryName(entries, match.loser_entry_id, 'Cup loser ' + (index + 1)) }));
    const rows = shieldHomeTeams.map((home, index) => {
      const away = cupLosers[cupLosers.length - 1 - index];
      return { tournament_id: tournamentId, stage: 'knockout', round: 'R32', leg: 1, match_order: index + 1, home_entry_id: home.entry_id, away_entry_id: away.entry_id, home_placeholder: home.team_name, away_placeholder: away.team_name, bracket: 'Shield', status: 'scheduled' };
    });
    await insertMatches(rows, 'Shield R32 saved with Cup R32 losers away.');
  }

  async function autoFillKnockout() {
    const targets = knockoutMatches.filter((match) => !isCompleted(match));
    if (!targets.length) return setStatus('No outstanding knockout fixtures to auto-fill.');
    setLoading(true);
    setStatus('Auto-filling outstanding knockout fixtures...');

    for (const match of targets) {
      const score = testKnockoutScore(match);
      const result = winnerLoserFor(match, score.home_score, score.away_score);
      const { error } = await supabase.from('matches').update({ ...score, ...result, status: 'played', played_at: new Date().toISOString() }).eq('id', match.id);
      if (error) {
        setStatus('Auto-fill failed: ' + error.message);
        setLoading(false);
        return;
      }
    }

    await loadData();
    setStatus(targets.length + ' knockout test result(s) saved and view refreshed.');
    setLoading(false);
  }

  async function generateNextRound(bracket) {
    const existingRounds = ROUND_ORDER.filter((round) => bracketRound(knockoutMatches, bracket, round).length > 0);
    const latestRound = existingRounds[existingRounds.length - 1];
    const nextRound = NEXT_ROUND[latestRound];
    if (!latestRound || !nextRound) return setStatus('No next round is available for ' + bracket + '.');
    if (bracketRound(knockoutMatches, bracket, nextRound).length > 0) return setStatus(nextRound + ' already exists for ' + bracket + '.');

    const { winners, unresolved } = tieWinners(bracketRound(knockoutMatches, bracket, latestRound));
    if (unresolved.length) {
      const fetCount = unresolved.filter((tie) => tie.reason === 'fet_required').length;
      const incompleteCount = unresolved.filter((tie) => tie.reason === 'incomplete').length;
      const details = [incompleteCount ? incompleteCount + ' incomplete tie(s)' : null, fetCount ? fetCount + ' tie(s) need Fictional Extra Time/manual resolution after away goals' : null].filter(Boolean).join('; ');
      return setStatus('Cannot generate ' + bracket + ' ' + nextRound + ': ' + details + '.');
    }

    const rows = [];
    const legs = legCount(bracket, nextRound);
    for (let index = 0; index < winners.length; index += 2) {
      const homeId = winners[index];
      const awayId = winners[index + 1];
      if (!awayId) continue;
      const tieOrder = index / 2 + 1;
      rows.push({ tournament_id: tournamentId, stage: 'knockout', round: nextRound, leg: 1, match_order: tieOrder, home_entry_id: homeId, away_entry_id: awayId, home_placeholder: entryName(entries, homeId, 'Winner ' + (index + 1)), away_placeholder: entryName(entries, awayId, 'Winner ' + (index + 2)), bracket, status: 'scheduled' });
      if (legs === 2) rows.push({ tournament_id: tournamentId, stage: 'knockout', round: nextRound, leg: 2, match_order: tieOrder, home_entry_id: awayId, away_entry_id: homeId, home_placeholder: entryName(entries, awayId, 'Winner ' + (index + 2)), away_placeholder: entryName(entries, homeId, 'Winner ' + (index + 1)), bracket, status: 'scheduled' });
    }
    await insertMatches(rows, bracket + ' ' + nextRound + ' generated' + (legs === 2 ? ' over two legs.' : '.') + ' Away goals were applied where needed.');
  }

  if (!selectedTournament) return <p className="muted">Create or select a tournament first.</p>;
  if (!hasSupabaseConfig || !supabase) return <p className="muted">Supabase is not connected yet.</p>;

  return (
    <div className="knockout-manager">
      <div className="fixtures-toolbar">
        <div>
          <p className="eyebrow">Knockout generator</p>
          <h3>{playedGroupMatches.length} / {groupMatches.length} group fixtures played</h3>
          <p className="muted">Youth Cup rules: Cup R32 first; Cup R32 losers drop into Shield R32 away to third-placed group teams. Cup R16 onwards is two-legged. Shield R16 is one leg; Shield QF onwards is two-legged. Two-legged ties use aggregate score, then away goals, then Fictional Extra Time if still level.</p>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={loadData} disabled={loading}>Reload knockout data</button>
          <button type="button" onClick={saveCupR32} disabled={loading || !groupComplete}>Generate Cup R32</button>
          <button type="button" className="secondary" onClick={autoFillKnockout} disabled={loading || knockoutMatches.every(isCompleted)}>Auto-fill knockout test scores</button>
          <button type="button" className="secondary" onClick={saveShieldR32} disabled={loading}>Generate Shield R32</button>
          <button type="button" className="secondary" onClick={() => generateNextRound('Cup')} disabled={loading}>{nextRoundLabel(knockoutMatches, 'Cup')}</button>
          <button type="button" className="secondary" onClick={() => generateNextRound('Shield')} disabled={loading}>{nextRoundLabel(knockoutMatches, 'Shield')}</button>
        </div>
      </div>

      <p className="status">{status}</p>

      <div className={groupComplete ? 'ready-banner ready' : 'ready-banner'}>
        <strong>{groupComplete ? 'Group stage complete.' : 'Group stage not complete yet.'}</strong>
        <span>{groupComplete ? 'Cup R32 can be generated if it does not already exist.' : 'Finish all group fixtures before saving the knockout draw.'}</span>
      </div>

      <section className="bracket-grid">
        <BracketColumn title="Saved Cup" matches={knockoutMatches.filter((match) => match.bracket === 'Cup')} />
        <BracketColumn title="Saved Shield" matches={knockoutMatches.filter((match) => match.bracket === 'Shield')} />
      </section>

      {knockoutMatches.length === 0 && (
        <section className="bracket-grid">
          <article className="bracket-section"><h3>Cup R32 preview</h3><p className="muted">{cupQualifiers.length} qualifiers</p><KnockoutList matches={proposedCup} /></article>
          <article className="bracket-section"><h3>Shield homes preview</h3><p className="muted">{shieldHomeTeams.length} third-placed teams. Away teams are Cup R32 losers after Cup R32 is played.</p></article>
        </section>
      )}

      <section className="bracket-section">
        <h3>Knockout result entry</h3>
        <FixturesManager selectedTournament={selectedTournament} stage="knockout" />
      </section>
    </div>
  );
}

function BracketColumn({ title, matches }) {
  const rounds = ROUND_ORDER.filter((round) => matches.some((match) => match.round === round));
  return <article className="bracket-section"><h3>{title}</h3>{rounds.length === 0 ? <p className="muted">No saved matches yet.</p> : rounds.map((round) => <div key={round} className="round-block"><h4>{round}</h4><KnockoutList matches={matches.filter((match) => match.round === round).sort((a, b) => Number(a.match_order || 0) - Number(b.match_order || 0) || Number(a.leg || 1) - Number(b.leg || 1))} /></div>)}</article>;
}

function KnockoutList({ matches }) {
  if (!matches.length) return <p className="muted">No matches yet.</p>;
  return <div className="knockout-list">{matches.map((match) => <article className={isCompleted(match) ? 'knockout-card played' : 'knockout-card'} key={(match.bracket || 'draw') + '-' + match.round + '-' + match.match_order + '-' + (match.leg || 1) + '-' + match.home_entry_id}><span>{match.bracket || 'Knockout'} · {match.round || 'Round'}{match.leg ? ' · Leg ' + match.leg : ''}</span><strong>{match.home_placeholder}</strong><em>{isCompleted(match) ? `${match.home_score} - ${match.away_score}` : 'v'}</em><strong>{match.away_placeholder}</strong></article>)}</div>;
}
