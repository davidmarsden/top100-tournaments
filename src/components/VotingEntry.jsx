import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import VotingPortal from './VotingPortal.jsx';

const MANAGER_ORIGIN = 'https://manager.smtop100.blog';
const BRIDGE_TIMEOUT_MS = 15000;

export default function VotingEntry() {
  const [checkingBridge, setCheckingBridge] = useState(true);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase || window.location.hostname !== 'vote.smtop100.blog') {
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
      setCheckingBridge(false);
      if (frame?.parentNode) frame.parentNode.removeChild(frame);
    };

    const handleMessage = async (event) => {
      if (event.origin !== MANAGER_ORIGIN || event.data?.type !== 'top100-manager-session') return;

      const bridgeSession = event.data.session;
      if (bridgeSession?.access_token && bridgeSession?.refresh_token) {
        const { error } = await supabase.auth.setSession(bridgeSession);
        if (error) console.warn('Could not import Manager Portal session into Voting.', error);
      }
      finish();
    };

    window.addEventListener('message', handleMessage);

    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (error) {
          console.warn('Could not read Voting session before manager bridge check.', error);
          finish();
          return;
        }
        if (data.session) {
          finish();
          return;
        }

        frame = document.createElement('iframe');
        frame.src = `${MANAGER_ORIGIN}/auth/session-bridge`;
        frame.title = 'Manager sign-in check';
        frame.setAttribute('aria-hidden', 'true');
        frame.style.display = 'none';
        frame.addEventListener('error', finish, { once: true });
        document.body.appendChild(frame);
        timeout = window.setTimeout(finish, BRIDGE_TIMEOUT_MS);
      })
      .catch((error) => {
        console.warn('Manager sign-in bridge check failed.', error);
        finish();
      });

    return () => {
      if (timeout) window.clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      if (frame?.parentNode) frame.parentNode.removeChild(frame);
    };
  }, []);

  if (checkingBridge) {
    return <main className="manager-portal-shell"><section className="card"><h2>Checking manager sign-in…</h2></section></main>;
  }

  return <VotingPortal />;
}
