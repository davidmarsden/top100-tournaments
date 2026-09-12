import { createContext, useContext, useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const AdminAuthContext = createContext({ isGlobalAdmin: false, managedTournamentIds: [], organiserAssignments: [], userEmail: '', logout: async () => {} });
const configuredUsername = String(import.meta.env.VITE_ADMIN_USERNAME || 'admin').trim();
const configuredEmail = String(import.meta.env.VITE_ADMIN_LOGIN_EMAIL || import.meta.env.VITE_ADMIN_EMAIL || '').trim();

export function useAdminAuth() {
  return useContext(AdminAuthContext);
}

export default function AdminGate({ children, requireGlobal = false }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [isGlobalAdmin, setIsGlobalAdmin] = useState(false);
  const [organiserAssignments, setOrganiserAssignments] = useState([]);
  const [userEmail, setUserEmail] = useState('');
  const [accessError, setAccessError] = useState('');
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setChecking(false); return undefined; }
    let mounted = true;
    async function checkSession() {
      const { data } = await supabase.auth.getSession();
      if (mounted) await checkAccess(data.session?.user || null, false);
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
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  async function checkAccess(user, background = false) {
    if (!user) {
      setHasAccess(false); setIsGlobalAdmin(false); setOrganiserAssignments([]); setUserEmail(''); setAccessError(''); setChecking(false); return;
    }
    if (!background) setChecking(true);
    const [adminResult, accessResult, assignmentsResult] = await Promise.all([
      supabase.rpc('is_admin'),
      supabase.rpc('has_tournament_admin_access'),
      supabase.from('tournament_organisers').select('tournament_id, role, active').eq('auth_user_id', user.id).eq('active', true),
    ]);
    const global = Boolean(adminResult.data) && !adminResult.error;
    const assignments = assignmentsResult.error ? [] : assignmentsResult.data || [];
    setUserEmail(user.email || 'signed-in user');
    setIsGlobalAdmin(global);
    setOrganiserAssignments(assignments);
    setHasAccess((Boolean(accessResult.data) && !accessResult.error) || global);
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
    setHasAccess(false); setIsGlobalAdmin(false); setOrganiserAssignments([]); setUserEmail(''); setAccessError(''); setLoginError('');
  }

  const managedTournamentIds = organiserAssignments.map((row) => row.tournament_id);
  const allowed = hasAccess && (!requireGlobal || isGlobalAdmin);

  if (!hasSupabaseConfig || !supabase) return <main className="app-shell"><section className="warning-card"><strong>Supabase is not connected.</strong><span>Administration needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</span></section></main>;
  if (checking) return <main className="app-shell"><section className="card"><h1>Checking tournament access...</h1></section></main>;
  if (allowed) return <AdminAuthContext.Provider value={{ logout, userEmail, isGlobalAdmin, managedTournamentIds, organiserAssignments }}>{children}</AdminAuthContext.Provider>;

  if (hasAccess && requireGlobal) return <main className="app-shell"><section className="hero"><p className="eyebrow">Top 100 Tournament Manager</p><h1>Platform admin only</h1><p>Your organiser account is deliberately restricted to its assigned tournament. Manager-account administration remains available only to the platform administrator.</p></section><section className="card"><a className="button" href="/admin">Return to tournament admin</a></section></main>;

  return <main className="app-shell">
    <section className="hero">
      <p className="eyebrow">Top 100 Tournament Manager</p>
      <h1>Tournament administration</h1>
      <p>Tournament organisers use their normal Manager Portal email sign-in. The username and password login is only for the platform administrator.</p>
    </section>

    <section className="card admin-login-card">
      <h2>Tournament organiser</h2>
      <p>Sign in with the same email you use for the Manager Portal. You do not need a separate admin username or password.</p>
      {accessError && <p className="status error-text">{accessError}</p>}
      {userEmail && !accessError && <p className="muted">Signed in as {userEmail}, but this account has not been assigned tournament administration.</p>}
      <div className="button-row">
        <a className="button" href="/manager">Sign in through Manager Portal</a>
      </div>
    </section>

    <section className="card admin-login-card">
      <h2>Platform administrator</h2>
      <p className="muted">Private login for the overall Top 100 Tournament Manager administrator.</p>
      <form onSubmit={login}>
        <label>Admin username<input type="text" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" /></label>
        <label>Admin password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label>
        <button type="submit" disabled={checking}>Log in as platform admin</button>
        {loginError && <p className="status error-text">{loginError}</p>}
      </form>
      <p className="muted">Admin username: {configuredUsername}</p>
    </section>
  </main>;
}
