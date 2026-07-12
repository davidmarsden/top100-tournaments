import ManagerAccountsManager from './ManagerAccountsManager.jsx';
import { supabase } from '../lib/supabaseClient';

export default function ManagerAccountsPage() {
  async function logout() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  return <main className="app-shell">
    <section className="hero"><div className="hero-row"><div><p className="eyebrow">Top 100 Tournament Manager</p><h1>Manager accounts</h1><p>Approve verified-email claims and link managers to their canonical Top 100 records.</p></div><div className="button-row"><a className="button secondary" href="/admin">Tournament admin</a><button type="button" className="secondary" onClick={logout}>Log out</button></div></div></section>
    <section className="card module-card"><ManagerAccountsManager /></section>
  </main>;
}
