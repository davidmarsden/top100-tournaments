import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const CHAT_SESSION_TIMEOUT_MS = 8000;
const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
const hasSupabaseConfig = supabaseUrl.startsWith('https://') && supabaseUrl.includes('.supabase.co') && supabaseAnonKey.length > 20;
const chatAuthClient = hasSupabaseConfig ? createClient(
  supabaseUrl,
  supabaseAnonKey,
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
    const hostname = new URL(supabaseUrl).hostname;
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
  const [activeToken, setActiveToken] = useState('');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('Checking whether you are already signed in…');
  const [busy, setBusy] = useState(false);
  const launchedForToken = useRef('');
  const callbackTokenRef = useRef('');

  async function launchChat(token) {
    if (!token) return;
    launchedForToken.current = token;
    setActiveToken(token);
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
    if (!hasSupabaseConfig || !chatAuthClient) {
      setBusy(false);
      setStatus('My Matches sign-in is unavailable.');
      return;
    }

    // This route is booted independently from the main application specifically
    // so no persistent Supabase client can consume the magic-link fragment first.
    const callbackToken = readHashAccessToken();
    if (callbackToken) {
      callbackTokenRef.current = callbackToken;
      setActiveToken(callbackToken);
      launchChat(callbackToken);
      return;
    }

    const storedToken = readStoredAccessToken();
    if (storedToken) {
      setActiveToken(storedToken);
      launchChat(storedToken);
      return;
    }

    setStatus('');
  }, []);

  async function sendMagicLink(event) {
    event.preventDefault();
    if (!email.trim()) return;
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

  function signOut() {
    try {
      const key = getConfiguredStorageKey();
      if (key) window.localStorage.removeItem(key);
    } catch {
      // Local cleanup is best-effort; the chat ticket is short-lived either way.
    }
    if (window.location.hash) {
      window.history.replaceState(null, document.title, window.location.pathname + window.location.search);
    }
    setActiveToken('');
    launchedForToken.current = '';
    callbackTokenRef.current = '';
    setBusy(false);
    setStatus('');
  }

  if (!hasSupabaseConfig || !chatAuthClient) {
    return <main className="manager-portal-shell"><section className="warning-card"><strong>Top 100 Chat unavailable.</strong><span>Manager sign-in is not connected.</span></section></main>;
  }

  if (!activeToken) {
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
        {!busy && <div className="button-row"><button type="button" onClick={() => launchChat(callbackTokenRef.current || activeToken)}>Try again</button><button type="button" className="secondary" onClick={signOut}>Sign out</button></div>}
      </section>
    </main>
  );
}
