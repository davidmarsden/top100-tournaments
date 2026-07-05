import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function blankRow(entry) {
  return {
    entry_id: entry.id,
    seed: entry.seed,
    team_name: entry.teams?.name || 'Unknown team',
    manager_name: entry.managers?.display_name || entry.managers?.name || 'TBC',
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points: 0,
    form: [],
  };
}

function isCompleted(match) {
  return match.status === 'played' || match.status === 'forfeit';
}

function sortRows(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
  if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
  if (a.seed && b.seed && a.seed !== b.seed) return a.seed - b.seed;
  return a.team_name.localeCompare(b.team_name);
}

function formSymbol(result) {
  if (result === 'W') return '✓';
  if (result === 'D') return '–';
  return '×';
}

function qualificationForIndex(index) {
  if (index < 2) return { rowClass: 'cup-zone', badgeClass: 'cup', label: 'CUP' };
  if (index === 2) return { rowClass: 'shield-zone', badgeClass: 'shield', label: 'SHIELD' };
  return { rowClass: 'out-zone', badgeClass: 'out', label: 'OUT' };
}

export default function TablesManager({ selectedTournament }) {
  const [entries, setEntries] = useState([]);
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);

  const tournamentId = selectedTournament?.id;

  useEffect(() => {
    if (hasSupabaseConfig && supabase && tournamentId) loadData();
  }, [tournamentId]);

  const tables = useMemo(() => buildTables(entries, matches), [entries, matches]);
  const playedCount = matches.filter(isCompleted).length;

  async function loadData() {
    if (!tournamentId) return;
    setLoading(true);
    setStatus('Loading tables...');

    const [entriesResult, matchesResult] = await Promise.all([
      supabase
        .from('tournament_entries')
        .select('id, tournament_id, team_id, manager_id, seed, rating, group_code, pot, teams(id, name), managers(id, name, display_name)')
        .eq('tournament_id', tournamentId)
        .order('seed', { ascending: true }),
      supabase
        .from('matches')
        .select('id, tournament_id, group_id, round, leg, match_order, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, status, groups(id, code, name)')
        .eq('tournament_id', tournamentId)
        .eq('stage', 'group')
        .order('match_order', { ascending: true }),
    ]);

    if (entriesResult.error) setStatus('Could not load entrants: ' + entriesResult.error.message);
    else if (matchesResult.error) setStatus('Could not load matches: ' + matchesResult.error.message);
    else {
      setEntries(entriesResult.data || []);
      setMatches(matchesResult.data || []);
      setStatus('Tables loaded.');
    }

    setLoading(false);
  }

  if (!selectedTournament) return <p className="muted">Create or select a tournament first.</p>;
  if (!hasSupabaseConfig || !supabase) return <p className="muted">Supabase is not connected yet.</p>;

  return (
    <div className="tables-manager">
      <div className="fixtures-toolbar">
        <div>
          <p className="eyebrow">Live standings</p>
          <h3>{playedCount} / {matches.length} group fixtures played</h3>
          <p className="muted">Tables recalculate from saved results and forfeits. Top two enter the Cup. Third place enters the Shield after Cup R32 losers drop in.</p>
        </div>
        <button type="button" className="secondary" onClick={loadData} disabled={loading}>Reload tables</button>
      </div>

      <p className="status">{status}</p>

      {tables.length === 0 ? (
        <div className="empty-state">
          <h3>No group data yet.</h3>
          <p className="muted">Approve the draw and save fixtures first, then enter results on the Fixtures tab.</p>
        </div>
      ) : (
        <div className="standings-grid">
          {tables.map((table) => (
            <section className="standings-card" key={table.groupCode}>
              <div className="standings-header">
                <h3>Group {table.groupCode}</h3>
                <span>{table.rows.reduce((total, row) => total + row.played, 0) / 2} results</span>
              </div>

              <div className="standings-wrap">
                <table className="standings-table">
                  <thead><tr><th>Pos</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th>Form</th></tr></thead>
                  <tbody>
                    {table.rows.map((row, index) => {
                      const qualification = qualificationForIndex(index);
                      return (
                        <tr key={row.entry_id} className={qualification.rowClass}>
                          <td className="pos-cell"><strong>{index + 1}</strong><span className={'standing-qual ' + qualification.badgeClass}>{qualification.label}</span></td>
                          <td><strong>{row.team_name}</strong><span>{row.manager_name}</span></td>
                          <td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.goals_for}</td><td>{row.goals_against}</td><td>{row.goal_difference > 0 ? '+' + row.goal_difference : row.goal_difference}</td><td><strong>{row.points}</strong></td>
                          <td className="form-cell">{row.form.slice(-5).map((item, itemIndex) => <span key={itemIndex} className={'form-badge ' + item}>{formSymbol(item)}</span>)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function buildTables(entries, matches) {
  const entriesByGroup = entries.reduce((groups, entry) => {
    const groupCode = entry.group_code || 'Ungrouped';
    if (!groups[groupCode]) groups[groupCode] = [];
    groups[groupCode].push(entry);
    return groups;
  }, {});

  return Object.entries(entriesByGroup).sort(([a], [b]) => a.localeCompare(b)).map(([groupCode, groupEntries]) => {
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
        home.form.push('W');
        away.losses += 1;
        away.form.push('L');
      } else if (awayScore > homeScore) {
        away.wins += 1;
        away.points += 3;
        away.form.push('W');
        home.losses += 1;
        home.form.push('L');
      } else {
        home.draws += 1;
        away.draws += 1;
        home.points += 1;
        away.points += 1;
        home.form.push('D');
        away.form.push('D');
      }
    });

    const rows = [...rowsById.values()].map((row) => ({ ...row, goal_difference: row.goals_for - row.goals_against })).sort(sortRows);
    return { groupCode, rows };
  });
}
