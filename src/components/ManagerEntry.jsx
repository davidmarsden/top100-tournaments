import { useCallback, useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import ManagerPortal from './ManagerPortal.jsx';
import ManagerResourceHub from './ManagerResourceHub.jsx';
import ManagerReminderPreferences from './ManagerReminderPreferences.jsx';
import Top100AppGuide from './Top100AppGuide.jsx';
import Top100AppHome from './Top100AppHome.jsx';
import Top100InstallPrompt from './Top100InstallPrompt.jsx';
import Top100Notifications from './Top100Notifications.jsx';

const REQUEST_TIMEOUT_MS = 10000;
// Single sign-on: if the user is already signed in on another Top 100 site (e.g. an admin in the
// Control Room; it is the same Supabase user), get a one-time handoff code from that site's tiny
// /auth/sso-bridge.html page and exchange it for a NEW, independent session here. Session tokens
// are never copied between sites, so neither site can invalidate the other when it renews.
const SSO_BRIDGE_ORIGINS = ['https://admin.smtop100.blog', 'https://tournaments.smtop100.blog'];
const SSO_BRIDGE_TIMEOUT_MS = 8000;
const SSO_STEP_TIMEOUT_MS = 8000;
const HANDOFF_EXCHANGE_URL = 'https://xxntutejknolhmbssqdf.supabase.co/functions/v1/exchange-manager-handoff';
// Which other-site session our current session was imported from, and, after an explicit sign-out
// here, which source session must not be imported again. A new sign-in elsewhere is a new session.
const SSO_SOURCE_KEY = 'top100-manager-sso-source-session';
const SIGNED_OUT_SESSION_KEY = 'top100-manager-signed-out-session';
const GAME_WORLD_KEY = 'top100-manager-game-world';

function readKey(key) { try { return window.localStorage.getItem(key); } catch { return null; } }
function writeKey(key, value) {
  try { if (value) window.localStorage.setItem(key, value); else window.localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

function isReturningFromEmailLink() {
  const { hash, search } = window.location;
  return /access_token=|error_description=/.test(hash) || /[?&](code|token_hash|error_description)=/.test(search);
}

// Ask one site's bridge for a handoff code. Resolves to { code, sourceSessionId } or null.
function requestHandoffCode(origin, suppressSessionId) {
  return new Promise((resolve) => {
    const frame = document.createElement('iframe');
    const nonce = Math.random().toString(36).slice(2);
    let timer;
    const finish = (value) => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      frame.remove();
      resolve(value);
    };
    const onMessage = (event) => {
      if (event.origin !== origin || event.source !== frame.contentWindow) return;
      if (event.data?.type === 'top100-sso-ready') {
        frame.contentWindow.postMessage({ type: 'top100-sso-request', nonce, suppressSessionId }, origin);
        return;
      }
      if (event.data?.type !== 'top100-sso-response' || event.data.nonce !== nonce) return;
      finish(event.data.status === 'ok' && event.data.code ? { code: event.data.code, sourceSessionId: event.data.sourceSessionId || null } : null);
    };
    window.addEventListener('message', onMessage);
    frame.src = `${origin}/auth/sso-bridge.html`;
    frame.title = 'Checking Top 100 sign-in';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.display = 'none';
    frame.addEventListener('error', () => finish(null), { once: true });
    timer = window.setTimeout(() => finish(null), SSO_BRIDGE_TIMEOUT_MS);
    document.body.appendChild(frame);
  });
}

export async function signInFromOtherTop100Sites() {
  if (window.location.hostname !== 'manager.smtop100.blog') return null;
  if (isReturningFromEmailLink()) return null;
  const suppressSessionId = readKey(SIGNED_OUT_SESSION_KEY);
  for (const origin of SSO_BRIDGE_ORIGINS) {
    const handoff = await requestHandoffCode(origin, suppressSessionId);
    if (!handoff) continue;
    // Every network step is bounded: a stalled backend must fall back to the email form, never
    // leave the page on "Checking your sign-in…".
    let data;
    try {
      const controller = new AbortController();
      const abortTimer = window.setTimeout(() => controller.abort(), SSO_STEP_TIMEOUT_MS);
      let payload;
      try {
        const response = await fetch(HANDOFF_EXCHANGE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: handoff.code }),
          signal: controller.signal,
        });
        payload = response.ok ? await response.json() : null;
      } finally {
        window.clearTimeout(abortTimer);
      }
      if (!payload?.token_hash) continue;
      const result = await timeout(supabase.auth.verifyOtp({ token_hash: payload.token_hash, type: 'email' }), 'Sign-in handoff');
      if (result.error || !result.data?.session) continue;
      data = result.data;
    } catch {
      continue;
    }
    writeKey(SSO_SOURCE_KEY, handoff.sourceSessionId);
    writeKey(SIGNED_OUT_SESSION_KEY, null);
    return data.session;
  }
  return null;
}

