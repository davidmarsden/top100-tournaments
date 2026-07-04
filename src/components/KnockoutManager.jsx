import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

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

  return Object.entries(byGroup)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([groupCode, groupEntries]) => {
      const rowsById = new Map(groupEntries.map((entry) => [entry.id, blankRow(entry)]));

      matches
        .filter((match) => (match.groups?.code || groupCode) === groupCode)
        .filter((match) => match.status === 'played')
        .forEach((match) => {
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

      const rows = [...rowsById.values()]
        .map((row) => ({ ...row, goal_difference: row.goals_for - row.goals_against }))
        .sort(compareRows)
        .map((row, index) => ({ ...row, group_position: index + 1 }));

      return { groupCode, rows };
    });
}

function seedQualifiers(tables, position) {
  return tables
    .flatMap((table) => table.rows.filter((row) => row.group_position === position))
    .sort(compareRows)
    .map((row, index) => ({ ...row, knockout_seed: index + 1 }));
}

function pairSeeds(teams, bracket, roundName) {
  const size = teams.length;
  const matches = [];

  for (let index = 0; index < Math.floor(size / 2); index += 1) {
    const home = teams[index];
    const away = teams[size - 1 - index];
    matches.push({
      bracket,
      stage: 'knockout',
      round: roundName,
      match_order: index + 1,
      home_entry_id: home.entry_id,
      away_entry_id: away.entry_id,
      home_placeholder: home.team_name,
      away_placeholder: away.team_name,
      home_seed: home.knockout_seed,
      away_seed: away.knockout_seed,
      status: 'scheduled',
    });
  }

  return matches;
}

