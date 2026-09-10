import { useEffect } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import ManagerPortal from './ManagerPortal.jsx';

const LEGACY_MANAGER_ORIGIN = 'https://tournaments.smtop100.blog';
const LEGACY_MIGRATION_KEY = 'top100-manager-legacy-session-migration-attempted';
const BRIDGE_TIMEOUT_MS = 3000;

export default function ManagerEntry() {
  useEffect(() => {
    if (!hasSupabaseConfig || !supabase || window.location.hostname !== 'manager.smtop100.blog') return undefined;

    let frame;
    let timeout;
    let finished = false;

    const cleanup = () => {
      if (finished) return;
      finished = true;
      if (timeout) window.clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      if (frame?.parentNode) frame.parentNode.removeChild(frame);
    };

    const handleMessage = async (event) => {
      if (event.origin !== LEGACY_MANAGER_ORIGIN || event.data?.type !== 'top100-manager-session') return;

      const bridgeSession = event.data.session;
      if (bridgeSession?.access_token && bridgeSession?.refresh_token) {
        const { error } = await supabase.auth.setSession(bridgeSession);
        if (error) console.warn('Could not import previous Manager Portal session.', error);
      }
      cleanup();
    };

    const tryLegacySessionMigration = async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error || data.session) return;

      try {
        if (window.localStorage.getItem(LEGACY_MIGRATION_KEY) === '1') return;
        // Mark before opening the bridge so a later explicit logout cannot
        // trigger the old tournaments-origin session to be imported again.
        window.localStorage.setItem(LEGACY_MIGRATION_KEY, '1');
      } catch {
        // If storage is unavailable, skip the legacy migration rather than
        // making sign-in or sign-out semantics depend on an untracked bridge.
        return;
      }

      window.addEventListener('message', handleMessage);
      frame = document.createElement('iframe');
      frame.src = `${LEGACY_MANAGER_ORIGIN}/auth/session-bridge`;
      frame.title = 'Previous Manager Portal sign-in check';
      frame.setAttribute('aria-hidden', 'true');
      frame.style.display = 'none';
      document.body.appendChild(frame);
      timeout = window.setTimeout(cleanup, BRIDGE_TIMEOUT_MS);
    };

    tryLegacySessionMigration().catch(cleanup);
    return cleanup;
  }, []);

  return <ManagerPortal />;
}
