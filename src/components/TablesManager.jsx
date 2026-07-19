import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function blankRow(entry, managerForfeits = 0) {
  return {
    entry_id: entry.id,
    manager_id: entry.manager_id,
    seed: entry.seed,
    rating: entry.rating,
    pot: entry.pot,
    group_code: entry.group_code,
    team_name: entry.teams?.name || 'Unknown team',
    manager_name: entry.managers?.display_name || entry.managers?.name || 'TBC',
    manager_forfeits: managerForfeits,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points: 0,
    group_position: null,
    form: [],
  };
}

function isCompleted(match) { return match.status === 'played' || match.status === 'forfeit'; }
function sortRows(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
  if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
  if (a.seed && b.seed && a.seed !== b.seed) return a.seed - b.seed;
  return a.team_name.localeCompare(b.team_name);
}
function formSymbol(result) { if (result === 'W') return '✓'; if (result === 'D') return '–'; return '×'; }
function qualificationForIndex(index) {
  if (index < 2) return { rowClass: 'cup-zone', badgeClass: 'cup', label: 'CUP' };
  if (index === 2) return { rowClass: 'shield-zone', badgeClass: 'shield', label: 'SHIELD' };
  return { rowClass: 'out-zone', badgeClass: 'out', label: 'OUT' };
}
function allRows(tables) { return tables.flatMap((table) => table.rows.map((row) => ({ ...row, group_code: table.groupCode }))); }
function rowsByFinish(tables, position) { return allRows(tables).filter((row) => row.group_position === position).sort(sortRows); }
function seedRows(entries) {
  return [...entries].sort((a, b) => Number(a.seed || 9999) - Number(b.seed || 9999) || Number(b.rating || 0) - Number(a.rating || 0) || String(a.teams?.name || '').localeCompare(String(b.teams?.name || '')));
}

export default function TablesManager({ selectedTournament }) {
  const [entries, setEntries] = useState([]);
  const [matches, setMatches] = useState([]);
  const [forfeits, setForfeits] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const tournamentId = selectedTournament?.id;

  useEffect(() => { if (hasSupabaseConfig && supabase && tournamentId) loadData(); }, [tournamentId]);

  const groupMatchIds = useMemo(() => new Set(matches.map((match) => match.id)), [matches]);
  const managerForfeitCounts = useMemo(() => forfeits.reduce((counts, forfeit) => {
    if (!groupMatchIds.has(forfeit.match_id) || !forfeit.manager_id) return counts;
    counts.set(forfeit.manager_id, (counts.get(forfeit.manager_id) || 0) + 1);
    return counts;
  }, new Map()), [forfeits, groupMatchIds]);
  const tables = useMemo(() => buildTables(entries, matches, managerForfeitCounts), [entries, matches, managerForfeitCounts]);
  const playedCount = matches.filter(isCompleted).length;
  const orderedSeeds = useMemo(() => seedRows(entries), [entries]);
  const finishTables = useMemo(() => [1, 2, 3, 4].map((position) => ({ position, rows: rowsByFinish(tables, position) })), [tables]);

  async function loadData() {
    if (!tournamentId) return;
    setLoading(true);
    setStatus('Loading tables...');
    const [entriesResult, matchesResult] = await Promise.all([
      supabase.from('tournament_entries').select('id, tournament_id, team_id, manager_id, seed, rating, group_code, pot, teams(id, name), managers(id, name, display_name)').eq('tournament_id', tournamentId).order('seed', { ascending: true }),
      supabase.from('matches').select('id, tournament_id, group_id, round, leg, match_order, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, status, groups(id, code, name)').eq('tournament_id', tournamentId).eq('stage', 'group').order('match_order', { ascending: true }),
    ]);
    if (entriesResult.error) setStatus('Could not load entrants: ' + entriesResult.error.message);
    else if (matchesResult.error) setStatus('Could not load matches: ' + matchesResult.error.message);
    else {
      const matchRows = matchesResult.data || [];
      let forfeitRows = [];
      if (matchRows.length) {
        const forfeitsResult = await supabase.from('forfeits').select('id, match_id, manager_id').in('match_id', matchRows.map((match) => match.id));
        if (forfeitsResult.error) setStatus('Could not load forfeits: ' + forfeitsResult.error.message);
        else forfeitRows = forfeitsResult.data || [];
      }
      setEntries(entriesResult.data || []);
      setMatches(matchRows);
      setForfeits(forfeitRows);
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
          <p className="muted">Tables recalculate from saved results and forfeits. “Mgr F” is the current manager’s group-stage forfeit total, regardless of which club they managed when the forfeit occurred.</p>
        </div>
        <button type="button" className="secondary" onClick={loadData} disabled={loading}>Reload tables</button>
      </div>
      <p className="status">{status}</p>

      <section className="transparency-card">
        <div className="standings-header"><h3>Rating seedings and pots</h3><span>{orderedSeeds.length} entrants</span></div>
        <div className="standings-wrap"><table className="standings-table seed-table"><thead><tr><th>Seed</th><th>Team</th><th>Manager</th><th>Rating</th><th>Pot</th><th>Group</th></tr></thead><tbody>{orderedSeeds.map((entry) => <tr key={entry.id}><td><strong>{entry.seed || '—'}</strong></td><td><strong>{entry.teams?.name || 'Unknown team'}</strong></td><td>{entry.managers?.display_name || entry.managers?.name || 'TBC'}</td><td>{entry.rating ?? '—'}</td><td>{entry.pot ?? '—'}</td><td>{entry.group_code || '—'}</td></tr>)}</tbody></table></div>
      </section>

      {tables.length > 0 && <section className="transparency-card"><div className="standings-header"><h3>Cross-group finishing rankings</h3><span>Used for knockout qualification and seeding</span></div><div className="finish-grid">{finishTables.map((table) => <section className="finish-card" key={table.position}><h4>{table.position}{table.position === 1 ? 'st' : table.position === 2 ? 'nd' : table.position === 3 ? 'rd' : 'th'} placed teams</h4><div className="standings-wrap"><table className="standings-table mini-standings"><thead><tr><th>Rank</th><th>Team</th><th>Grp</th><th>Pts</th><th>GD</th><th>GF</th><th>Mgr F</th><th>Seed</th></tr></thead><tbody>{table.rows.map((row, index) => <tr key={row.entry_id}><td>{index + 1}</td><td><strong>{row.team_name}</strong></td><td>{row.group_code}</td><td><strong>{row.points}</strong></td><td>{row.goal_difference > 0 ? '+' + row.goal_difference : row.goal_difference}</td><td>{row.goals_for}</td><td className={row.manager_forfeits >= 3 ? 'forfeit-count ineligible' : row.manager_forfeits ? 'forfeit-count' : ''}>{row.manager_forfeits}</td><td>{row.seed || '—'}</td></tr>)}</tbody></table></div></section>)}</div></section>}

      {tables.length === 0 ? <div className="empty-state"><h3>No group data yet.</h3><p className="muted">Approve the draw and save fixtures first, then enter results on the Fixtures tab.</p></div> : <div className="standings-grid">{tables.map((table) => <section className="standings-card" key={table.groupCode}><div className="standings-header"><h3>Group {table.groupCode}</h3><span>{table.rows.reduce((total, row) => total + row.played, 0) / 2} results</span></div><div className="standings-wrap"><table className="standings-table"><thead><tr><th>Pos</th><th>Team</th><th>Seed</th><th>Rt</th><th>Pot</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th>Mgr F</th><th>Form</th></tr></thead><tbody>{table.rows.map((row, index) => { const qualification = qualificationForIndex(index); return <tr key={row.entry_id} className={qualification.rowClass}><td className="pos-cell"><strong>{index + 1}</strong><span className={'standing-qual ' + qualification.badgeClass}>{qualification.label}</span></td><td><strong>{row.team_name}</strong><span>{row.manager_name}</span></td><td>{row.seed || '—'}</td><td>{row.rating ?? '—'}</td><td>{row.pot ?? '—'}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.goals_for}</td><td>{row.goals_against}</td><td>{row.goal_difference > 0 ? '+' + row.goal_difference : row.goal_difference}</td><td><strong>{row.points}</strong></td><td className={row.manager_forfeits >= 3 ? 'forfeit-count ineligible' : row.manager_forfeits ? 'forfeit-count' : ''}>{row.manager_forfeits}</td><td className="form-cell">{row.form.slice(-5).map((item, itemIndex) => <span key={itemIndex} className={'form-badge ' + item}>{formSymbol(item)}</span>)}</td></tr>; })}</tbody></table></div></section>)}</div>}
    </div>
  );
}

