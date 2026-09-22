import { useEffect, useRef, useState } from 'react';
import { hasSupabaseConfig, supabase, supabaseAnonKey, supabaseUrl } from '../lib/supabaseClient';

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

function registrationPath(tournament) {
  return `/${tournament.game_worlds?.slug}/${tournament.competition_types?.slug}/${tournament.public_slug}/register`;
}

const REGISTRATION_LOAD_TIMEOUT_MS = 8000;

function withRegistrationTimeout(promise, label = 'Registration request', ms = REGISTRATION_LOAD_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} timed out. Please try again.`)), ms);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

function persistedSession() {
  try {
    const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
    const raw = window.localStorage.getItem(`sb-${projectRef}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.access_token && parsed?.user?.id ? parsed : null;
  } catch {
    return null;
  }
}

async function restGet(path, token, label) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REGISTRATION_LOAD_TIMEOUT_MS);
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body?.message || `${label} failed with HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`${label} timed out. Please try again.`);
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function ManagerRegistrationPortal() {
  const [session, setSession] = useState(null);
  const [account, setAccount] = useState(null);
  const [tournaments, setTournaments] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [message, setMessage] = useState('');
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(true);
  const loadRequestId = useRef(0);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setLoading(false); return; }

    // This page deliberately bypasses Supabase auth.getSession()/auth listeners.
    // On some mobile browsers that path can deadlock on the auth Web Lock before
    // any of our Promise timeouts can resolve. The persisted session is the same
    // browser session the main Manager Portal already established.
    const storedSession = persistedSession();
    if (storedSession) {
      setSession(storedSession);
      return;
    }

    setLoadError('No active Manager Portal session was found. Open My Matches and sign in again.');
    setLoading(false);
  }, []);

  useEffect(() => {
    if (session?.user) load();
    else { setAccount(null); setRegistrations([]); setTournaments([]); setLoading(false); }
  }, [session?.user?.id]);

  useEffect(() => {
    if (!loading || !session?.user || account || loadError) return undefined;

    const watchdog = window.setTimeout(() => {
      loadRequestId.current += 1;
      setMessage('');
      setLoadError('The registration portal is taking too long to load. Please try again.');
      setLoading(false);
    }, 10000);

    return () => window.clearTimeout(watchdog);
  }, [loading, session?.user?.id, account, loadError]);

  async function load() {
    if (!session?.user?.id || !session?.access_token) return;
    const requestId = ++loadRequestId.current;
    setLoading(true);
    setLoadError('');
    setMessage('Loading registration records...');

    try {
      const uid = encodeURIComponent(session.user.id);
      const accountRows = await restGet(
        `manager_portal_accounts?select=id,manager_id,game_world_id,email,active,managers(id,name,display_name),game_worlds(id,name,slug)&auth_user_id=eq.${uid}&active=eq.true&limit=1`,
        session.access_token,
        'Manager Portal account request',
      );
      if (requestId !== loadRequestId.current) return;

      const accountRow = accountRows?.[0] || null;
      setAccount(accountRow);
      if (!accountRow) {
        setMessage('Your Manager Portal profile must be approved before linked registrations appear here.');
        setLoading(false);
        return;
      }

      const [tournamentRows, registrationRows] = await Promise.all([
        restGet(
          'tournaments?select=id,name,public_slug,registration_status,registration_opens_at,registration_closes_at,game_world_id,game_worlds(id,name,slug),competition_types(id,name,slug)&is_public=eq.true&registration_status=eq.open&order=season_number.desc',
          session.access_token,
          'Open tournaments request',
        ),
        restGet(
          `tournament_registrations?select=id,tournament_id,club_name,rating,status,submitted_at,reviewed_at,review_notes,promoted_entry_id,promoted_at,tournaments(name,season_number)&auth_user_id=eq.${uid}&order=submitted_at.desc`,
          session.access_token,
          'Registration record request',
        ),
      ]);

      if (requestId !== loadRequestId.current) return;
      setTournaments(tournamentRows || []);
      setRegistrations(registrationRows || []);
      setMessage('Your registration record is up to date.');
      setLoading(false);
    } catch (error) {
      if (requestId !== loadRequestId.current) return;
      setMessage('');
      const text = String(error?.message || '');
      setLoadError(/401|JWT|token|expired/i.test(text)
        ? 'Your Manager Portal session has expired. Return to My Matches and sign in again.'
        : (text || 'We could not finish loading registration data.'));
      setLoading(false);
    }
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
  if (loadError && !session) return <main className="manager-portal-shell"><section className="manager-portal-hero"><div><p className="eyebrow">Team registration</p><h1>We couldn’t check your sign-in</h1><p>The authentication request timed out or was interrupted.</p></div></section><section className="card manager-login-card"><p className="status">{loadError}</p><div className="button-row"><button type="button" onClick={() => window.location.reload()}>Try again</button><a className="button secondary" href="/manager">Manager Portal</a></div></section></main>;
  if (!session) return <main className="manager-portal-shell"><section className="manager-portal-hero"><p className="eyebrow">Top 100 Tournament Manager</p><h1>Team registration</h1><p>You can register without an account from any public tournament page. Sign in here if you want registrations linked to your Manager Portal.</p></section><section className="card manager-login-card"><a className="button" href="/manager">Open Manager Portal</a></section></main>;
  if (loading && !account) return <main className="manager-portal-shell"><section className="card"><h1>Loading registration portal...</h1><p className="muted">This should only take a few seconds.</p></section></main>;
  if (loadError && !account) return <main className="manager-portal-shell"><section className="manager-portal-hero"><div><p className="eyebrow">Team registration</p><h1>We couldn’t finish loading registration</h1><p>Your sign-in is still valid. The request may have timed out or been interrupted.</p></div></section><section className="card manager-login-card"><p className="status">{loadError}</p><div className="button-row"><button type="button" onClick={load}>Try again</button><a className="button secondary" href="/manager">Manager Portal</a></div></section></main>;
  if (!account) return <main className="manager-portal-shell"><section className="manager-portal-hero"><div><p className="eyebrow">Team registration</p><h1>Manager profile required</h1><p>Signed in as {session.user.email}</p></div><button type="button" className="secondary" onClick={logout}>Sign out</button></section><section className="card"><p>Your manager claim must be approved before new registrations can be linked to this Portal account.</p><a className="button" href="/manager">Open Manager Portal</a></section></main>;

  return <main className="manager-portal-shell">
    <section className="manager-portal-hero"><div><p className="eyebrow">Team registration · all Top 100 game worlds</p><h1>{account.managers?.display_name || account.managers?.name}</h1><p>Your original Portal claim identifies you as a manager. Open registrations from any supported game world are shown below; a registration is linked to your Portal only when that world’s club directory confirms the same manager identity.</p></div><div className="button-row"><a className="button secondary" href="/manager">Manager Portal</a><button type="button" className="secondary" onClick={logout}>Sign out</button></div></section>

    <section className="card"><div className="card-header"><p className="eyebrow">Your record</p><h2>Registrations</h2></div><p><strong>If a registration appears here as submitted or approved, we have it.</strong></p>{loadError ? <div className="warning-card"><strong>We could not verify your registration record.</strong><span>{loadError}</span><p className="muted">Do not submit a duplicate registration until this record has loaded successfully.</p><button type="button" className="secondary" onClick={load}>Try again</button></div> : loading ? <p className="muted">Checking your registration record...</p> : !registrations.length ? <p className="muted">You have no linked tournament registrations yet.</p> : <div className="entrant-list">{registrations.map((row) => <article className="entrant-row registration-row" key={row.id}><div className="registration-details"><strong>{statusLabel(row)} · {row.tournaments?.name || `Tournament #${row.tournament_id}`}</strong><span>{row.club_name} · rating {row.rating} · submitted {formatDate(row.submitted_at)} · reference #{row.id}</span>{row.reviewed_at && <span>Reviewed {formatDate(row.reviewed_at)}</span>}{row.review_notes && <span>{row.review_notes}</span>}</div>{row.status === 'pending' && <button type="button" className="secondary" onClick={() => withdraw(row)} disabled={loading}>Withdraw</button>}</article>)}</div>}</section>

    <section className="card"><div className="card-header"><p className="eyebrow">Open now</p><h2>Register for a tournament</h2></div>{loadError && <div className="warning-card"><strong>Registration data could not finish loading.</strong><span>{loadError}</span><button type="button" className="secondary" onClick={load}>Try again</button></div>}{loading && !loadError ? <p className="muted">Checking open tournaments...</p> : !tournaments.length && !loadError ? <p className="muted">There are no open public tournaments right now.</p> : <div className="entrant-list">{tournaments.map((tournament) => <article className="entrant-row registration-row" key={tournament.id}><div className="registration-details"><strong>{tournament.name}</strong><span>{tournament.game_worlds?.name} · no email required · canonical club directory · average rating 65–95 required</span></div><a className="button" href={registrationPath(tournament)}>Register</a></article>)}</div>}{message && <p className="status">{message}</p>}</section>
  </main>;
}
