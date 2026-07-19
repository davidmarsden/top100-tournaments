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

function qualificationForIndex(index) {
  if (index < 2) return { rowClass: 'cup-zone', badgeClass: 'cup', label: 'CUP' };
  if (index === 2) return { rowClass: 'shield-zone', badgeClass: 'shield', label: 'SHIELD' };
  return { rowClass: 'out-zone', badgeClass: 'out', label: 'OUT' };
}

function formSymbol(result) {
  if (result === 'W') return '✓';
  if (result === 'D') return '–';
  return '×';
}

function blankRow(entry, managerForfeits) {
  return {
    entry_id: entry.id,
    manager_id: entry.manager_id,
    team_name: entry.teams?.name || 'Unknown team',
    manager_name: managerName(entry),
    seed: entry.seed,
    rating: entry.rating,
    pot: entry.pot,
    group_code: entry.group_code || 'Ungrouped',
    manager_forfeits: managerForfeits,
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

function buildTables(entries, matches, managerForfeitCounts) {
  const byGroup = entries.reduce((groups, entry) => {
    const code = entry.group_code || 'Ungrouped';
    if (!groups[code]) groups[code] = [];
    groups[code].push(entry);
    return groups;
  }, {});

  return Object.entries(byGroup)
    .sort(([a], [b]) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    .map(([groupCode, groupEntries]) => {
      const rowsById = new Map(groupEntries.map((entry) => [entry.id, blankRow(entry, managerForfeitCounts.get(entry.manager_id) || 0)]));

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
            home.wins += 1; home.points += 3; home.form.push('W');
            away.losses += 1; away.form.push('L');
          } else if (awayScore > homeScore) {
            away.wins += 1; away.points += 3; away.form.push('W');
            home.losses += 1; home.form.push('L');
          } else {
            home.draws += 1; away.draws += 1;
            home.points += 1; away.points += 1;
            home.form.push('D'); away.form.push('D');
          }
        });

      const rows = [...rowsById.values()]
        .map((row) => ({ ...row, goal_difference: row.goals_for - row.goals_against }))
        .sort(tableSort);

      return { groupCode, rows };
    });
}

