import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import ManagerPortal from './ManagerPortal.jsx';
import ManagerResourceHub from './ManagerResourceHub.jsx';
import ManagerReminderPreferences from './ManagerReminderPreferences.jsx';

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

    function initialiseAuth() {
      // Manager Portal is now the canonical identity origin. Do not inspect or
      // import sessions from the old tournaments host: established browsers may
      // carry stale legacy state that can wedge auth-js/browser storage.
      setAuthStage('Ready to sign in.');
      setAuthLoading(false);

      const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        if (!active) return;
        setSession(nextSession);
        setAuthError('');
        setAuthLoading(false);
      });
      subscription = listener.subscription;
    }

    initialiseAuth();

    return () => {
      active = false;
      subscription?.unsubscribe();
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
