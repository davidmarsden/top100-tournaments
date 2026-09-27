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
  // Never block the sign-in form on session recovery. A browser with no usable
  // session must be able to type an email immediately; auth recovery runs behind it.
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authStage, setAuthStage] = useState('Starting Manager Portal…');

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

    function initialiseAuth() {
      // Do not call getSession() during first paint. On affected Chrome/Firefox
      // installs auth-js can block the main page while recovering its browser
      // lock, which makes even the email field unusable. Render signed-out
      // immediately and let an actual auth event populate the session.
      setAuthStage('Ready to sign in.');
      setAuthLoading(false);

      let initialAuthEventSeen = false;
      const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setAuthError('');
        setAuthLoading(false);

        // Only consult the old tournaments-host session after auth-js has told
        // us this origin has no session. Never let legacy migration overwrite
        // a valid/current Manager Portal or magic-link session.
        if (!initialAuthEventSeen) {
          initialAuthEventSeen = true;
          if (!nextSession) window.setTimeout(tryLegacySessionMigration, 0);
        }
      });
      subscription = listener.subscription;
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
        authStage={authStage}
      />
      {!registrationMode && (
        <ManagerReminderPreferences session={session} authLoading={authLoading} />
      )}
      {!registrationMode && <ManagerResourceHub />}
    </>
  );
}
