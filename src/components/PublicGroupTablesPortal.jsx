import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const isCompleted = (match) => match.status === 'played' || match.status === 'forfeit';
const managerName = (entry) => entry?.managers?.display_name || entry?.managers?.name || 'TBC';

function tableSort(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
  if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
  if (a.seed && b.seed && a.seed !== b.seed) return a.seed - b.seed;
  return a.team_name.localeCompare(b.team_name);
}

function blankRow(entry) {
  return {
    entry_id: entry.id,
    team_name: entry.teams?.name || 'Unknown team',
    manager_name: managerName(entry),
    seed: entry.seed,
    group_code: entry.group_code || 'Ungrouped',
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

function buildTables(entries, matches) {
  const byGroup = entries.reduce((groups, entry) => {
    const code = entry.group_code || 'Ungrouped';
    if (!groups[code]) groups[code] = [];
    groups[code].push(entry);
    return groups;
  }, {});

  return Object.entries(byGroup)
    .sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    .map(([groupCode, groupEntries]) => {
      const rowsById = new Map(groupEntries.map((entry) => [entry.id, blankRow(entry)]));

      matches
        .filter((match) => match.stage === 'group' && match.group_code === groupCode && isCompleted(match))
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
        .sort(tableSort);

      return { groupCode, rows };
    });
}

function signed(value) {
  return value > 0 ? `+${value}` : value;
}

export default function PublicGroupTablesPortal({ tournamentId }) {
  const [host, setHost] = useState(null);
  const [entries, setEntries] = useState([]);
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('Loading group tables...');
  const [selectedGroup, setSelectedGroup] = useState('all');

  const tables = useMemo(() => buildTables(entries, matches), [entries, matches]);
  const visibleTables = selectedGroup === 'all' ? tables : tables.filter((table) => table.groupCode === selectedGroup);

  useEffect(() => {
    const groupsSection = document.getElementById('groups');
    if (!groupsSection) return undefined;

    const portalHost = document.createElement('div');
    portalHost.className = 'public-group-tables-portal';
    const toolbar = groupsSection.querySelector('.public-section-toolbar');
    if (toolbar?.nextSibling) groupsSection.insertBefore(portalHost, toolbar.nextSibling);
    else groupsSection.appendChild(portalHost);
    setHost(portalHost);

    const select = groupsSection.querySelector('.public-group-filter select');
    const syncSelection = () => setSelectedGroup(select?.value || 'all');
    syncSelection();
    select?.addEventListener('change', syncSelection);

    return () => {
      select?.removeEventListener('change', syncSelection);
      portalHost.remove();
      setHost(null);
    };
  }, [tournamentId]);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase || !tournamentId) return undefined;

    loadTables();

    const channel = supabase
      .channel(`public-group-tables-${tournamentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournamentId}` }, loadTables)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_entries', filter: `tournament_id=eq.${tournamentId}` }, loadTables)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tournamentId]);

  async function loadTables() {
    const [entriesResult, matchesResult] = await Promise.all([
      supabase
        .from('tournament_entries')
        .select('id, seed, group_code, teams(id, name), managers(id, name, display_name)')
        .eq('tournament_id', tournamentId)
        .order('seed', { ascending: true }),
      supabase
        .from('matches')
        .select('id, stage, group_id, home_entry_id, away_entry_id, home_score, away_score, status, groups(code)')
        .eq('tournament_id', tournamentId)
        .eq('stage', 'group'),
    ]);

    if (entriesResult.error || matchesResult.error) {
      setStatus(`Could not load group tables: ${entriesResult.error?.message || matchesResult.error?.message}`);
      return;
    }

    setEntries(entriesResult.data || []);
    setMatches((matchesResult.data || []).map((match) => ({ ...match, group_code: match.groups?.code || 'Ungrouped' })));
    setStatus('');
  }

  if (!host) return null;

  return createPortal(
    <section className="public-group-tables">
      <div className="card-header">
        <p className="eyebrow">Live group standings</p>
        <h3>{selectedGroup === 'all' ? 'Group tables' : `Group ${selectedGroup} table`}</h3>
        <p className="muted">Updated automatically from completed and forfeited match results. Sorting: points, goal difference, goals scored, then original seed.</p>
      </div>
      {status && <p className="status">{status}</p>}
      {!status && !visibleTables.length && <p className="muted">No group entries are available yet.</p>}
      <div className="standings-grid">
        {visibleTables.map((table) => (
          <section className="standings-card" key={table.groupCode}>
            <div className="standings-header"><h3>Group {table.groupCode}</h3><span>{table.rows.length} teams</span></div>
            <div className="standings-wrap">
              <table className="standings-table">
                <thead><tr><th>Pos</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead>
                <tbody>
                  {table.rows.map((row, index) => (
                    <tr key={row.entry_id}>
                      <td><strong>{index + 1}</strong></td>
                      <td><strong>{row.team_name}</strong><span>{row.manager_name}</span></td>
                      <td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td>
                      <td>{row.goals_for}</td><td>{row.goals_against}</td><td>{signed(row.goal_difference)}</td><td><strong>{row.points}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </section>,
    host,
  );
}
