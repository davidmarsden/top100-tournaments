import { useEffect, useMemo, useRef, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import ManagerResultCentre from './ManagerResultCentre.jsx';

function normalise(value) { return String(value || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function isPlayed(match) { return match.status === 'played' || match.status === 'forfeit'; }
function matchDate(match) { if (!match.fixture_date) return 'Date TBC'; const [year, month, day] = match.fixture_date.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
function ordinal(value) { if (!value) return 'TBC'; return `${value}${value === 1 ? 'st' : value === 2 ? 'nd' : value === 3 ? 'rd' : 'th'}`; }
function entryTeamName(entry, fallback = 'TBC') { return entry?.teams?.name || fallback || 'TBC'; }
function registrationPath(tournament) { return `/${tournament.game_worlds?.slug}/${tournament.competition_types?.slug}/${tournament.public_slug}/register`; }
function registrationStatusLabel(row) {
  if (row.status === 'approved') return row.promoted_entry_id ? 'Entry confirmed' : 'Registration approved';
  if (row.status === 'pending') return 'Registration submitted';
  if (row.status === 'rejected') return 'Registration not approved';
  if (row.status === 'withdrawn') return 'Registration withdrawn';
  return row.status || 'Registration';
}
function registrationDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}
const PORTAL_LOAD_TIMEOUT_MS = 8000;

function withPortalTimeout(promise, label = 'Manager Portal request', ms = PORTAL_LOAD_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} timed out. Please try again.`)), ms);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

function buildStandings(entries, matches) {
  const rows = new Map(entries.map((entry) => [entry.id, { id: entry.id, team: entry.teams?.name || 'Unknown team', played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 }]));
  matches.filter(isPlayed).forEach((match) => {
    const home = rows.get(match.home_entry_id), away = rows.get(match.away_entry_id), hs = Number(match.home_score), as = Number(match.away_score);
    if (!home || !away || !Number.isFinite(hs) || !Number.isFinite(as)) return;
    home.played += 1; away.played += 1; home.gf += hs; home.ga += as; away.gf += as; away.ga += hs;
    const doubleForfeit = match.status === 'forfeit' && hs === 0 && as === 0;
    if (doubleForfeit) { home.lost += 1; away.lost += 1; }
    else if (hs > as) { home.won += 1; away.lost += 1; home.points += 3; }
    else if (as > hs) { away.won += 1; home.lost += 1; away.points += 3; }
    else { home.drawn += 1; away.drawn += 1; home.points += 1; away.points += 1; }
  });
  return [...rows.values()].map((row) => ({ ...row, gd: row.gf - row.ga })).sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
}

export default function ManagerPortal({ registrationMode = false }) {
  const [session, setSession] = useState(null), [email, setEmail] = useState(''), [message, setMessage] = useState(''), [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [magicLinkStatus, setMagicLinkStatus] = useState('idle');
  const [magicLinkSentTo, setMagicLinkSentTo] = useState('');
  const [magicLinkResendIn, setMagicLinkResendIn] = useState(0);
  const magicLinkCooldownUntil = useRef(0);
  const magicLinkRequestId = useRef(0);
  const [account, setAccount] = useState(null), [claim, setClaim] = useState(null), [claimForm, setClaimForm] = useState({ gameWorldId: '', managerName: '', clubName: '' });
  const [gameWorlds, setGameWorlds] = useState([]), [worldClubs, setWorldClubs] = useState([]);
  const [entries, setEntries] = useState([]), [matches, setMatches] = useState([]), [groupEntries, setGroupEntries] = useState([]), [selectedEntryId, setSelectedEntryId] = useState('');
  const [adminAssignments, setAdminAssignments] = useState([]);
  const [openTournaments, setOpenTournaments] = useState([]);
  const [registrations, setRegistrations] = useState([]);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setLoading(false); return undefined; }
    let active = true;
    let subscription = null;

    async function initialiseAuth() {
      try {
        const { data, error } = await withPortalTimeout(supabase.auth.getSession(), 'Sign-in check');
        if (!active) return;
        if (error) throw error;
        setSession(data.session || null);

        // Wait for the initial session recovery to finish before subscribing.
        // auth-js can deadlock its browser Web Lock if a listener registers
        // while initialization/session refresh is still in progress.
        const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          if (!active) return;
          setSession(nextSession);
        });
        subscription = listener.subscription;
      } catch (error) {
        if (!active) return;
        setMessage(error?.message || 'We could not check your sign-in. Please try again.');
        setLoading(false);
      }
    }

    initialiseAuth();
    return () => { active = false; subscription?.unsubscribe(); };
  }, []);
  useEffect(() => { if (session?.user) { loadIdentityDirectory(); loadPortal(); } else { setLoading(false); setAccount(null); setClaim(null); setEntries([]); setAdminAssignments([]); } }, [session?.user?.id]);
  useEffect(() => { loadWorldClubs(claimForm.gameWorldId); }, [claimForm.gameWorldId]);
  useEffect(() => {
    if (magicLinkResendIn <= 0) return undefined;
    const timer = window.setInterval(() => {
      setMagicLinkResendIn((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [magicLinkResendIn]);

  const selectedEntry = useMemo(() => entries.find((entry) => String(entry.id) === String(selectedEntryId)) || entries[0] || null, [entries, selectedEntryId]);
  const selectedTournamentMatches = useMemo(() => selectedEntry ? matches.filter((match) => match.tournament_id === selectedEntry.tournament_id) : [], [matches, selectedEntry]);
  const myMatches = useMemo(() => selectedEntry ? selectedTournamentMatches.filter((match) => match.home_entry_id === selectedEntry.id || match.away_entry_id === selectedEntry.id) : [], [selectedTournamentMatches, selectedEntry]);
  const upcoming = useMemo(() => myMatches.filter((match) => !isPlayed(match)).sort((a, b) => String(a.fixture_date || '9999').localeCompare(String(b.fixture_date || '9999')) || Number(a.match_order || 0) - Number(b.match_order || 0)), [myMatches]);
  const results = useMemo(() => myMatches.filter(isPlayed).sort((a, b) => Number(b.match_order || 0) - Number(a.match_order || 0)), [myMatches]);
  const currentGroupEntries = useMemo(() => selectedEntry ? groupEntries.filter((entry) => entry.tournament_id === selectedEntry.tournament_id && entry.group_code === selectedEntry.group_code) : [], [groupEntries, selectedEntry]);
  const currentGroupIds = useMemo(() => new Set(currentGroupEntries.map((entry) => entry.id)), [currentGroupEntries]);
  const standings = useMemo(() => buildStandings(currentGroupEntries, selectedTournamentMatches.filter((match) => match.stage === 'group' && currentGroupIds.has(match.home_entry_id) && currentGroupIds.has(match.away_entry_id))), [currentGroupEntries, selectedTournamentMatches, currentGroupIds]);
  const myPosition = selectedEntry ? standings.findIndex((row) => row.id === selectedEntry.id) + 1 : 0;
  const selectedClaimClub = useMemo(() => worldClubs.find((club) => club.club_name === claimForm.clubName) || null, [worldClubs, claimForm.clubName]);
  const organiserAssignments = useMemo(() => adminAssignments.filter((row) => row.role === 'organiser'), [adminAssignments]);

  async function loadIdentityDirectory() {
    const { data, error } = await supabase.from('game_worlds').select('id, name, slug').in('slug', ['top-100', 'regen']).order('id');
    if (!error) setGameWorlds(data || []);
  }

  async function loadWorldClubs(gameWorldId) {
    if (!gameWorldId || !supabase) { setWorldClubs([]); return; }
    const { data, error } = await supabase.from('game_world_clubs').select('id, club_name, current_manager_name').eq('game_world_id', Number(gameWorldId)).eq('active', true).eq('occupied', true).order('club_name');
    if (error) setWorldClubs([]); else setWorldClubs(data || []);
  }

  async function sendMagicLink(event) {
    event?.preventDefault();
    const now = Date.now();
    if (now < magicLinkCooldownUntil.current) {
      setMagicLinkResendIn(Math.max(1, Math.ceil((magicLinkCooldownUntil.current - now) / 1000)));
      return;
    }

    const address = email.trim();
    if (!address) return;

    const requestId = ++magicLinkRequestId.current;
    magicLinkCooldownUntil.current = now + 60000;
    setMagicLinkStatus('sending');
    setMagicLinkSentTo(address);
    setMagicLinkResendIn(60);
    setMessage('');

    try {
      const { error } = await withPortalTimeout(
        supabase.auth.signInWithOtp({
          email: address,
          options: { emailRedirectTo: `${window.location.origin}${registrationMode ? '/manager/registration' : '/manager'}`, shouldCreateUser: true },
        }),
        'Sign-in link request',
        12000,
      );
      if (requestId !== magicLinkRequestId.current) return;
      if (error) throw error;
      setMagicLinkStatus('sent');
    } catch (error) {
      if (requestId !== magicLinkRequestId.current) return;
      magicLinkCooldownUntil.current = 0;
      setMagicLinkResendIn(0);
      setMagicLinkStatus('error');
      setMessage(error?.message || 'We could not send the sign-in link. Please try again.');
    }
  }

  function resetMagicLink() {
    magicLinkCooldownUntil.current = 0;
    setMagicLinkResendIn(0);
    setMagicLinkStatus('idle');
    setMagicLinkSentTo('');
    setMessage('');
  }

  async function submitClaim(event) {
    event.preventDefault();
    const managerName = claimForm.managerName.trim(), clubName = claimForm.clubName.trim(), gameWorldId = Number(claimForm.gameWorldId);
    if (!gameWorldId || !managerName || !clubName) return setMessage('Choose your game world and club, then enter your SM manager name.');
    if (selectedClaimClub?.current_manager_name && normalise(selectedClaimClub.current_manager_name) !== normalise(managerName)) return setMessage(`${selectedClaimClub.club_name} is currently listed as managed by ${selectedClaimClub.current_manager_name}. Check your manager name before submitting.`);
    setLoading(true); setMessage('Checking the manager directory...');
    const { data: candidateRows, error: candidateError } = await supabase.from('tournament_entries').select('manager_id, managers(id, name, display_name), teams(name), tournaments!inner(game_world_id)').eq('tournaments.game_world_id', gameWorldId);
    if (candidateError) { setLoading(false); return setMessage('Could not check manager records: ' + candidateError.message); }
    const candidateMatches = (candidateRows || []).filter((row) => normalise(row.managers?.display_name || row.managers?.name) === normalise(managerName) && normalise(row.teams?.name) === normalise(clubName));
    const managerIds = [...new Set(candidateMatches.map((row) => row.manager_id).filter(Boolean))];
    const payload = { auth_user_id: session.user.id, email: session.user.email, game_world_id: gameWorldId, claimed_manager_name: managerName, claimed_club_name: clubName, suggested_manager_id: managerIds.length === 1 ? managerIds[0] : null, status: 'pending', review_notes: null, reviewed_by: null, reviewed_at: null, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from('manager_portal_claims').upsert(payload, { onConflict: 'auth_user_id' }).select('*, game_worlds(name)').single();
    if (error) setMessage('Could not submit your claim: ' + error.message); else { setClaim(data); setMessage('Your claim is waiting for administrator approval.'); }
    setLoading(false);
  }

  async function loadPortal() {
    setLoading(true);
    setLoadError('');
    setMessage('Loading your Manager Portal...');
    try {
      const { data: accountRow, error: accountError } = await withPortalTimeout(
        supabase.from('manager_portal_accounts').select('id, manager_id, game_world_id, email, active, managers(id, name, display_name), game_worlds(id, name, slug)').eq('auth_user_id', session.user.id).eq('active', true).maybeSingle(),
        'Manager account lookup',
      );
      if (accountError) throw new Error(accountError.message);
      if (!accountRow) {
        const { data: claimRow, error: claimError } = await withPortalTimeout(
          supabase.from('manager_portal_claims').select('*, game_worlds(name)').eq('auth_user_id', session.user.id).maybeSingle(),
          'Manager claim lookup',
        );
        if (claimError) throw new Error(claimError.message);
        setAccount(null);
        setClaim(claimRow || null);
        setAdminAssignments([]);
        setMessage(claimRow?.status === 'pending' ? 'Your manager profile claim is awaiting approval.' : claimRow?.status === 'rejected' ? claimRow.review_notes || 'Your claim was not approved. You may correct it and submit again.' : 'Choose your game world and claim your manager profile to continue.');
        return;
      }

      if (registrationMode) {
        const [registrationResult, registrationsResult] = await withPortalTimeout(Promise.all([
          supabase.from('tournaments')
            .select('id, name, public_slug, registration_status, season_number, game_worlds(id, name, slug), competition_types(id, name, slug)')
            .eq('is_public', true)
            .eq('registration_status', 'open')
            .order('season_number', { ascending: false }),
          supabase.from('tournament_registrations')
            .select('id, tournament_id, club_name, rating, status, submitted_at, reviewed_at, review_notes, promoted_entry_id, promoted_at, tournaments(name, season_number)')
            .eq('auth_user_id', session.user.id)
            .order('submitted_at', { ascending: false }),
        ]), 'Registration records lookup');
        if (registrationResult.error) throw new Error('Could not load open tournament registrations: ' + registrationResult.error.message);
        if (registrationsResult.error) throw new Error('Could not load your registration records: ' + registrationsResult.error.message);

        setAccount(accountRow);
        setClaim(null);
        setEntries([]);
        setMatches([]);
        setGroupEntries([]);
        setAdminAssignments([]);
        setOpenTournaments(registrationResult.data || []);
        setRegistrations(registrationsResult.data || []);
        setSelectedEntryId('');
        setMessage('Registration options loaded.');
        return;
      }

      const [entryResult, accessResult] = await withPortalTimeout(Promise.all([
        supabase.from('tournament_entries').select('id, tournament_id, manager_id, group_code, seed, pot, teams(id, name), tournaments!inner(id, name, status, season_number, public_slug, is_public, game_world_id)').eq('manager_id', accountRow.manager_id).eq('tournaments.game_world_id', accountRow.game_world_id),
        supabase.from('tournament_organisers').select('tournament_id, role, tournaments(id, name)').eq('auth_user_id', session.user.id).eq('active', true),
      ]), 'Tournament access lookup');
      if (entryResult.error) throw new Error('Could not load your tournament entries: ' + entryResult.error.message);

      const entryRows = entryResult.data || [];
      const orderedEntries = [...entryRows].sort((a, b) => Number(b.tournaments?.season_number || 0) - Number(a.tournaments?.season_number || 0));
      const tournamentIds = [...new Set(orderedEntries.map((entry) => entry.tournament_id))];
      let matchRows = [], peerEntries = [];
      if (tournamentIds.length) {
        const [matchResult, peerResult] = await withPortalTimeout(Promise.all([
          supabase.from('matches').select('id, tournament_id, group_id, stage, round, leg, match_order, status, fixture_date, played_at, home_entry_id, away_entry_id, home_placeholder, away_placeholder, home_score, away_score, bracket, home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(name))').in('tournament_id', tournamentIds),
          supabase.from('tournament_entries').select('id, tournament_id, group_code, teams(name)').in('tournament_id', tournamentIds),
        ]), 'Tournament fixtures lookup');
        if (matchResult.error) throw new Error('Could not load your fixtures: ' + matchResult.error.message);
        if (peerResult.error) throw new Error('Could not load your group table: ' + peerResult.error.message);
        matchRows = matchResult.data || [];
        peerEntries = peerResult.data || [];
      }

      setAccount(accountRow);
      setClaim(null);
      setEntries(orderedEntries);
      setSelectedEntryId((current) => current || orderedEntries[0]?.id || '');
      setMatches(matchRows);
      setGroupEntries(peerEntries);
      setAdminAssignments(accessResult.error ? [] : (accessResult.data || []));
      setOpenTournaments([]);
      setRegistrations([]);
      setMessage('Portal loaded.');
    } catch (error) {
      setLoadError(error?.message || 'We could not finish loading your Manager Portal.');
      setMessage('');
    } finally {
      setLoading(false);
    }
  }

  async function withdrawRegistration(row) {
    if (!window.confirm(`Withdraw your registration for ${row.tournaments?.name || 'this tournament'}?`)) return;
    setLoading(true);
    setLoadError('');
    setMessage('Withdrawing registration...');
    try {
      const { error } = await withPortalTimeout(
        supabase.rpc('withdraw_manager_tournament_registration', { target_registration_id: row.id }),
        'Registration withdrawal',
      );
      if (error) throw error;
      await loadPortal();
      setMessage('Registration withdrawn.');
    } catch (error) {
      setLoadError(error?.message || 'Could not withdraw registration.');
      setMessage('');
    } finally {
      setLoading(false);
    }
  }

  async function logout() { await supabase.auth.signOut(); setMessage('Signed out.'); }
  function opponent(match) {
    const isHome = match.home_entry_id === selectedEntry?.id;
    return isHome ? entryTeamName(match.away_entry, match.away_placeholder) : entryTeamName(match.home_entry, match.home_placeholder);
  }
  function venue(match) { return match.home_entry_id === selectedEntry?.id ? 'Home' : 'Away'; }

  if (!hasSupabaseConfig || !supabase) return <main className="manager-portal-shell"><section className="warning-card"><strong>Manager Portal unavailable.</strong><span>Supabase is not connected.</span></section></main>;
  if (!session) return <main className="manager-portal-shell"><section className="manager-portal-hero"><p className="eyebrow">Top 100 Tournament Manager</p><h1>Manager Portal</h1><p>Your fixtures, results, group table and tournament progress in one place.</p></section><section className="card manager-login-card"><h2>Sign in securely</h2><p className="muted">Enter your email address. We’ll send a one-time sign-in link.</p>{magicLinkStatus === 'sent' ? <div className="magic-link-confirmation" role="status" aria-live="polite"><h3>✓ Sign-in link sent</h3><p>We’ve sent a secure sign-in link to <strong>{magicLinkSentTo}</strong>.</p><p className="muted">It can take a few minutes to arrive. Check your inbox and spam folder. You can leave this page open while you wait.</p><div className="button-row"><button type="button" onClick={sendMagicLink} disabled={magicLinkResendIn > 0}>{magicLinkResendIn > 0 ? `Send another link in ${magicLinkResendIn}s` : 'Send another link'}</button><button type="button" className="secondary" onClick={resetMagicLink}>Use a different email</button></div></div> : <form onSubmit={sendMagicLink}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={magicLinkStatus === 'sending'} /></label><button type="submit" disabled={magicLinkStatus === 'sending'}>{magicLinkStatus === 'sending' ? 'Sending…' : magicLinkStatus === 'error' ? 'Try again' : 'Email me a sign-in link'}</button>{magicLinkStatus === 'sending' && <p className="status" role="status" aria-live="polite">Sending your secure sign-in link…</p>}{magicLinkStatus === 'error' && message && <p className="status" role="alert">{message}</p>}{magicLinkStatus === 'idle' && message && <p className="status" role="alert">{message}</p>}</form>}</section></main>;
  if (loading) return <main className="manager-portal-shell"><section className="card"><h1>Loading Manager Portal...</h1><p className="muted">This should only take a few seconds.</p></section></main>;
  if (loadError) return <main className="manager-portal-shell"><section className="manager-portal-hero"><div><p className="eyebrow">Manager Portal</p><h1>We couldn’t finish loading your portal</h1><p>Your sign-in is still valid. The data request may have timed out or been interrupted.</p></div></section><section className="card manager-login-card"><p className="status">{loadError}</p><div className="button-row"><button type="button" onClick={loadPortal}>Try again</button><button type="button" className="secondary" onClick={logout}>Sign out</button></div></section></main>;
  if (!account) return <main className="manager-portal-shell"><section className="manager-portal-hero"><div><p className="eyebrow">Manager Portal</p><h1>{claim?.status === 'pending' ? 'Claim awaiting approval' : 'Claim your profile'}</h1><p>Signed in securely as {session.user.email}</p></div><button type="button" className="secondary" onClick={logout}>Sign out</button></section><section className="card manager-login-card">{claim?.status === 'pending' ? <><h2>We’ve got your claim</h2><p><strong>{claim.claimed_manager_name}</strong> · {claim.claimed_club_name} · {claim.game_worlds?.name || 'Game world'}</p><button type="button" onClick={loadPortal}>Check approval</button></> : <form onSubmit={submitClaim}><h2>Match your Soccer Manager identity</h2><label>Game world<select value={claimForm.gameWorldId} onChange={(event) => setClaimForm({ gameWorldId: event.target.value, managerName: '', clubName: '' })} required><option value="">Choose game world</option>{gameWorlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}</select></label><label>Current club<select value={claimForm.clubName} onChange={(event) => { const club = worldClubs.find((item) => item.club_name === event.target.value); setClaimForm((current) => ({ ...current, clubName: event.target.value, managerName: club?.current_manager_name || '' })); }} required disabled={!claimForm.gameWorldId}><option value="">Choose your club</option>{worldClubs.map((club) => <option key={club.id} value={club.club_name}>{club.club_name}</option>)}</select></label><label>SM manager name<input value={claimForm.managerName} onChange={(event) => setClaimForm((current) => ({ ...current, managerName: event.target.value }))} required /></label>{selectedClaimClub?.current_manager_name && <p className="muted">Directory manager: <strong>{selectedClaimClub.current_manager_name}</strong></p>}<button type="submit">Submit manager claim</button></form>}</section>{message && <section className="card"><p className="status">{message}</p></section>}</main>;

  if (registrationMode) {
    return <main className="manager-portal-shell">
      <section className="manager-portal-hero"><div><p className="eyebrow">Team registration · {account.game_worlds?.name || 'Top 100'}</p><h1>{account.managers?.display_name || account.managers?.name || 'Top 100 Manager'}</h1><p>Choose an open tournament below. Registration uses the normal tournament form and stays linked to your signed-in Manager Portal account.</p></div><div className="button-row"><a className="button secondary" href="/manager">Back to My Matches</a><button type="button" className="secondary" onClick={logout}>Sign out</button></div></section>
      <section className="card"><div className="card-header"><p className="eyebrow">Open now</p><h2>Register for a tournament</h2></div>{openTournaments.length ? <div className="entrant-list">{openTournaments.map((tournament) => <article className="entrant-row registration-row" key={tournament.id}><div className="registration-details"><strong>{tournament.name}</strong><span>{tournament.game_worlds?.name || 'Top 100'} · {tournament.competition_types?.name || 'Tournament'}</span></div><a className="button" href={registrationPath(tournament)}>Register</a></article>)}</div> : <p className="muted">There are no open public tournaments right now.</p>}</section>
      <section className="card"><div className="card-header"><p className="eyebrow">Your record</p><h2>Registrations</h2></div>{registrations.length ? <div className="entrant-list">{registrations.map((row) => <article className="entrant-row registration-row" key={row.id}><div className="registration-details"><strong>{registrationStatusLabel(row)} · {row.tournaments?.name || `Tournament #${row.tournament_id}`}</strong><span>{row.club_name} · rating {row.rating} · submitted {registrationDate(row.submitted_at)}</span>{row.reviewed_at && <span>Reviewed {registrationDate(row.reviewed_at)}</span>}{row.review_notes && <span>{row.review_notes}</span>}</div>{row.status === 'pending' && <button type="button" className="secondary" onClick={() => withdrawRegistration(row)}>Withdraw</button>}</article>)}</div> : <p className="muted">You have no linked tournament registrations yet.</p>}</section>
    </main>;
  }

  return <main className="manager-portal-shell"><section className="manager-portal-hero"><div><p className="eyebrow">Manager Portal · {account.game_worlds?.name || 'Top 100'}</p><h1>{account.managers?.display_name || account.managers?.name || 'Top 100 Manager'}</h1><p>{selectedEntry ? `${selectedEntry.teams?.name} · ${selectedEntry.tournaments?.name}` : 'No active tournament entry found'}</p></div><div className="button-row">{organiserAssignments.length > 0 && <a className="button" href="/admin">{adminAssignments.length === 1 && organiserAssignments.length === 1 ? `Manage ${organiserAssignments[0].tournaments?.name || 'tournament'}` : 'Manage tournaments'}</a>}<a className="button secondary" href="/manager/registration">Register a team</a><button type="button" className="secondary" onClick={logout}>Sign out</button></div></section>
    {entries.length > 1 && <section className="card portal-selector"><label>Tournament entry<select value={selectedEntry?.id || ''} onChange={(event) => setSelectedEntryId(event.target.value)}>{entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.tournaments?.name} — {entry.teams?.name}</option>)}</select></label></section>}
    {!selectedEntry ? <section className="card"><h2>Account linked successfully</h2><p>Your fixtures will appear here when you enter a competition.</p><a className="button" href="/manager/registration">Register for a tournament</a></section> : <>
      <section className="portal-metrics"><article><span>Team</span><strong>{selectedEntry.teams?.name}</strong></article><article><span>Group</span><strong>{selectedEntry.group_code ? `Group ${selectedEntry.group_code}` : 'TBC'}</strong></article><article><span>Position</span><strong>{ordinal(myPosition)}</strong></article><article><span>Record</span><strong>{results.length} played</strong></article></section>
      <ManagerResultCentre selectedEntry={selectedEntry} fixtures={upcoming} onResultChanged={loadPortal} />
      <section className="portal-grid"><article className="card portal-panel"><div className="card-header"><p className="eyebrow">Up next</p><h2>Your fixtures</h2></div>{upcoming.length ? <div className="portal-fixtures">{upcoming.map((match) => <div className="portal-fixture" key={match.id}><div><strong>{venue(match)} vs {opponent(match)}</strong><span>{match.round} · {match.bracket || match.stage}</span></div><time>{matchDate(match)}</time></div>)}</div> : <p className="muted">No outstanding fixtures.</p>}</article><article className="card portal-panel"><div className="card-header"><p className="eyebrow">Recent</p><h2>Your results</h2></div>{results.length ? <div className="portal-fixtures">{results.map((match) => { const home = match.home_entry_id === selectedEntry.id, mine = home ? match.home_score : match.away_score, theirs = home ? match.away_score : match.home_score, doubleForfeit = match.status === 'forfeit' && Number(match.home_score) === 0 && Number(match.away_score) === 0, outcome = doubleForfeit ? 'L' : mine > theirs ? 'W' : mine < theirs ? 'L' : 'D'; return <div className="portal-fixture" key={match.id}><div><strong><span className={`portal-outcome ${outcome}`}>{outcome}</span> {venue(match)} vs {opponent(match)}</strong><span>{match.round} · {matchDate(match)}{doubleForfeit ? ' · double forfeit' : ''}</span></div><b>{mine}–{theirs}</b></div>; })}</div> : <p className="muted">No results entered yet.</p>}</article></section>
      {selectedEntry.group_code && <section className="card portal-panel"><div className="card-header"><p className="eyebrow">Live standings</p><h2>Group {selectedEntry.group_code}</h2></div><div className="table-wrap"><table className="portal-table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>{standings.map((row, index) => <tr key={row.id} className={row.id === selectedEntry.id ? 'my-team' : ''}><td>{index + 1}</td><td><strong>{row.team}</strong></td><td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td><td>{row.gd}</td><td><strong>{row.points}</strong></td></tr>)}</tbody></table></div></section>}
    </>}
  </main>;
}
