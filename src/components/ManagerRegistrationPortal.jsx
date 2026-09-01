import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusLabel(row) {
  if (row.status === 'approved') return row.promoted_entry_id ? 'Entry confirmed' : 'Registration approved';
  if (row.status === 'pending') return 'Registration submitted';
  if (row.status === 'rejected') return 'Registration not approved';
  if (row.status === 'withdrawn') return 'Registration withdrawn';
  return row.status;
}

export default function ManagerRegistrationPortal() {
  const [session, setSession] = useState(null);
  const [account, setAccount] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [teams, setTeams] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [form, setForm] = useState({ tournamentId: '', teamId: '', rating: '', notes: '' });
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setLoading(false); return undefined; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session || null); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (session?.user) load();
    else { setAccount(null); setRegistrations([]); setTournaments([]); setLoading(false); }
  }, [session?.user?.id]);

  const activeRegistrationTournamentIds = useMemo(
    () => new Set(registrations.filter((row) => ['pending', 'approved'].includes(row.status)).map((row) => row.tournament_id)),
    [registrations],
  );
  const availableTournaments = useMemo(
    () => tournaments.filter((item) => !activeRegistrationTournamentIds.has(item.id)),
    [tournaments, activeRegistrationTournamentIds],
  );

  async function load() {
    setLoading(true);
    setMessage('Loading registration records...');
    const [accountResult, tournamentsResult, teamsResult, registrationsResult] = await Promise.all([
      supabase.from('manager_portal_accounts').select('id, manager_id, email, active, managers(id, name, display_name)').eq('auth_user_id', session.user.id).eq('active', true).maybeSingle(),
      supabase.rpc('open_tournament_registrations'),
      supabase.from('teams').select('id, name').eq('active', true).order('name'),
      supabase.from('tournament_registrations').select('id, tournament_id, team_id, club_name, status, submitted_at, reviewed_at, review_notes, promoted_entry_id, promoted_at, tournaments(name, season_number)').eq('auth_user_id', session.user.id).order('submitted_at', { ascending: false }),
    ]);

    if (accountResult.error) { setMessage('Could not load your Manager Portal account: ' + accountResult.error.message); setLoading(false); return; }
    setAccount(accountResult.data || null);
    setTournaments(tournamentsResult.error ? [] : tournamentsResult.data || []);
    setTeams(teamsResult.error ? [] : teamsResult.data || []);
    setRegistrations(registrationsResult.error ? [] : registrationsResult.data || []);

    if (tournamentsResult.error) setMessage('Could not load open tournaments: ' + tournamentsResult.error.message);
    else if (teamsResult.error) setMessage('Could not load teams: ' + teamsResult.error.message);
    else if (registrationsResult.error) setMessage('Could not load your registrations: ' + registrationsResult.error.message);
    else setMessage('Your registration record is up to date.');
    setLoading(false);
  }

  async function submit(event) {
    event.preventDefault();
    if (!form.tournamentId || !form.teamId) return setMessage('Choose a tournament and team first.');
    setLoading(true);
    setMessage('Submitting registration...');
    const { data, error } = await supabase.rpc('submit_manager_tournament_registration', {
      target_tournament_id: Number(form.tournamentId),
      target_team_id: Number(form.teamId),
      target_rating: form.rating === '' ? null : Number(form.rating),
      target_notes: form.notes.trim() || null,
    });
    if (error) setMessage('Registration failed: ' + error.message);
    else {
      setMessage(`Registration submitted successfully. Reference #${data.id}.`);
      setForm({ tournamentId: '', teamId: '', rating: '', notes: '' });
      await load();
    }
    setLoading(false);
  }

  async function withdraw(row) {
    if (!window.confirm(`Withdraw your registration for ${row.tournaments?.name || 'this tournament'}?`)) return;
    setLoading(true);
    const { error } = await supabase.rpc('withdraw_manager_tournament_registration', { target_registration_id: row.id });
    if (error) setMessage('Could not withdraw registration: ' + error.message);
    else { setMessage('Registration withdrawn.'); await load(); }
    setLoading(false);
  }

  async function logout() {
    await supabase.auth.signOut();
    window.location.href = '/manager';
  }

  if (!hasSupabaseConfig || !supabase) return <main className="manager-portal-shell"><section className="warning-card"><strong>Registration unavailable.</strong><span>Supabase is not connected.</span></section></main>;
  if (!session) return <main className="manager-portal-shell"><section className="manager-portal-hero"><p className="eyebrow">Top 100 Tournament Manager</p><h1>Team registration</h1><p>Registration is tied to your verified Manager Portal identity, so there is always a visible record of what you submitted.</p></section><section className="card manager-login-card"><h2>Sign in first</h2><p>Use your Manager Portal sign-in, then return here to register your team.</p><a className="button" href="/manager">Open Manager Portal</a></section></main>;
  if (loading && !account) return <main className="manager-portal-shell"><section className="card"><h1>Loading registration portal...</h1></section></main>;
  if (!account) return <main className="manager-portal-shell"><section className="manager-portal-hero"><div><p className="eyebrow">Team registration</p><h1>Manager profile required</h1><p>Signed in as {session.user.email}</p></div><button type="button" className="secondary" onClick={logout}>Sign out</button></section><section className="card"><p>Your manager claim must be approved before you can register a team.</p><a className="button" href="/manager">Open Manager Portal</a></section></main>;

  return <main className="manager-portal-shell">
    <section className="manager-portal-hero"><div><p className="eyebrow">Top 100 Tournament Manager</p><h1>Team registration</h1><p>{account.managers?.display_name || account.managers?.name} · {account.email}</p></div><div className="button-row"><a className="button secondary" href="/manager">Manager Portal</a><button type="button" className="secondary" onClick={logout}>Sign out</button></div></section>

    <section className="card"><div className="card-header"><p className="eyebrow">Your record</p><h2>Registrations</h2></div><p><strong>If a registration appears here as submitted or approved, we have it.</strong> No more wondering whether the form went through.</p>{!registrations.length ? <p className="muted">You have no tournament registrations yet.</p> : <div className="entrant-list">{registrations.map((row) => <article className="entrant-row registration-row" key={row.id}><div className="registration-details"><strong>{statusLabel(row)} · {row.tournaments?.name || `Tournament #${row.tournament_id}`}</strong><span>{row.club_name} · submitted {formatDate(row.submitted_at)} · reference #{row.id}</span>{row.reviewed_at && <span>Reviewed {formatDate(row.reviewed_at)}</span>}{row.review_notes && <span>{row.review_notes}</span>}{row.promoted_entry_id && <span>Entrant #{row.promoted_entry_id} confirmed {formatDate(row.promoted_at)}</span>}</div>{row.status === 'pending' && <button type="button" className="secondary" onClick={() => withdraw(row)} disabled={loading}>Withdraw</button>}</article>)}</div>}</section>

    <section className="card manager-login-card"><div className="card-header"><p className="eyebrow">Register</p><h2>Enter an open tournament</h2></div>{!availableTournaments.length ? <p className="muted">There are no additional open tournaments available to you right now.</p> : <form onSubmit={submit}><label>Tournament<select value={form.tournamentId} onChange={(event) => setForm((current) => ({ ...current, tournamentId: event.target.value }))} required><option value="">Choose tournament</option>{availableTournaments.map((item) => <option key={item.id} value={item.id}>{item.name}{item.game_world_name ? ` · ${item.game_world_name}` : ''}</option>)}</select></label><label>Team<select value={form.teamId} onChange={(event) => setForm((current) => ({ ...current, teamId: event.target.value }))} required><option value="">Choose team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label><label>Rating (optional)<input type="number" step="1" min="0" value={form.rating} onChange={(event) => setForm((current) => ({ ...current, rating: event.target.value }))} /></label><label>Note (optional)<textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} rows="3" /></label><button type="submit" disabled={loading}>{loading ? 'Submitting...' : 'Register team'}</button></form>}{message && <p className="status">{message}</p>}</section>
  </main>;
}