export default function KnockoutManager({ selectedTournament }) {
  const [entries, setEntries] = useState([]);
  const [matches, setMatches] = useState([]);
  const [knockoutMatches, setKnockoutMatches] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);

  const tournamentId = selectedTournament?.id;

  useEffect(() => {
    if (hasSupabaseConfig && supabase && tournamentId) loadData();
  }, [tournamentId]);

  const groupMatches = matches.filter((match) => match.stage === 'group');
  const playedGroupMatches = groupMatches.filter((match) => match.status === 'played');
  const groupComplete = groupMatches.length > 0 && playedGroupMatches.length === groupMatches.length;
  const tables = useMemo(() => buildTables(entries, groupMatches), [entries, groupMatches]);
  const cupQualifiers = useMemo(() => seedQualifiers(tables, 1).concat(seedQualifiers(tables, 2)).sort((a, b) => a.knockout_seed - b.knockout_seed), [tables]);
  const shieldQualifiers = useMemo(() => seedQualifiers(tables, 3).concat(seedQualifiers(tables, 4)).sort((a, b) => a.knockout_seed - b.knockout_seed), [tables]);
  const proposedCup = useMemo(() => pairSeeds(cupQualifiers, 'Cup', 'R32'), [cupQualifiers]);
  const proposedShield = useMemo(() => pairSeeds(shieldQualifiers, 'Shield', 'R32'), [shieldQualifiers]);

  async function loadData() {
    if (!tournamentId) return;
    setLoading(true);
    setStatus('Loading knockout data...');

    const [entriesResult, matchesResult, knockoutResult] = await Promise.all([
      supabase
        .from('tournament_entries')
        .select('id, tournament_id, team_id, manager_id, seed, rating, group_code, pot, teams(id, name), managers(id, name, display_name)')
        .eq('tournament_id', tournamentId)
        .order('seed', { ascending: true }),
      supabase
        .from('matches')
        .select('id, tournament_id, group_id, stage, round, leg, match_order, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, status, bracket, groups(id, code, name)')
        .eq('tournament_id', tournamentId)
        .order('match_order', { ascending: true }),
      supabase
        .from('matches')
        .select('id, tournament_id, stage, round, match_order, home_entry_id, away_entry_id, home_placeholder, away_placeholder, home_score, away_score, status, bracket')
        .eq('tournament_id', tournamentId)
        .eq('stage', 'knockout')
        .order('bracket', { ascending: true })
        .order('match_order', { ascending: true }),
    ]);

    if (entriesResult.error) setStatus('Could not load entrants: ' + entriesResult.error.message);
    else if (matchesResult.error) setStatus('Could not load matches: ' + matchesResult.error.message);
    else if (knockoutResult.error) setStatus('Could not load knockout matches: ' + knockoutResult.error.message);
    else {
      setEntries(entriesResult.data || []);
      setMatches(matchesResult.data || []);
      setKnockoutMatches(knockoutResult.data || []);
      setStatus('Knockout data loaded.');
    }

    setLoading(false);
  }

  async function saveKnockoutDraw() {
    if (!groupComplete) {
      setStatus('Group stage is not complete yet. You can preview, but not save the knockout draw.');
      return;
    }

    setLoading(true);
    setStatus('Saving Cup and Shield draws...');

    try {
      await supabase.from('matches').delete().eq('tournament_id', tournamentId).eq('stage', 'knockout');

      const rows = [...proposedCup, ...proposedShield].map((match, index) => ({
        tournament_id: tournamentId,
        stage: match.stage,
        round: match.round,
        match_order: index + 1,
        home_entry_id: match.home_entry_id,
        away_entry_id: match.away_entry_id,
        home_placeholder: match.home_placeholder,
        away_placeholder: match.away_placeholder,
        bracket: match.bracket,
        status: 'scheduled',
      }));

      const { error } = await supabase.from('matches').insert(rows);
      if (error) throw error;

      await supabase.from('tournaments').update({ status: 'knockout_generated' }).eq('id', tournamentId);
      setStatus('Cup and Shield draws saved.');
      await loadData();
    } catch (error) {
      setStatus('Save failed: ' + error.message);
    }

    setLoading(false);
  }

  if (!selectedTournament) return <p className="muted">Create or select a tournament first.</p>;
  if (!hasSupabaseConfig || !supabase) return <p className="muted">Supabase is not connected yet.</p>;

  return (
    <div className="knockout-manager">
      <div className="fixtures-toolbar">
        <div>
          <p className="eyebrow">Knockout generator</p>
          <h3>{playedGroupMatches.length} / {groupMatches.length} group fixtures played</h3>
          <p className="muted">Top two currently feed the Cup. Third and fourth currently feed the Shield.</p>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={loadData} disabled={loading}>Reload</button>
          <button type="button" onClick={saveKnockoutDraw} disabled={loading || !groupComplete}>Generate Cup & Shield</button>
        </div>
      </div>

      <p className="status">{status}</p>

      <div className={groupComplete ? 'ready-banner ready' : 'ready-banner'}>
        <strong>{groupComplete ? 'Group stage complete.' : 'Group stage not complete yet.'}</strong>
        <span>{groupComplete ? 'The knockout draw can now be saved.' : 'Preview is available, but saving is locked until every group fixture is played.'}</span>
      </div>

      {knockoutMatches.length > 0 && (
        <section className="bracket-section">
          <h3>Saved knockout matches</h3>
          <KnockoutList matches={knockoutMatches} />
        </section>
      )}

      <section className="bracket-grid">
        <article className="bracket-section">
          <h3>Cup preview</h3>
          <p className="muted">{cupQualifiers.length} qualifiers</p>
          <KnockoutList matches={proposedCup} />
        </article>

        <article className="bracket-section">
          <h3>Shield preview</h3>
          <p className="muted">{shieldQualifiers.length} qualifiers</p>
          <KnockoutList matches={proposedShield} />
        </article>
      </section>
    </div>
  );
}

function KnockoutList({ matches }) {
  if (!matches.length) return <p className="muted">No matches yet.</p>;

  return (
    <div className="knockout-list">
      {matches.map((match) => (
        <article className="knockout-card" key={(match.bracket || 'draw') + '-' + match.match_order + '-' + match.home_entry_id}>
          <span>{match.bracket || 'Knockout'} · {match.round || 'Round'}</span>
          <strong>{match.home_placeholder}</strong>
          <em>v</em>
          <strong>{match.away_placeholder}</strong>
        </article>
      ))}
    </div>
  );
}