function timeout(promise, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} timed out. Please try again.`)), REQUEST_TIMEOUT_MS);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

function safeReturnTo() {
  const value = new URLSearchParams(window.location.search).get('returnTo');
  try {
    const url = new URL(value || '');
    return url.origin === 'https://vote.smtop100.blog' && /^\/vote\/?$/.test(url.pathname)
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

// A Manager Portal page to open after signing in (?next=/appointments), so a manager sent here
// to sign in from one of those pages is taken back to it.
const NEXT_PATHS = new Set(['/appointments', '/squad']);
function safeNextPath() {
  const value = new URLSearchParams(window.location.search).get('next');
  return NEXT_PATHS.has(value) ? value : '';
}

function SignIn({ returnTo, registrationMode }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');
  const [code, setCode] = useState('');
  const [codeState, setCodeState] = useState({ state: 'idle', message: '' });

  // The emailed code signs in wherever it is typed. On iPhone the email link
  // opens Safari, which can't sign in the home-screen app (separate storage).
  async function verifyCode(event) {
    event.preventDefault();
    const token = code.replace(/\s+/g, '');
    if (!/^\d{6,10}$/.test(token) || codeState.state === 'checking') return;
    setCodeState({ state: 'checking', message: '' });
    try {
      const { error } = await timeout(supabase.auth.verifyOtp({ email: email.trim(), token, type: 'email' }), 'Sign-in code check');
      if (error) throw error;
      setCodeState({ state: 'done', message: 'Signed in ✓' });
    } catch (error) {
      setCodeState({ state: 'error', message: error?.message || 'That code did not work. Use the newest email you received.' });
    }
  }

  async function submit(event) {
    event.preventDefault();
    const address = email.trim();
    if (!address || state === 'sending') return;
    setState('sending');
    setMessage('');
    try {
      const path = registrationMode ? '/registrations' : '/';
      const params = new URLSearchParams();
      if (returnTo) params.set('returnTo', returnTo);
      if (safeNextPath()) params.set('next', safeNextPath());
      const suffix = params.toString() ? `?${params}` : '';
      const { error } = await timeout(
        supabase.auth.signInWithOtp({
          email: address,
          options: { emailRedirectTo: `${window.location.origin}${path}${suffix}`, shouldCreateUser: true },
        }),
        'Sign-in link request',
      );
      if (error) throw error;
      setState('sent');
      setMessage(`Sign-in link sent to ${address}. Use the newest email you receive.`);
    } catch (error) {
      setState('error');
      setMessage(error?.message || 'We could not send the sign-in link.');
    }
  }

  return <main className="manager-portal-shell"><section className="manager-portal-hero"><p className="eyebrow">Top 100</p><h1>Manager sign-in</h1><p>One account for Top 100 and Top 100 Regen.</p></section><section className="card manager-login-card"><h2>{state === 'sent' ? 'Check your email' : 'Sign in securely'}</h2>{state === 'sent' ? <><p className="status" role="status">{message}</p><p className="muted">The link can take a few minutes to arrive. Older links may stop working after you request a newer one.</p><form className="sign-in-code-form" onSubmit={verifyCode}><label>Or enter the code from the email<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,12}" maxLength={12} value={code} onChange={(event) => setCode(event.target.value)} required disabled={codeState.state === 'checking' || codeState.state === 'done'} /></label><p className="muted">Using Top 100 from your iPhone home screen? Enter the code here instead of tapping the link.</p><button type="submit" disabled={codeState.state === 'checking' || codeState.state === 'done'}>{codeState.state === 'checking' ? 'Checking…' : 'Sign in with code'}</button>{codeState.message && <p className="status" role={codeState.state === 'error' ? 'alert' : 'status'}>{codeState.message}</p>}</form><button type="button" className="secondary" onClick={() => { setState('idle'); setMessage(''); setCode(''); setCodeState({ state: 'idle', message: '' }); }}>Use a different email</button></> : <form onSubmit={submit}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={state === 'sending'} /></label><button type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}</button>{message && <p className="status" role="alert">{message}</p>}</form>}</section></main>;
}

function Setup({ session, claim: initialClaim, onClaimChanged }) {
  const [worlds, setWorlds] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [worldId, setWorldId] = useState('');
  const [clubName, setClubName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [claim, setClaim] = useState(initialClaim);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    timeout(supabase.from('game_worlds').select('id, name, slug').in('slug', ['top-100', 'regen']).order('id'), 'Game world lookup')
      .then(({ data, error }) => { if (!active) return; if (error) setMessage(error.message); else setWorlds(data || []); })
      .catch((error) => active && setMessage(error.message));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setClubs([]); setClubName('');
    if (!worldId) return undefined;
    let active = true;
    timeout(supabase.from('game_world_clubs').select('id, club_name, current_manager_name').eq('game_world_id', Number(worldId)).eq('active', true).eq('occupied', true).order('club_name'), 'Club lookup')
      .then(({ data, error }) => { if (!active) return; if (error) setMessage(error.message); else setClubs(data || []); })
      .catch((error) => active && setMessage(error.message));
    return () => { active = false; };
  }, [worldId]);

  const selectedClub = useMemo(() => clubs.find((row) => row.club_name === clubName) || null, [clubs, clubName]);

  async function submit(event) {
    event.preventDefault();
    if (!worldId || !clubName || !managerName.trim()) return;
    setBusy(true); setMessage('');
    try {
      const payload = { auth_user_id: session.user.id, email: session.user.email, game_world_id: Number(worldId), claimed_manager_name: managerName.trim(), claimed_club_name: clubName, suggested_manager_id: null, status: 'pending', review_notes: null, reviewed_by: null, reviewed_at: null, updated_at: new Date().toISOString() };
      const { data, error } = await timeout(supabase.from('manager_portal_claims').upsert(payload, { onConflict: 'auth_user_id' }).select('*, game_worlds(name)').single(), 'Manager link request');
      if (error) throw error;
      setClaim(data); setMessage('Your manager link request has been sent for approval.'); onClaimChanged?.(data);
    } catch (error) { setMessage(error?.message || 'Could not submit your manager link request.'); }
    finally { setBusy(false); }
  }

  if (claim?.status === 'pending') return <main className="manager-portal-shell"><section className="manager-portal-hero"><p className="eyebrow">Top 100 account</p><h1>Account link awaiting approval</h1><p>You are signed in as {session.user.email}. Your request to link {claim.claimed_manager_name} at {claim.claimed_club_name} has been received.</p></section><section className="card"><p>You do not need another account for Regen. Once approved, this manager identity is linked across every Top 100 game world where you are listed as the manager.</p><button type="button" className="secondary" onClick={() => supabase.auth.signOut()}>Sign out</button></section></main>;

  return <main className="manager-portal-shell"><section className="manager-portal-hero"><p className="eyebrow">Top 100 account</p><h1>Link your manager</h1><p>Sign-in complete ✓ · {session.user.email}</p></section><section className="card manager-login-card"><h2>One last step</h2><p className="muted">Choose either your Top 100 or Regen club to establish your identity. After approval, the same account automatically follows that manager across both worlds.</p><form onSubmit={submit}><label>Game world<select value={worldId} onChange={(event) => setWorldId(event.target.value)} required><option value="">Choose game world…</option>{worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}</select></label><label>Current club<select value={clubName} onChange={(event) => setClubName(event.target.value)} required disabled={!worldId}><option value="">Choose club…</option>{clubs.map((club) => <option key={club.id} value={club.club_name}>{club.club_name}</option>)}</select></label><label>Soccer Manager name<input value={managerName} onChange={(event) => setManagerName(event.target.value)} required /></label>{selectedClub?.current_manager_name && <p className="muted">Directory manager: {selectedClub.current_manager_name}</p>}<button type="submit" disabled={busy}>{busy ? 'Linking…' : 'Link my manager'}</button>{message && <p className="status" role="status">{message}</p>}</form></section></main>;
}

function ReturnHandoff({ session, returnTo }) {
  const [message, setMessage] = useState('Preparing secure handoff…');
  useEffect(() => {
    let active = true;
    (async () => { try { const target = new URL(returnTo); if (target.origin !== 'https://vote.smtop100.blog' || !/^\/vote\/?$/.test(target.pathname)) throw new Error('Invalid voting destination.'); const { data, error } = await supabase.rpc('create_manager_auth_handoff'); if (error) throw error; if (!active) return; target.search = ''; target.searchParams.set('handoff', data); window.location.replace(target.toString()); } catch (error) { if (active) setMessage(error?.message || 'Could not continue to Community Polls.'); } })();
    return () => { active = false; };
  }, [session?.user?.id, returnTo]);
  return <main className="manager-portal-shell"><section className="card"><h1>Sign-in complete ✓</h1><p>{message}</p></section></main>;
}

export default function ManagerEntry({ registrationMode = false }) {
  const returnTo = safeReturnTo();
  const nextPath = safeNextPath();
  const [session, setSession] = useState(undefined);
  const [identity, setIdentity] = useState({ state: 'idle', account: null, claim: null, error: '' });
  // The game world My Matches is showing: the one this account last picked in the switcher,
  // otherwise the world of the portal's first tournament entry (undefined until it reports).
  // The choice is kept per account, so another manager on the same browser starts afresh.
  const worldKey = session?.user?.id ? `${GAME_WORLD_KEY}:${session.user.id}` : null;
  const storedWorldId = useMemo(() => {
    const stored = worldKey ? Number(readKey(worldKey)) : NaN;
    return Number.isInteger(stored) && stored > 0 ? stored : undefined;
  }, [worldKey]);
  const [worldChoice, setWorldChoice] = useState({ key: null, id: undefined });
  const portalWorldId = worldChoice.key === worldKey && worldChoice.id !== undefined ? worldChoice.id : storedWorldId;
  const chooseWorld = (worldId) => { if (worldKey) writeKey(worldKey, worldId ? String(worldId) : null); setWorldChoice({ key: worldKey, id: worldId }); };
  const reportPortalWorld = useCallback((worldId) => setWorldChoice((current) => (
    (current.key === worldKey && current.id !== undefined) || storedWorldId ? current : { key: worldKey, id: worldId }
  )), [worldKey, storedWorldId]);
  useEffect(() => {
    if (portalWorldId !== undefined || identity.state !== 'linked') return undefined;
    // Fall back to the account's home world if the portal can't load its entries.
    const timer = window.setTimeout(() => reportPortalWorld(null), 6000);
    return () => window.clearTimeout(timer);
  }, [portalWorldId, identity.state, reportPortalWorld]);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setSession(null); return undefined; }
    let active = true;
    let importing = false;
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      if (event === 'SIGNED_OUT') {
        // Explicit sign-out: don't sign straight back in from the session we came from.
        writeKey(SIGNED_OUT_SESSION_KEY, readKey(SSO_SOURCE_KEY));
        writeKey(SSO_SOURCE_KEY, null);
      }
      if (event === 'SIGNED_IN' && !importing) {
        // Signed in here directly (email link): forget any earlier suppression.
        writeKey(SIGNED_OUT_SESSION_KEY, null);
        writeKey(SSO_SOURCE_KEY, null);
      }
      if (event === 'INITIAL_SESSION' && !nextSession) {
        // No session on this site yet: try the other Top 100 sites before showing the form.
        // Run outside the auth callback, where auth-js holds its lock.
        importing = true;
        window.setTimeout(async () => {
          let imported = null;
          try { imported = await signInFromOtherTop100Sites(); } catch { imported = null; }
          importing = false;
          if (active) setSession(imported || null);
        }, 0);
        return;
      }
      if (importing && !nextSession) return;
      setSession(nextSession || null);
      if (!nextSession) setIdentity({ state: 'idle', account: null, claim: null, error: '' });
    });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session?.user) return undefined;
    let active = true; setIdentity({ state: 'loading', account: null, claim: null, error: '' });
    (async () => {
      try {
        const accountResult = await timeout(supabase.from('manager_portal_accounts').select('id, manager_id, game_world_id, email, active').eq('auth_user_id', session.user.id).eq('active', true).maybeSingle(), 'Manager account lookup');
        if (accountResult.error) throw accountResult.error;
        if (!active) return;
        if (accountResult.data) { setIdentity({ state: 'linked', account: accountResult.data, claim: null, error: '' }); return; }
        const claimResult = await timeout(supabase.from('manager_portal_claims').select('*, game_worlds(name)').eq('auth_user_id', session.user.id).maybeSingle(), 'Manager link lookup');
        if (!active) return;
        setIdentity({ state: 'setup', account: null, claim: claimResult.error ? null : (claimResult.data || null), error: '' });
      } catch (error) { if (active) setIdentity({ state: 'error', account: null, claim: null, error: error?.message || 'Could not check your manager account.' }); }
    })();
    return () => { active = false; };
  }, [session?.user?.id]);

  if (!hasSupabaseConfig || !supabase) return <main className="manager-portal-shell"><section className="warning-card"><strong>Manager sign-in unavailable.</strong><span>Supabase is not connected.</span></section></main>;
  if (session === undefined) return <main className="manager-portal-shell"><section className="card"><h1>Manager sign-in</h1><p>Checking your sign-in…</p></section></main>;
  if (!session) return <><SignIn returnTo={returnTo} registrationMode={registrationMode} />{!registrationMode && <div className="top100-app-top"><Top100AppGuide /></div>}{!registrationMode && <ManagerResourceHub />}</>;
  if (identity.state === 'loading' || identity.state === 'idle') return <main className="manager-portal-shell"><section className="card"><h1>Manager sign-in</h1><p>Signed in ✓ · Checking your manager link…</p></section></main>;
  if (identity.state === 'error') return <main className="manager-portal-shell"><section className="card"><h1>We couldn't check your manager link</h1><p className="status">{identity.error}</p><button type="button" className="secondary" onClick={() => supabase.auth.signOut()}>Sign out</button></section></main>;
  if (identity.state === 'setup') return <Setup session={session} claim={identity.claim} onClaimChanged={(claim) => setIdentity({ state: 'setup', account: null, claim, error: '' })} />;
  if (identity.state === 'linked' && returnTo) return <ReturnHandoff session={session} returnTo={returnTo} />;
  if (identity.state === 'linked' && nextPath) { window.location.replace(nextPath); return <main className="manager-portal-shell"><section className="card"><h1>Manager sign-in</h1><p>Signed in ✓ · Opening…</p></section></main>; }
  if (registrationMode) return <ManagerPortal registrationMode returnTo={returnTo} session={session} />;
  return <>
    <div className="top100-app-top"><Top100InstallPrompt /><Top100AppHome session={session} gameWorldId={portalWorldId} onSelectWorld={chooseWorld} /><Top100AppGuide signedIn /></div>
    <ManagerPortal returnTo={returnTo} session={session} worldId={portalWorldId} onWorldChange={reportPortalWorld} />
    <div className="top100-app-bottom"><Top100Notifications session={session} /></div>
    <ManagerReminderPreferences session={session} authLoading={false} />
    <ManagerResourceHub />
  </>;
}
