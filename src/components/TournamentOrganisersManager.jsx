import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function TournamentOrganisersManager({ selectedTournament }) {
  const [accounts, setAccounts] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [role, setRole] = useState('organiser');
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const tournamentId = selectedTournament?.id;

  useEffect(() => { if (tournamentId) load(); }, [tournamentId]);

  const availableAccounts = useMemo(() => accounts.filter((account) => !assignments.some((row) => row.auth_user_id === account.auth_user_id && row.active)), [accounts, assignments]);

  async function load() {
    if (!tournamentId) return;
    setLoading(true);
    const [accountsResult, assignmentsResult] = await Promise.all([
      supabase.from('manager_portal_accounts').select('id, auth_user_id, manager_id, email, active, managers(id, name, display_name)').eq('active', true).order('email'),
      supabase.from('tournament_organisers').select('tournament_id, auth_user_id, manager_id, role, active, created_at, managers(id, name, display_name)').eq('tournament_id', tournamentId).order('created_at'),
    ]);
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
    if (!account || !tournamentId) return setStatus('Choose a Manager Portal account first.');
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
    if (error) setStatus('Could not assign organiser: ' + error.message);
    else { setSelectedAccountId(''); await load(); setStatus('Tournament access assigned.'); }
    setLoading(false);
  }

  async function setActive(row, active) {
    setLoading(true);
    const { error } = await supabase.from('tournament_organisers').update({ active, updated_at: new Date().toISOString() }).eq('tournament_id', row.tournament_id).eq('auth_user_id', row.auth_user_id);
    if (error) setStatus('Could not update organiser access: ' + error.message);
    else { await load(); setStatus(active ? 'Tournament access restored.' : 'Tournament access removed.'); }
    setLoading(false);
  }

  if (!selectedTournament) return <p className="muted">Select a tournament first.</p>;

  return <div className="registration-manager">
    <section className="entrant-panel"><p className="eyebrow">Tournament-scoped access</p><h3>{selectedTournament.name}</h3><p className="muted">Organisers can operate this tournament only. They do not get platform administration, manager-account approval, tournament creation or access to other private tournaments.</p><form onSubmit={assign}><div className="mini-grid"><label>Manager Portal account<select value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)} required><option value="">Choose manager</option>{availableAccounts.map((account) => <option key={account.id} value={account.id}>{account.managers?.display_name || account.managers?.name || account.email} · {account.email}</option>)}</select></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value)}><option value="organiser">Organiser</option><option value="assistant">Assistant</option></select></label></div><button type="submit" disabled={loading || !selectedAccountId}>Assign access</button></form><p className="status">{status}</p></section>
    <section className="entrant-panel"><p className="eyebrow">Current access</p><h3>Assigned organisers</h3>{!assignments.length ? <p className="muted">No organisers assigned yet. Pane will appear in the account list after his Manager Portal claim is approved.</p> : <div className="entrant-list">{assignments.map((row) => <article className="entrant-row" key={row.auth_user_id}><div><strong>{row.managers?.display_name || row.managers?.name || 'Manager'} · {row.role}</strong><span>{row.active ? 'Access active' : 'Access disabled'}</span></div><button type="button" className={row.active ? 'danger' : 'secondary'} onClick={() => setActive(row, !row.active)} disabled={loading}>{row.active ? 'Remove access' : 'Restore access'}</button></article>)}</div>}</section>
  </div>;
}