function buildTables(entries, matches, managerForfeitCounts) {
  const entriesByGroup = entries.reduce((groups, entry) => {
    const groupCode = entry.group_code || 'Ungrouped';
    if (!groups[groupCode]) groups[groupCode] = [];
    groups[groupCode].push(entry);
    return groups;
  }, {});
  return Object.entries(entriesByGroup).sort(([a], [b]) => a.localeCompare(b)).map(([groupCode, groupEntries]) => {
    const rowsById = new Map(groupEntries.map((entry) => [entry.id, blankRow(entry, managerForfeitCounts.get(entry.manager_id) || 0)]));
    matches.filter((match) => (match.groups?.code || groupCode) === groupCode).filter(isCompleted).forEach((match) => {
      const home = rowsById.get(match.home_entry_id);
      const away = rowsById.get(match.away_entry_id);
      if (!home || !away) return;
      const homeScore = Number(match.home_score || 0);
      const awayScore = Number(match.away_score || 0);
      home.played += 1; away.played += 1;
      home.goals_for += homeScore; home.goals_against += awayScore;
      away.goals_for += awayScore; away.goals_against += homeScore;
      if (homeScore > awayScore) { home.wins += 1; home.points += 3; home.form.push('W'); away.losses += 1; away.form.push('L'); }
      else if (awayScore > homeScore) { away.wins += 1; away.points += 3; away.form.push('W'); home.losses += 1; home.form.push('L'); }
      else { home.draws += 1; away.draws += 1; home.points += 1; away.points += 1; home.form.push('D'); away.form.push('D'); }
    });
    const rows = [...rowsById.values()].map((row) => ({ ...row, goal_difference: row.goals_for - row.goals_against })).sort(sortRows).map((row, index) => ({ ...row, group_position: index + 1 }));
    return { groupCode, rows };
  });
}
