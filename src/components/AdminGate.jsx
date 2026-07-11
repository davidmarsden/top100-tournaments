import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const AdminAuthContext = { Provider: ({ children }) => children };
const configuredUsername = String(import.meta.env.VITE_ADMIN_USERNAME || 'admin').trim();
const configuredEmail = String(import.meta.env.VITE_ADMIN_LOGIN_EMAIL || import.meta.env.VITE_ADMIN_EMAIL || '').trim();

export default function AdminGate({ children }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [checking, setChecking] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userEmail, setUserEmail] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setChecking(false); return undefined; }
    let mounted = true;
    async function checkSession() {
      const { data } = await supabase.auth.getSession();
      if (mounted) await checkAdmin(data.session?.user || null);
    }
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => { checkAdmin(session?.user || null); });
    checkSession();
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, []);

  async function checkAdmin(user) {
    if (!user) { setIsAdmin(false); setUserEmail(''); setChecking(false); return; }
    const { data, error: rpcError } = await supabase.rpc('is_admin');
    setUserEmail(user.email || 'admin user');
    setIsAdmin(Boolean(data) && !rpcError);
    setError(rpcError ? 'Could not verify admin permissions: ' + rpcError.message : '');
    setChecking(false);
  }

  async function login(event) {
    event.preventDefault();
    setError('');

    const cleanUsername = username.trim();
    if (cleanUsername.toLowerCase() !== configuredUsername.toLowerCase()) {
      setError('Incorrect username or password.');
      return;
    }
    if (!configuredEmail) {
      setError('Admin login email is not configured. Add VITE_ADMIN_LOGIN_EMAIL in Netlify.');
      return;
    }

    setChecking(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: configuredEmail, password });
    if (signInError) { setError('Incorrect username or password.'); setChecking(false); return; }
    setPassword('');
  }

  async function logout() {
    await supabase.auth.signOut();
    setIsAdmin(false);
    setUserEmail('');
  }

  if (!hasSupabaseConfig || !supabase) return <main className="app-shell"><section className="warning-card"><strong>Supabase is not connected.</strong><span>Admin login needs VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.</span></section></main>;
  if (checking) return <main className="app-shell"><section className="card"><h1>Checking admin access...</h1></section></main>;
  if (isAdmin) return <AdminAuthContext.Provider value={{ logout, userEmail }}>{children}</AdminAuthContext.Provider>;

  return <main className="app-shell"><section className="hero"><p className="eyebrow">Top 100 Tournament Manager</p><h1>Admin login</h1><p>Public visitors see the live Youth Cup page. Tournament administration requires the private admin login.</p></section><section className="card admin-login-card"><form onSubmit={login}><label>Username<input type="text" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" autoCapitalize="none" autoFocus /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label><button type="submit" disabled={checking}>Log in</button>{error && <p className="status error-text">{error}</p>}</form>{userEmail && <p className="muted">Signed in as {userEmail}, but this account is not in admin_users.</p>}<p className="muted">Admin username: {configuredUsername}</p></section></main>;
}
