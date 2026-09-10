import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import ManagerPortal from './ManagerPortal.jsx';

const LEGACY_MANAGER_ORIGIN = 'https://tournaments.smtop100.blog';
const BRIDGE_TIMEOUT_MS = 12000;

export default function ManagerEntry() {
  const [checkingBridge, setCheckingBridge] = useState(true);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase || window.location.hostname !== 'manager.smtop100.blog') {
      setCheckingBridge(false);
      return undefined;
    }

    let finished = false;
    let frame;
    let timeout;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (timeout) window.clearTimeout(timeout);
      if (frame?.parentNode) frame.parentNode.removeChild(frame);
      setCheckingBridge(false);
    };

    const handleMessage = async (event) => {
      if (event.origin !== LEGACY_MANAGER_ORIGIN || event.data?.type !== 'top100-manager-session') return;

      const bridgeSession = event.data.session;
      if (bridgeSession?.access_token && bridgeSession?.refresh_token) {
        const { error } = await supabase.auth.setSession(bridgeSession);
        if (error) console.warn('Could not import previous Manager Portal session.', error);
      }
      finish();
    };

    window.addEventListener('message', handleMessage);

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (error || data.session) {
          finish();
          return;
        }

        frame = document.createElement('iframe');
        frame.src = `${LEGACY_MANAGER_ORIGIN}/auth/session-bridge`;
        frame.title = 'Previous Manager Portal sign-in check';
        frame.setAttribute('aria-hidden', 'true');
        frame.style.display = 'none';
        frame.addEventListener('error', finish, { once: true });
        document.body.appendChild(frame);
        timeout = window.setTimeout(finish, BRIDGE_TIMEOUT_MS);
      })
      .catch(finish);

    return () => {
      if (timeout) window.clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      if (frame?.parentNode) frame.parentNode.removeChild(frame);
    };
  }, []);

  if (checkingBridge) {
    return <main className="manager-portal-shell"><section className="card"><h2>Checking manager sign-in…</h2></section></main>;
  }

  return <ManagerPortal />;
}
