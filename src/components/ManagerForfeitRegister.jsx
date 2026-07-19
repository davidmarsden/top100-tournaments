import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function managerName(entry) {
  return entry?.managers?.display_name || entry?.managers?.name || 'Unknown manager';
}

function teamName(entry) {
  return entry?.teams?.name || 'No current club';
}

function formatDate(value) {
  if (!value) return 'Date unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ManagerForfeitRegister({ selectedTournament, tournamentId: suppliedTournamentId, admin = false }) {
  const tournamentId = suppliedTournamentId || selectedTournament?.id;
  const [entries, setEntries] = useState([]);
  const [matches, setMatches] = useState([]);
  const [forfeits, setForfeits] = useState([]);
  const [managerProfiles, setManagerProfiles] = useState([]);
  const [status, setStatus] = useState('Loading manager forfeit register...');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase || !tournamentId) return undefined;
    loadData();

    const channel = supabase
      .channel(`manager-forfeit-register-${tournamentId}-${admin ? 'admin' : 'public'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournamentId}` }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_entries', filter: `tournament_id=eq.${tournamentId}` }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'forfeits' }, loadData)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [tournamentId, admin]);

  async function loadData() {
    if (!tournamentId) return;
    setLoading(true);
    const [entriesResult, matchesResult] = await Promise.all([
      supabase
        .from('tournament_entries')
        .select('id, manager_id, team_id, group_code, teams(id, name), managers(id, name, display_name)')
        .eq('tournament_id', tournamentId),
      supabase
        .from('matches')
        .select('id, stage, round, fixture_date, home_entry_id, away_entry_id, home_score, away_score, status')
        .eq('tournament_id', tournamentId),
    ]);

    if (entriesResult.error || matchesResult.error) {
      setStatus(`Could not load forfeit register: ${entriesResult.error?.message || matchesResult.error?.message}`);
      setLoading(false);
      return;
    }

    const matchRows = matchesResult.data || [];
    const matchIds = matchRows.map((match) => match.id);
    let forfeitRows = [];
    let profiles = [];
    if (matchIds.length) {
      const forfeitsResult = await supabase
        .from('forfeits')
        .select('id, match_id, forfeiting_entry_id, manager_id, reason, penalty, affects_prize_draw, created_at')
        .in('match_id', matchIds)
        .order('created_at', { ascending: true });
      if (forfeitsResult.error) {
        setStatus(`Could not load forfeits: ${forfeitsResult.error.message}`);
        setLoading(false);
        return;
      }
      forfeitRows = forfeitsResult.data || [];
      const managerIds = [...new Set(forfeitRows.map((row) => row.manager_id).filter(Boolean))];
      if (managerIds.length) {
        const managersResult = await supabase.from('managers').select('id, name, display_name').in('id', managerIds);
        if (!managersResult.error) profiles = managersResult.data || [];
      }
    }

    setEntries(entriesResult.data || []);
    setMatches(matchRows);
    setForfeits(forfeitRows);
    setManagerProfiles(profiles);
    setStatus('');
    setLoading(false);
  }

  const rows = useMemo(() => {
    const matchesById = new Map(matches.map((match) => [match.id, match]));
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    const currentEntryByManager = new Map(entries.filter((entry) => entry.manager_id).map((entry) => [entry.manager_id, entry]));
    const profilesById = new Map(managerProfiles.map((manager) => [manager.id, manager]));
    const grouped = new Map();

    forfeits.forEach((forfeit) => {
      const historicalEntry = entriesById.get(forfeit.forfeiting_entry_id);
      const managerId = forfeit.manager_id || historicalEntry?.manager_id;
      if (!managerId) return;
      if (!grouped.has(managerId)) grouped.set(managerId, []);
      grouped.get(managerId).push({ ...forfeit, match: matchesById.get(forfeit.match_id), historicalEntry });
    });

    return [...grouped.entries()].map(([managerId, records]) => {
      const currentEntry = currentEntryByManager.get(managerId);
      const fallbackEntry = records[records.length - 1]?.historicalEntry;
      const profile = profilesById.get(managerId);
      const groupForfeits = records.filter((record) => record.match?.stage === 'group').length;
      const prizeDrawExcluded = records.some((record) => record.affects_prize_draw !== false);
      return {
        managerId,
        managerName: profile?.display_name || profile?.name || managerName(currentEntry || fallbackEntry),
        currentClub: currentEntry ? teamName(currentEntry) : 'No longer managing this entrant',
        groupCode: currentEntry?.group_code || '—',
        groupForfeits,
        totalForfeits: records.length,
        prizeDrawExcluded,
        knockoutIneligible: groupForfeits >= 3,
        records,
      };
    }).sort((a, b) => b.groupForfeits - a.groupForfeits || b.totalForfeits - a.totalForfeits || a.managerName.localeCompare(b.managerName));
  }, [entries, matches, forfeits, managerProfiles]);

  if (!tournamentId) return <p className="muted">Select a tournament first.</p>;
  if (!hasSupabaseConfig || !supabase) return <p className="muted">Supabase is not connected yet.</p>;

  return (
    <div className="manager-forfeit-register">
      <div className="fixtures-toolbar">
        <div>
          <p className="eyebrow">Manager discipline</p>
          <h3>Manager forfeit register</h3>
          <p className="muted">Forfeits stay with the responsible manager. The club keeps the forfeited match result, while a replacement manager starts with their own disciplinary record.</p>
        </div>
        {admin && <button type="button" className="secondary" onClick={loadData} disabled={loading}>Reload register</button>}
      </div>
      {status && <p className="status">{status}</p>}
      {!status && rows.length === 0 && <p className="muted">No manager forfeits have been recorded.</p>}
      {rows.length > 0 && <div className="standings-wrap"><table className="standings-table forfeit-register-table"><thead><tr><th>Manager</th><th>Current club</th><th>Group</th><th>Group F</th><th>Total F</th><th>Knockout</th><th>Prize draw</th>{admin && <th>Details</th>}</tr></thead><tbody>{rows.map((row) => <tr key={row.managerId} className={row.knockoutIneligible ? 'forfeit-ineligible-row' : row.groupForfeits === 2 ? 'forfeit-warning-row' : ''}><td><strong>{row.managerName}</strong></td><td>{row.currentClub}</td><td>{row.groupCode}</td><td><strong>{row.groupForfeits}</strong></td><td>{row.totalForfeits}</td><td>{row.knockoutIneligible ? <span className="eligibility-pill ineligible">Ineligible</span> : row.groupForfeits === 2 ? <span className="eligibility-pill warning">Warning</span> : <span className="eligibility-pill eligible">Eligible</span>}</td><td>{row.prizeDrawExcluded ? <span className="eligibility-pill ineligible">Excluded</span> : <span className="eligibility-pill eligible">Eligible</span>}</td>{admin && <td><details><summary>{row.records.length} fixture{row.records.length === 1 ? '' : 's'}</summary><ul className="forfeit-detail-list">{row.records.map((record) => <li key={record.id}><strong>{record.match?.stage === 'group' ? 'Group stage' : 'Knockout'} · {record.match?.round || 'Round'}</strong><span>{formatDate(record.match?.fixture_date || record.created_at)} · {record.reason || 'Forfeit recorded'}{record.affects_prize_draw === false ? ' · prize-draw exception' : ''}</span></li>)}</ul></details></td>}</tr>)}</tbody></table></div>}
      <p className="muted register-note">Three or more group-stage forfeits make the manager ineligible for the knockout draw. Any forfeit affecting the prize draw excludes that manager from the end-of-season free-player-pick draw.</p>
    </div>
  );
}
