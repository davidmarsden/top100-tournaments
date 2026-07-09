import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const AdminAuthContext = { Provider: ({ children }) => children };

export default function AdminGate({ children }) {
  const [email, setEmail] = useState('');
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
    setChecking(true);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (signInError) { setError(signInError.message); setChecking(false); return; }
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

  return <main className="app-shell"><section className="hero"><p className="eyebrow">Top 100 Tournament Manager</p><h1>Admin login</h1><p>Public visitors see the live Youth Cup page. Admin tools require a Supabase admin account.</p></section><section className="card admin-login-card"><form onSubmit={login}><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" autoFocus /></label><label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></label><button type="submit" disabled={checking}>Log in</button>{error && <p className="status error-text">{error}</p>}</form>{userEmail && <p className="muted">Signed in as {userEmail}, but this account is not in admin_users.</p>}<p className="muted">Admin URL: /admin</p></section></main>;
}
