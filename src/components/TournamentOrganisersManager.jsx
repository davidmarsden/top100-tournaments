import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function TournamentOrganisersManager({ selectedTournament }) {
  const [tournaments, setTournaments] = useState([]);
  const [targetTournamentId, setTargetTournamentId] = useState(selectedTournament?.id || '');
  const [accounts, setAccounts] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [role, setRole] = useState('organiser');
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const accessRequestRef = useRef(0);
  const targetTournamentIdRef = useRef(String(selectedTournament?.id || ''));

  function selectTournament(value) {
    const nextValue = value ? String(value) : '';
    targetTournamentIdRef.current = nextValue;
    setTargetTournamentId(nextValue);
  }

  function stillTargets(tournamentId) {
    return String(targetTournamentIdRef.current) === String(tournamentId);
  }

  useEffect(() => { loadTournaments(); }, []);
  useEffect(() => {
    if (selectedTournament?.id) selectTournament(selectedTournament.id);
  }, [selectedTournament?.id]);
  useEffect(() => {
    targetTournamentIdRef.current = String(targetTournamentId || '');
    const requestId = ++accessRequestRef.current;
    setSelectedAccountId('');
    setAssignments([]);
    if (!targetTournamentId) {
      setLoading(false);
      setStatus('Choose a tournament to manage organiser access.');
      return;
    }
    loadAccess(targetTournamentId, requestId);
  }, [targetTournamentId]);

  const targetTournament = useMemo(
    () => tournaments.find((item) => String(item.id) === String(targetTournamentId)) || null,
    [tournaments, targetTournamentId],
  );
  const availableAccounts = useMemo(() => accounts.filter((account) => !assignments.some((row) => row.auth_user_id === account.auth_user_id && row.active)), [accounts, assignments]);

  async function loadTournaments() {
    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, status, registration_status, created_at, game_worlds(name)')
      .order('created_at', { ascending: false });
    if (error) {
      setStatus('Could not load tournaments: ' + error.message);
      return;
    }
    const rows = data || [];
    setTournaments(rows);
    if (!targetTournamentIdRef.current && rows[0]) selectTournament(rows[0].id);
  }

  async function loadAccess(tournamentId, requestId = ++accessRequestRef.current) {
    if (!tournamentId) return;
    setLoading(true);
    const [accountsResult, assignmentsResult] = await Promise.all([
      supabase.from('manager_portal_accounts').select('id, auth_user_id, manager_id, email, active, managers(id, name, display_name)').eq('active', true).order('email'),
      supabase.from('tournament_organisers').select('tournament_id, auth_user_id, manager_id, role, active, created_at, managers(id, name, display_name)').eq('tournament_id', tournamentId).order('created_at'),
    ]);
    if (accessRequestRef.current !== requestId || !stillTargets(tournamentId)) return;
    if (accountsResult.error) setStatus('Could not load manager accounts: ' + accountsResult.error.message);
    else if (assignmentsResult.error) setStatus('Could not load organiser assignments: ' + assignmentsResult.error.message);
    else {
      setAccounts(accountsResult.data || []);
      setAssignments(assignmentsResult.data || []);
      setStatus('Organiser access loaded.');
    }
    setLoading(false);
  }

  async function assign(event) {
    event.preventDefault();
    const account = accounts.find((item) => String(item.id) === String(selectedAccountId));
    const tournamentId = Number(targetTournamentId);
    if (!account || !tournamentId) return setStatus('Choose a tournament and Manager Portal account first.');
    setLoading(true);
    setStatus('Assigning tournament access...');
    const { data: sessionData } = await supabase.auth.getSession();
    const { error } = await supabase.from('tournament_organisers').upsert({
      tournament_id: tournamentId,
      auth_user_id: account.auth_user_id,
      manager_id: account.manager_id,
      role,
      active: true,
      created_by: sessionData.session?.user?.id || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tournament_id,auth_user_id' });

    if (!stillTargets(tournamentId)) return;
    if (error) setStatus('Could not assign organiser: ' + error.message);
    else {
      setSelectedAccountId('');
      const requestId = ++accessRequestRef.current;
      await loadAccess(tournamentId, requestId);
      if (accessRequestRef.current === requestId && stillTargets(tournamentId)) setStatus('Tournament access assigned.');
    }
    if (stillTargets(tournamentId)) setLoading(false);
  }

  async function setActive(row, active) {
    const tournamentId = Number(targetTournamentId);
    if (!tournamentId || Number(row.tournament_id) !== tournamentId) {
      setAssignments([]);
      return setStatus('Tournament selection changed. Reload organiser access before making changes.');
    }
    setLoading(true);
    const { error } = await supabase.from('tournament_organisers').update({ active, updated_at: new Date().toISOString() }).eq('tournament_id', tournamentId).eq('auth_user_id', row.auth_user_id);

    if (!stillTargets(tournamentId)) return;
    if (error) setStatus('Could not update organiser access: ' + error.message);
    else {
      const requestId = ++accessRequestRef.current;
      await loadAccess(tournamentId, requestId);
      if (accessRequestRef.current === requestId && stillTargets(tournamentId)) setStatus(active ? 'Tournament access restored.' : 'Tournament access removed.');
    }
    if (stillTargets(tournamentId)) setLoading(false);
  }

  return <div className="registration-manager">
    <section className="entrant-panel"><p className="eyebrow">Tournament-scoped access</p><h3>{targetTournament?.name || 'Choose tournament'}</h3>
      <div className="mini-grid">
        <label>Tournament<select value={targetTournamentId} onChange={(event) => selectTournament(event.target.value)} required><option value="">Choose tournament</option>{tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name} · {tournament.status || 'draft'}{tournament.registration_status ? ` · registration ${tournament.registration_status}` : ''}</option>)}</select></label>
      </div>
      {targetTournament && <p className="muted"><strong>{targetTournament.game_worlds?.name || 'Game world'}</strong> · Tournament status: <strong>{targetTournament.status || 'draft'}</strong>{targetTournament.registration_status ? <> · Registration: <strong>{targetTournament.registration_status}</strong></> : null}. A draft tournament can still have live registration; these are separate states.</p>}
      <p className="muted"><strong>Organiser</strong> has full operational control of this tournament: registration, format, entrants, groups, fixtures, results, knockout and publishing. <strong>Assistant</strong> is a matchday helper: fixtures and results, plus read access to tables, forfeits and reports. Neither role gets platform administration, manager-account approval, tournament creation or access to other private tournaments.</p>
      <form onSubmit={assign}><div className="mini-grid"><label>Manager Portal account<select value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)} required disabled={!targetTournamentId}><option value="">Choose manager</option>{availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.managers?.display_name || account.managers?.name || account.email} · {account.email}</option>)}</select></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value)} disabled={!targetTournamentId}><option value="organiser">Organiser — full tournament control</option><option value="assistant">Assistant — fixtures & results</option></select></label></div><button type="submit" disabled={loading || !targetTournamentId || !selectedAccountId}>Assign access</button></form>
      <p className="muted">Only approved Manager Portal accounts can receive organiser or assistant access because tournament administration requires an authenticated login. If a manager is missing from this list, they need to create and have their Portal account approved first.</p>
      <p className="status">{status}</p></section>
    <section className="entrant-panel"><p className="eyebrow">Current access</p><h3>{targetTournament ? `${targetTournament.name} staff` : 'Assigned tournament staff'}</h3>{!targetTournamentId ? <p className="muted">Choose a tournament to view or change its staff access.</p> : !assignments.length ? <p className="muted">No tournament staff assigned yet.</p> : <div className="entrant-list">{assignments.map((row) => <article className="entrant-row" key={row.auth_user_id}><div><strong>{row.managers?.display_name || row.managers?.name || 'Manager'} · {row.role}</strong><span>{row.active ? 'Access active' : 'Access disabled'}</span></div><button type="button" className={row.active ? 'danger' : 'secondary'} onClick={() => setActive(row, !row.active)} disabled={loading || Number(row.tournament_id) !== Number(targetTournamentId)}>{row.active ? 'Remove access' : 'Restore access'}</button></article>)}</div>}</section>
  </div>;
}
