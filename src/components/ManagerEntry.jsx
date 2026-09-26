import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import ManagerPortal from './ManagerPortal.jsx';
import ManagerResourceHub from './ManagerResourceHub.jsx';
import ManagerReminderPreferences from './ManagerReminderPreferences.jsx';

const LEGACY_MANAGER_ORIGIN = 'https://tournaments.smtop100.blog';
const LEGACY_MIGRATION_KEY = 'top100-manager-legacy-session-migration-attempted';
const BRIDGE_TIMEOUT_MS = 3000;
const AUTH_CHECK_TIMEOUT_MS = 8000;
const AUTH_RECOVERY_KEY = 'top100-manager-auth-recovery-attempted';

function withAuthTimeout(promise, label = 'Sign-in check', ms = AUTH_CHECK_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} timed out. Please try again.`)), ms);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

export default function ManagerEntry({ registrationMode = false }) {
  const returnTo = (() => { const value = new URLSearchParams(window.location.search).get('returnTo'); try { const url = new URL(value || ''); return url.hostname.endsWith('.smtop100.blog') ? url.toString() : ''; } catch { return ''; } })();
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setAuthLoading(false);
      return undefined;
    }

    let active = true;
    let subscription = null;
    let frame = null;
    let bridgeTimeout = null;
    let bridgeFinished = false;

    const cleanupBridge = () => {
      if (bridgeFinished) return;
      bridgeFinished = true;
      if (bridgeTimeout) window.clearTimeout(bridgeTimeout);
      window.removeEventListener('message', handleMessage);
      if (frame?.parentNode) frame.parentNode.removeChild(frame);
      frame = null;
    };

    const handleMessage = async (event) => {
      if (event.origin !== LEGACY_MANAGER_ORIGIN || event.data?.type !== 'top100-manager-session') return;

      const bridgeSession = event.data.session;
      if (bridgeSession?.access_token && bridgeSession?.refresh_token) {
        try {
          const { data, error } = await withAuthTimeout(
            supabase.auth.setSession(bridgeSession),
            'Previous sign-in import',
          );
          if (!active) return;
          if (error) throw error;
          setSession(data.session || null);
          setAuthError('');
        } catch (error) {
          if (active) {
            console.warn('Could not import previous Manager Portal session.', error);
            setAuthError(error?.message || 'We could not restore your previous sign-in.');
          }
        }
      }
      cleanupBridge();
    };

    const tryLegacySessionMigration = () => {
      if (window.location.hostname !== 'manager.smtop100.blog') return;

      try {
        if (window.localStorage.getItem(LEGACY_MIGRATION_KEY) === '1') return;
        window.localStorage.setItem(LEGACY_MIGRATION_KEY, '1');
      } catch {
        return;
      }

      window.addEventListener('message', handleMessage);
      frame = document.createElement('iframe');
      frame.src = `${LEGACY_MANAGER_ORIGIN}/auth/session-bridge`;
      frame.title = 'Previous Manager Portal sign-in check';
      frame.setAttribute('aria-hidden', 'true');
      frame.style.display = 'none';
      document.body.appendChild(frame);
      bridgeTimeout = window.setTimeout(cleanupBridge, BRIDGE_TIMEOUT_MS);
    };

    async function initialiseAuth() {
      try {
        // ManagerEntry is the single auth owner for My Matches. Child
        // components consume this session instead of racing getSession() and
        // onAuthStateChange() calls against Supabase's browser Web Lock.
        const { data, error } = await withAuthTimeout(supabase.auth.getSession());
        if (!active) return;
        if (error) throw error;

        const initialSession = data.session || null;
        setSession(initialSession);

        // Subscribe only after Supabase's initial session recovery has
        // completed. This avoids the auth-js Web Lock deadlock we have seen
        // when session recovery and listener registration overlap.
        const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          if (!active) return;
          setSession(nextSession);
          setAuthError('');
        });
        subscription = listener.subscription;
        setAuthLoading(false);
        try { window.sessionStorage.removeItem(AUTH_RECOVERY_KEY); } catch { /* storage unavailable */ }

        if (!initialSession) tryLegacySessionMigration();
      } catch (error) {
        if (!active) return;
        // Desktop browsers can occasionally leave Supabase's persisted auth state
        // locked/stale after a magic-link callback. Recover once with a clean
        // local session instead of leaving the portal on a loading/crash path.
        try {
          if (window.sessionStorage.getItem(AUTH_RECOVERY_KEY) !== '1') {
            window.sessionStorage.setItem(AUTH_RECOVERY_KEY, '1');
            // Do not call supabase.auth.signOut() here: a wedged getSession()
            // can still own the same Web Lock and signOut would wait forever too.
            // Remove this project's persisted auth token directly, then reload.
            const projectRef = new URL(supabase.supabaseUrl).hostname.split('.')[0];
            window.localStorage.removeItem(`sb-${projectRef}-auth-token`);
            window.location.reload();
            return;
          }
        } catch { /* fall through to the visible recovery screen */ }
        setAuthError(error?.message || 'We could not check your sign-in. Please try again.');
        setAuthLoading(false);
      }
    }

    initialiseAuth();

    return () => {
      active = false;
      subscription?.unsubscribe();
      cleanupBridge();
    };
  }, []);

  return (
    <>
      <ManagerPortal
        registrationMode={registrationMode}
        returnTo={returnTo}
        session={session}
        authLoading={authLoading}
        authError={authError}
      />
      {!registrationMode && (
        <ManagerReminderPreferences session={session} authLoading={authLoading} />
      )}
      {!registrationMode && <ManagerResourceHub />}
    </>
  );
}
