import { useEffect } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const TRUSTED_CONSUMER_ORIGINS = new Set([
  'https://vote.smtop100.blog',
  'https://awards.smtop100.blog',
]);

export default function AuthSessionBridge() {
  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) return;

    const parentOrigin = (() => {
      try { return new URL(document.referrer).origin; } catch { return ''; }
    })();

    // Never expose a session to an arbitrary embedding origin.
    if (!TRUSTED_CONSUMER_ORIGINS.has(parentOrigin) || window.parent === window) return;

    supabase.auth.getSession().then(({ data }) => {
      const session = data.session;
      window.parent.postMessage({
        type: 'top100-manager-session',
        session: session ? {
          access_token: session.access_token,
          refresh_token: session.refresh_token,
        } : null,
      }, parentOrigin);
    });
  }, []);

  return null;
}
