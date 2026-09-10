import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import VotingPortal from './VotingPortal.jsx';

const MANAGER_ORIGIN = 'https://tournaments.smtop100.blog';

export default function VotingEntry() {
  const [checkingBridge, setCheckingBridge] = useState(true);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase || window.location.hostname !== 'vote.smtop100.blog') {
      setCheckingBridge(false);
      return undefined;
    }

    let finished = false;
    let frame;

    const finish = () => {
      if (finished) return;
      finished = true;
      setCheckingBridge(false);
      if (frame?.parentNode) frame.parentNode.removeChild(frame);
    };

    const handleMessage = async (event) => {
      if (event.origin !== MANAGER_ORIGIN || event.data?.type !== 'top100-manager-session') return;
      const bridgeSession = event.data.session;
      if (bridgeSession?.access_token && bridgeSession?.refresh_token) {
        await supabase.auth.setSession(bridgeSession);
      }
      finish();
    };

    window.addEventListener('message', handleMessage);

    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        finish();
        return;
      }
      frame = document.createElement('iframe');
      frame.src = `${MANAGER_ORIGIN}/auth/session-bridge`;
      frame.title = 'Manager sign-in check';
      frame.setAttribute('aria-hidden', 'true');
      frame.style.display = 'none';
      document.body.appendChild(frame);
    });

    const timeout = window.setTimeout(finish, 2500);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      if (frame?.parentNode) frame.parentNode.removeChild(frame);
    };
  }, []);

  if (checkingBridge) {
    return <main className="manager-portal-shell"><section className="card"><h2>Checking manager sign-in…</h2></section></main>;
  }

  return <VotingPortal />;
}
