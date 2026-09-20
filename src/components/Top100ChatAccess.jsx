import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const CHAT_SESSION_TIMEOUT_MS = 8000;
const chatAuthClient = hasSupabaseConfig ? createClient(
  String(import.meta.env.VITE_SUPABASE_URL || '').trim(),
  String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim(),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
) : null;

function readHashAccessToken() {
  if (typeof window === 'undefined' || !window.location.hash) return '';
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return params.get('access_token') || '';
}

function getConfiguredStorageKey() {
  try {
    const hostname = new URL(String(import.meta.env.VITE_SUPABASE_URL || '').trim()).hostname;
    const projectRef = hostname.split('.')[0] || '';
    return projectRef ? `sb-${projectRef}-auth-token` : '';
  } catch {
    return '';
  }
}

function readStoredAccessToken() {
  if (typeof window === 'undefined') return '';
  try {
    const key = getConfiguredStorageKey();
    if (!key) return '';
    const raw = window.localStorage.getItem(key);
    if (!raw) return '';
    const parsed = JSON.parse(raw);
    const token = parsed?.access_token || parsed?.currentSession?.access_token || '';
    if (!token) return '';

    // Avoid handing an already-expired JWT to chat-ticket. If decoding fails,
    // let the server validate it rather than treating it as authenticated here.
    try {
      const payloadPart = token.split('.')[1];
      if (payloadPart) {
        const payload = JSON.parse(atob(payloadPart.replace(/-/g, '+').replace(/_/g, '/')));
        if (payload?.exp && Number(payload.exp) <= Math.floor(Date.now() / 1000) + 15) return '';
      }
    } catch {
      // The ticket endpoint remains the source of truth for JWT validity.
    }
    return token;
  } catch {
    return '';
  }
}

function withChatTimeout(promise, label = 'Chat sign-in check', ms = CHAT_SESSION_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} timed out. Please try again.`)), ms);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

export default function Top100ChatAccess() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('Checking whether you are already signed in…');
  const [busy, setBusy] = useState(false);
  const launchedForToken = useRef('');
  const callbackTokenRef = useRef('');
  const foregroundAuthStarted = useRef(false);

  async function launchChat(token) {
    if (!token) return;
    launchedForToken.current = token;
    setBusy(true);
    setStatus('Opening the Top 100 clubhouse…');

    try {
      const response = await fetch('/.netlify/functions/chat-ticket', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.url) throw new Error(body.error || 'Could not open Top 100 Chat.');
      callbackTokenRef.current = '';
      if (window.location.hash) {
        window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
      }
      window.location.assign(body.url);
    } catch (error) {
      launchedForToken.current = '';
      setBusy(false);
      setStatus(error.message || 'Could not open Top 100 Chat.');
    }
  }

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setBusy(false);
      setStatus('My Matches sign-in is unavailable.');
      return undefined;
    }

    // Magic-link callbacks return the short-lived Supabase access token in the
    // URL fragment. Use it directly for the server-validated chat ticket before
    // auth-js has a chance to block on browser session recovery.
    const callbackToken = readHashAccessToken();
    if (callbackToken) {
      callbackTokenRef.current = callbackToken;
      setSession({ access_token: callbackToken });
      launchChat(callbackToken);
      return undefined;
    }

    // Likewise, an already-signed-in browser already has the access token in
    // Supabase's persisted browser storage. Using it directly avoids making the
    // auth Web Lock a prerequisite for opening chat; chat-ticket still verifies
    // the JWT and manager membership server-side.
    const storedToken = readStoredAccessToken();
    if (storedToken) {
      launchChat(storedToken);
      return undefined;
    }

    let active = true;
    let subscription = null;

    async function initialiseAuth() {
      try {
        const { data, error } = await withChatTimeout(supabase.auth.getSession(), 'Sign-in check');
        if (!active) return;
        if (error) throw error;
        setSession(data.session || null);
        if (!data.session && !foregroundAuthStarted.current) setStatus('');

        // Subscribe only after the initial auth client initialization has
        // settled. Registering during initialization can deadlock auth-js's
        // browser Web Lock and make getSession/signIn/signOut hang.
        const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
          if (!active) return;
          setSession(nextSession);
          if (!nextSession && !foregroundAuthStarted.current) setStatus('');
        });
        subscription = listener.subscription;
      } catch (error) {
        if (!active) return;
        setSession(null);
        if (!foregroundAuthStarted.current) {
          setStatus('We could not check an existing sign-in automatically. You can still sign in below.');
        }
        console.warn('Top 100 Chat session check failed:', error);
      }
    }

    initialiseAuth();

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const token = session?.access_token || '';
    if (!token || launchedForToken.current === token) return;
    launchChat(token);
  }, [session?.access_token]);

  async function sendMagicLink(event) {
    event.preventDefault();
    if (!email.trim()) return;
    foregroundAuthStarted.current = true;
    setBusy(true);
    setStatus('Sending your secure sign-in link…');
    try {
      const { error } = await withChatTimeout(
        chatAuthClient.auth.signInWithOtp({
          email: email.trim(),
          options: {
            emailRedirectTo: 'https://manager.smtop100.blog/chat',
            shouldCreateUser: true,
          },
        }),
        'Sign-in link request',
        12000,
      );
      if (error) throw error;
      setStatus('Check your email for your secure My Matches sign-in link.');
    } catch (error) {
      setStatus(error?.message || 'We could not send the sign-in link. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    setSession(null);
    launchedForToken.current = '';
    callbackTokenRef.current = '';
    foregroundAuthStarted.current = false;
    setStatus('');
  }

  if (!hasSupabaseConfig || !supabase) {
    return <main className="manager-portal-shell"><section className="warning-card"><strong>Top 100 Chat unavailable.</strong><span>Manager sign-in is not connected.</span></section></main>;
  }

  if (!session) {
    return (
      <main className="manager-portal-shell">
        <section className="manager-portal-hero">
          <div>
            <p className="eyebrow">Top 100 Community</p>
            <h1>Enter the clubhouse</h1>
            <p>Top 100 Chat is a private community space for approved Top 100 managers.</p>
          </div>
        </section>
        <section className="card manager-login-card">
          <h2>Sign in with My Matches</h2>
          <p className="muted">Use the same email address you use for your Top 100 Manager Portal.</p>
          <form onSubmit={sendMagicLink}>
            <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Email me a sign-in link'}</button>
          </form>
          {status && <p className="status">{status}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="manager-portal-shell">
      <section className="manager-portal-hero">
        <div>
          <p className="eyebrow">Top 100 Community</p>
          <h1>Opening Top 100 Chat</h1>
          <p>Your Top 100 membership is being checked before the private conversation loads.</p>
        </div>
      </section>
      <section className="card manager-login-card">
        <p className="status">{status || 'Checking access…'}</p>
        {!busy && <div className="button-row"><button type="button" onClick={() => launchChat(callbackTokenRef.current || session.access_token)}>Try again</button><button type="button" className="secondary" onClick={signOut}>Sign out</button></div>}
      </section>
    </main>
  );
}
