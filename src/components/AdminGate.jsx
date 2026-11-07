import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const AdminAuthContext = createContext({ isGlobalAdmin: false, managedTournamentIds: [], organiserAssignments: [], userEmail: '', logout: async () => {} });
const configuredUsername = String(import.meta.env.VITE_ADMIN_USERNAME || 'admin').trim();
const configuredEmail = String(import.meta.env.VITE_ADMIN_LOGIN_EMAIL || import.meta.env.VITE_ADMIN_EMAIL || '').trim();
const MANAGER_ORIGIN = 'https://manager.smtop100.blog';
const SESSION_BRIDGE_TIMEOUT_MS = 15000;
const HANDOFF_EXCHANGE_URL = 'https://xxntutejknolhmbssqdf.supabase.co/functions/v1/exchange-manager-handoff';

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}

// requireOfficial: the Top 100 admin team (is_top100_official): officials and platform administrators.
export default function AdminGate({ children, requireGlobal = false, requireOfficial = false }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);
  const [isOfficial, setIsOfficial] = useState(false);
  const [organiserAssignments, setOrganiserAssignments] = useState([]);
  const [userEmail, setUserEmail] = useState('');
  const [accessError, setAccessError] = useState('');
  const [loginError, setLoginError] = useState('');
  const accessCheckGeneration = useRef(0);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setChecking(false); return undefined; }
    let mounted = true;
    let bridgeFrame;
    let bridgeTimeout;
    let handoffFailed = false;

    const cleanupBridge = () => {
      if (bridgeTimeout) {
        window.clearTimeout(bridgeTimeout);
        bridgeTimeout = undefined;
      }
      window.removeEventListener('message', handleBridgeMessage);
      if (bridgeFrame?.parentNode) bridgeFrame.parentNode.removeChild(bridgeFrame);
      bridgeFrame = undefined;
    };

    const finishWithoutSession = async () => {
      cleanupBridge();
      if (mounted) await checkAccess(null, false, handoffFailed);
    };

    const handleBridgeMessage = async (event) => {
      if (event.origin !== MANAGER_ORIGIN || event.data?.type !== 'top100-manager-session') return;

      const bridgeSession = event.data.session;
      if (!bridgeSession?.access_token || !bridgeSession?.refresh_token) {
        await finishWithoutSession();
        return;
      }

      const { data, error } = await supabase.auth.setSession(bridgeSession);
      cleanupBridge();
      if (!mounted) return;
      if (error) {
        setAccessError(`Could not import Manager Portal sign-in: ${error.message}`);
        await checkAccess(null, false, true);
        return;
      }
      await checkAccess(data.session?.user || null, false);
    };

    const tryManagerSessionBridge = () => {
      window.addEventListener('message', handleBridgeMessage);
      bridgeFrame = document.createElement('iframe');
      bridgeFrame.src = `${MANAGER_ORIGIN}/auth/session-bridge`;
      bridgeFrame.title = 'Manager Portal sign-in check';
      bridgeFrame.setAttribute('aria-hidden', 'true');
      bridgeFrame.style.display = 'none';
      document.body.appendChild(bridgeFrame);
      bridgeTimeout = window.setTimeout(finishWithoutSession, SESSION_BRIDGE_TIMEOUT_MS);
    };

    // The Manager Portal sends officials back with a one-time ?handoff= code. Exchange it for a
    // session here: the iframe bridge below cannot see the Manager Portal session in Safari.
    async function redeemHandoff() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('handoff');
      if (!code) return;
      params.delete('handoff');
      const query = params.toString();
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
      try {
        const response = await fetch(HANDOFF_EXCHANGE_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.token_hash) throw new Error(payload?.error || 'Sign-in handoff failed.');
        const { error } = await supabase.auth.verifyOtp({ token_hash: payload.token_hash, type: 'email' });
        if (error) throw error;
      } catch (error) {
        handoffFailed = true;
        if (mounted) setAccessError(`Could not bring your Manager Portal sign-in across: ${error.message}. Please try again.`);
      }
    }

    async function checkSession() {
      await redeemHandoff();
      if (!mounted) return;
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      if (data.session?.user) {
        await checkAccess(data.session.user, false);
        return;
      }
      const bypassManagerBridge = new URLSearchParams(window.location.search).get('platform') === '1';
      if (['tournaments.smtop100.blog', 'admin.smtop100.blog'].includes(window.location.hostname) && !bypassManagerBridge) {
        tryManagerSessionBridge();
        return;
      }
      await checkAccess(null, false, handoffFailed);
    }
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase may emit SIGNED_IN as well as TOKEN_REFRESHED when an already
      // authenticated tab regains focus. Treat every authenticated auth event as
      // a background permission refresh so the admin React tree stays mounted and
      // an in-progress result/FET form is not destroyed. Only a genuine sign-out
      // should collapse the admin tree.
      const background = Boolean(session?.user) && event !== 'SIGNED_OUT';
      checkAccess(session?.user || null, background);
    });
    checkSession();
    return () => {
      mounted = false;
      accessCheckGeneration.current += 1;
      cleanupBridge();
      listener.subscription.unsubscribe();
    };
  }, []);

  async function checkAccess(user, background = false, preserveAccessError = false) {
    const generation = ++accessCheckGeneration.current;
    if (!user) {
      setHasAccess(false); setIsGlobalAdmin(false); setIsOfficial(false); setOrganiserAssignments([]); setUserEmail('');
      if (!preserveAccessError) setAccessError('');
      setChecking(false); return;
    }
    if (!background) setChecking(true);
    const [adminResult, accessResult, assignmentsResult, officialResult] = await Promise.all([
      supabase.rpc('is_admin'),
      supabase.rpc('has_tournament_admin_access'),
      supabase.from('tournament_organisers').select('tournament_id, role, active').eq('auth_user_id', user.id).eq('active', true),
      requireOfficial ? supabase.rpc('is_top100_official') : Promise.resolve({ data: false, error: null }),
    ]);
    // Ignore older permission checks that complete after a newer session event.
    if (generation !== accessCheckGeneration.current) return;
    const global = Boolean(adminResult.data) && !adminResult.error;
    const assignments = assignmentsResult.error ? [] : assignmentsResult.data || [];
    setUserEmail(user.email || 'signed-in user');
    setIsGlobalAdmin(global);
    setIsOfficial(global || (Boolean(officialResult.data) && !officialResult.error));
    setOrganiserAssignments(assignments);
    setHasAccess((Boolean(accessResult.data) && !accessResult.error) || global || assignments.some((row) => row.active));
    const permissionError = adminResult.error || accessResult.error || assignmentsResult.error;
    setAccessError(permissionError ? 'Could not verify tournament permissions: ' + permissionError.message : '');
    setChecking(false);
  }

  async function login(event) {
    event.preventDefault();
    setLoginError('');
    const cleanUsername = username.trim();
    if (cleanUsername.toLowerCase() !== configuredUsername.toLowerCase()) { setLoginError('Incorrect username.'); return; }
    if (!configuredEmail) { setLoginError('Admin login email is not configured. Add VITE_ADMIN_LOGIN_EMAIL in Netlify.'); return; }
    setChecking(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: configuredEmail, password });
    if (signInError) { setLoginError(`Supabase login failed for ${configuredEmail}: ${signInError.message}`); setChecking(false); return; }
    setPassword('');
  }

  async function logout() {
    await supabase.auth.signOut();
    setHasAccess(false); setIsGlobalAdmin(false); setIsOfficial(false); setOrganiserAssignments([]); setUserEmail(''); setAccessError(''); setLoginError('');
    window.location.replace('/admin?platform=1');
  }

  const managedTournamentIds = organiserAssignments.map((row) => row.tournament_id);
  const allowed = requireOfficial ? isOfficial : hasAccess && (!requireGlobal || isGlobalAdmin);

  if (!hasSupabaseConfig || !supabase) return <main className="app-shell"><section className="warning-card"><strong>Supabase is not connected.</strong><span>Administration needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</span></section></main>;
  if (checking) return <main className="app-shell"><section className="card"><h1>Checking tournament access...</h1></section></main>;
  if (allowed) return <AdminAuthContext.Provider value={{ logout, userEmail, isGlobalAdmin, managedTournamentIds, organiserAssignments }}>{children}</AdminAuthContext.Provider>;

  if (requireOfficial && userEmail && !checking) return <main className="app-shell"><section className="hero"><p className="eyebrow">Top 100</p><h1>Admin team only</h1><p>Signed in as {userEmail}. This page is for the Top 100 admin team. If you should have access, ask David to add you.</p></section></main>;
  if (hasAccess && requireGlobal) return <main className="app-shell"><section className="hero"><p className="eyebrow">Top 100 Tournament Manager</p><h1>Platform admin only</h1><p>Your organiser account is deliberately restricted to its assigned tournament. Manager-account administration remains available only to the platform administrator.</p></section><section className="card"><a className="button" href="/admin">Return to tournament admin</a></section></main>;

  return <main className="app-shell">
    <section className="hero">
      <p className="eyebrow">{requireOfficial ? 'Top 100' : 'Top 100 Tournament Manager'}</p>
      <h1>{requireOfficial ? 'Admin team sign-in' : 'Tournament administration'}</h1>
      <p>{requireOfficial
        ? 'Admin team members sign in with their normal Manager Portal account. There is no separate admin username or password.'
        : 'Tournament organisers use their normal Manager Portal email sign-in. The username and password login is only for the platform administrator.'}</p>
    </section>

    <section className="card admin-login-card">
      <h2>{requireOfficial ? 'Admin team' : 'Tournament organiser'}</h2>
      <p>Sign in with the same email (and password, if you set one) you use for the Manager Portal. You'll be brought straight back here.</p>
      {accessError && <p className="status error-text">{accessError}</p>}
      {userEmail && !accessError && <p className="muted">Signed in as {userEmail}, but this account has not been assigned {requireOfficial ? 'to the admin team' : 'tournament administration'}.</p>}
      <div className="button-row">
        <a className="button" href={window.location.hostname === 'admin.smtop100.blog'
          ? `${MANAGER_ORIGIN}/?returnTo=${encodeURIComponent(window.location.origin + window.location.pathname)}`
          : `${MANAGER_ORIGIN}/`}>Sign in through Manager Portal</a>
      </div>
    </section>

    <details className="card admin-login-card" open={!requireOfficial || Boolean(loginError)}>
      <summary>Platform administrator only</summary>
      <h2>Platform administrator</h2>
      <p className="muted">Private login for the overall Top 100 Tournament Manager administrator.</p>
      <form onSubmit={login}>
        <label>Admin username<input type="text" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" /></label>
        <label>Admin password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
        <button type="submit" disabled={checking}>Log in as platform admin</button>
        {loginError && <p className="status error-text">{loginError}</p>}
      </form>
      <p className="muted">Not for the admin team or tournament organisers: this logs in to David's platform account only.</p>
    </details>
  </main>;
}
