import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import VotingPortal from './VotingPortal.jsx';

const MANAGER_ORIGIN = 'https://manager.smtop100.blog';
const ADMIN_ORIGIN = 'https://admin.smtop100.blog';
const BRIDGE_TIMEOUT_MS = 5000;

export default function VotingEntry() {
  const [checkingReturn, setCheckingReturn] = useState(true);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase || window.location.hostname !== 'vote.smtop100.blog') {
      setCheckingReturn(false);
      return undefined;
    }

    let active = true;
    let frame = null;
    let timer = null;

    const finish = () => {
      if (!active) return;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('message', handleMessage);
      if (frame?.parentNode) frame.parentNode.removeChild(frame);
      frame = null;
      setCheckingReturn(false);
    };

    let handoffInProgress = false;
    let bridgeOrigin = MANAGER_ORIGIN;

    const handleMessage = async (event) => {
      if (event.origin !== bridgeOrigin || event.data?.type !== 'top100-manager-session') return;
      const bridgeSession = event.data.session;
      if (bridgeSession?.access_token && bridgeSession?.refresh_token) {
        if (handoffInProgress) return;
        handoffInProgress = true;
        const { error } = await supabase.auth.setSession(bridgeSession);
        if (error) console.warn('Could not complete Manager Portal sign-in handoff.', error);
        // setSession persists asynchronously across auth-js/browser storage.
        // A fresh navigation could previously render signed-out until reload.
        await new Promise((resolve) => window.setTimeout(resolve, 50));
      }
      if (!bridgeSession && bridgeOrigin === MANAGER_ORIGIN) {
        // Platform-admin sessions live on the admin origin. If Manager Portal
        // has no session, give the admin origin one bounded chance to hand off
        // the same Supabase identity before showing the manager sign-in route.
        if (timer) window.clearTimeout(timer);
        if (frame?.parentNode) frame.parentNode.removeChild(frame);
        bridgeOrigin = ADMIN_ORIGIN;
        frame = document.createElement('iframe');
        frame.src = `${ADMIN_ORIGIN}/auth/session-bridge`;
        frame.title = 'Checking Top 100 admin sign-in';
        frame.setAttribute('aria-hidden', 'true');
        frame.style.display = 'none';
        frame.addEventListener('error', finish, { once: true });
        document.body.appendChild(frame);
        timer = window.setTimeout(finish, BRIDGE_TIMEOUT_MS);
        return;
      }
      finish();
    };

    async function initialise() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!active || data.session) return finish();

        // This bridge is now only a return handoff from the canonical Manager
        // Portal. Voting never initiates its own magic-link sign-in.
        window.addEventListener('message', handleMessage);
        frame = document.createElement('iframe');
        frame.src = `${MANAGER_ORIGIN}/auth/session-bridge`;
        frame.title = 'Completing Top 100 sign-in';
        frame.setAttribute('aria-hidden', 'true');
        frame.style.display = 'none';
        frame.addEventListener('error', finish, { once: true });
        document.body.appendChild(frame);
        timer = window.setTimeout(finish, BRIDGE_TIMEOUT_MS);
      } catch (error) {
        console.warn('Could not complete Manager Portal sign-in handoff.', error);
        finish();
      }
    }

    initialise();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
      window.removeEventListener('message', handleMessage);
      if (frame?.parentNode) frame.parentNode.removeChild(frame);
    };
  }, []);

  if (checkingReturn) {
    return <main className="manager-portal-shell"><section className="card"><h2>Checking Top 100 sign-in…</h2><p className="muted">This should only take a few seconds.</p></section></main>;
  }

  return <VotingPortal />;
}