export default function PublicGroupTablesPortal({ tournamentId }) {
  const [host, setHost] = useState(null);
  const [entries, setEntries] = useState([]);
  const [matches, setMatches] = useState([]);
  const [forfeits, setForfeits] = useState([]);
  const [status, setStatus] = useState('Loading group tables...');
  const [selectedGroup, setSelectedGroup] = useState('all');

  const groupMatchIds = useMemo(() => new Set(matches.map((match) => match.id)), [matches]);
  const managerForfeitCounts = useMemo(() => forfeits.reduce((counts, forfeit) => {
    if (!groupMatchIds.has(forfeit.match_id) || !forfeit.manager_id) return counts;
    counts.set(forfeit.manager_id, (counts.get(forfeit.manager_id) || 0) + 1);
    return counts;
  }, new Map()), [forfeits, groupMatchIds]);
  const tables = useMemo(() => buildTables(entries, matches, managerForfeitCounts), [entries, matches, managerForfeitCounts]);
  const visibleTables = selectedGroup === 'all' ? tables : tables.filter((table) => table.groupCode === selectedGroup);

  useEffect(() => {
    let portalHost = null;
    let select = null;
    let observer = null;

    const mount = () => {
      const groupsSection = document.getElementById('groups');
      if (!groupsSection || portalHost) return false;
      portalHost = document.createElement('div');
      portalHost.className = 'public-group-tables-portal';
      const toolbar = groupsSection.querySelector('.public-section-toolbar');
      if (toolbar?.nextSibling) groupsSection.insertBefore(portalHost, toolbar.nextSibling);
      else groupsSection.appendChild(portalHost);
      setHost(portalHost);
      select = groupsSection.querySelector('.public-group-filter select');
      const syncSelection = () => setSelectedGroup(select?.value || 'all');
      syncSelection();
      select?.addEventListener('change', syncSelection);
      portalHost._cleanupSelection = () => select?.removeEventListener('change', syncSelection);
      return true;
    };

    if (!mount()) {
      observer = new MutationObserver(() => {
        if (mount()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      portalHost?._cleanupSelection?.();
      portalHost?.remove();
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'forfeits' }, loadTables)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tournamentId]);

  async function loadTables() {
    const [entriesResult, matchesResult] = await Promise.all([
      supabase.from('tournament_entries').select('id, manager_id, seed, rating, pot, group_code, teams(id, name), managers(id, name, display_name)').eq('tournament_id', tournamentId).order('seed', { ascending: true }),
      supabase.from('matches').select('id, stage, group_id, home_entry_id, away_entry_id, home_score, away_score, status, match_order, groups(code)').eq('tournament_id', tournamentId).eq('stage', 'group'),
    ]);

    if (entriesResult.error || matchesResult.error) {
      setStatus(`Could not load group tables: ${entriesResult.error?.message || matchesResult.error?.message}`);
      return;
    }

    const matchRows = (matchesResult.data || []).map((match) => ({ ...match, group_code: match.groups?.code || 'Ungrouped' }));
    let forfeitRows = [];
    if (matchRows.length) {
      const forfeitsResult = await supabase.from('forfeits').select('id, match_id, manager_id').in('match_id', matchRows.map((match) => match.id));
      if (forfeitsResult.error) {
        setStatus(`Could not load group forfeits: ${forfeitsResult.error.message}`);
        return;
      }
      forfeitRows = forfeitsResult.data || [];
    }

    setEntries(entriesResult.data || []);
    setMatches(matchRows);
    setForfeits(forfeitRows);
    setStatus('');
  }

  if (!host) return null;

  return createPortal(
    <section className="public-group-tables">
      <div className="card-header">
        <p className="eyebrow">Live group standings</p>
        <h3>{selectedGroup === 'all' ? 'Group tables' : `Group ${selectedGroup} table`}</h3>
        <p className="muted">Updated automatically from completed and forfeited results. “Mgr F” follows the responsible manager, not the club.</p>
      </div>
      {status && <p className="status">{status}</p>}
      {!status && !visibleTables.length && <p className="muted">No group entries are available yet.</p>}
      <div className="standings-grid">
        {visibleTables.map((table) => (
          <section className="standings-card" key={table.groupCode}>
            <div className="standings-header"><h3>Group {table.groupCode}</h3><span>{table.rows.reduce((total, row) => total + row.played, 0) / 2} results</span></div>
            <div className="standings-wrap">
              <table className="standings-table">
                <thead><tr><th>Pos</th><th>Team</th><th>Seed</th><th>Rt</th><th>Pot</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th><th>Mgr F</th><th>Form</th></tr></thead>
                <tbody>{table.rows.map((row, index) => { const qualification = qualificationForIndex(index); return <tr key={row.entry_id} className={qualification.rowClass}><td className="pos-cell"><strong>{index + 1}</strong><span className={'standing-qual ' + qualification.badgeClass}>{qualification.label}</span></td><td><strong>{row.team_name}</strong><span>{row.manager_name}</span></td><td>{row.seed || '—'}</td><td>{row.rating ?? '—'}</td><td>{row.pot ?? '—'}</td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.goals_for}</td><td>{row.goals_against}</td><td>{row.goal_difference > 0 ? `+${row.goal_difference}` : row.goal_difference}</td><td><strong>{row.points}</strong></td><td className={row.manager_forfeits >= 3 ? 'forfeit-count ineligible' : row.manager_forfeits ? 'forfeit-count' : ''}>{row.manager_forfeits}</td><td className="form-cell">{row.form.slice(-5).map((item, itemIndex) => <span key={itemIndex} className={'form-badge ' + item}>{formSymbol(item)}</span>)}</td></tr>; })}</tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </section>,
    host,
  );
}
