import { useEffect, useRef, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const CHAT_SESSION_TIMEOUT_MS = 8000; // Keep magic-link requests bounded even in preview builds.
const CHAT_SHARE_STORAGE_KEY = 'top100PendingChatShare';
const CHAT_SHARE_TTL_MS = 30 * 60 * 1000;
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

// The stored Manager Portal session (same storage key as the main app's Supabase client).
function readStoredSession() {
  try {
    const key = getConfiguredStorageKey();
    const raw = key ? window.localStorage.getItem(key) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.currentSession || parsed || null;
  } catch {
    return null;
  }
}

// Save a session where the main app's Supabase client reads it, so signing in here also signs
// the manager in to the Manager Portal on this device, and the next visit needs no sign-in.
function storeSession(session) {
  try {
    const key = getConfiguredStorageKey();
    if (key && session?.access_token && session?.refresh_token) window.localStorage.setItem(key, JSON.stringify(session));
  } catch {
    // Storage unavailable (private browsing): this visit still works.
  }
}

// A session that has expired but can be renewed: the access token lasts an hour, the refresh
// token much longer. Renew it rather than asking the manager to sign in again.
async function refreshStoredSession() {
  const stored = readStoredSession();
  if (!stored?.refresh_token || !chatAuthClient) return '';
  try {
    const { data, error } = await withChatTimeout(chatAuthClient.auth.refreshSession({ refresh_token: stored.refresh_token }), 'Renewing your sign-in');
    if (error || !data?.session?.access_token) return '';
    storeSession(data.session);
    return data.session.access_token;
  } catch {
    return '';
  }
}

function normalizeShareIntent(value, { requireFresh = false } = {}) {
  if (!value || typeof value !== 'object') return null;
  const title = String(value.title || '').trim().slice(0, 180);
  const rawUrl = String(value.url || '').trim().slice(0, 500);
  const createdAt = Number(value.createdAt || 0);
  if (!rawUrl) return null;
  if (requireFresh && (!createdAt || Date.now() - createdAt > CHAT_SHARE_TTL_MS)) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'https:' || url.hostname !== 'smtop100.blog') return null;
    return { title, url: url.toString(), createdAt: createdAt || Date.now() };
  } catch {
    return null;
  }
}

function readShareIntentFromQuery() {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  return normalizeShareIntent({
    title: params.get('shareTitle') || '',
    url: params.get('shareUrl') || '',
  });
}

function readStoredShareIntent() {
  if (typeof window === 'undefined') return null;
  try {
    const stored = normalizeShareIntent(
      JSON.parse(window.localStorage.getItem(CHAT_SHARE_STORAGE_KEY) || 'null'),
      { requireFresh: true },
    );
    if (!stored) clearStoredShareIntent();
    return stored;
  } catch {
    return null;
  }
}

function rememberShareIntent() {
  const fromQuery = readShareIntentFromQuery();
  const share = fromQuery || readStoredShareIntent();
  if (!share) return null;
  const storedShare = fromQuery ? { ...share, createdAt: Date.now() } : share;
  try {
    window.localStorage.setItem(CHAT_SHARE_STORAGE_KEY, JSON.stringify(storedShare));
  } catch {
    // The query string remains a fallback when local storage is unavailable.
  }
  return storedShare;
}

function clearStoredShareIntent() {
  try {
    window.localStorage.removeItem(CHAT_SHARE_STORAGE_KEY);
  } catch {
    // Best-effort cleanup only.
  }
}

function readShareIntent() {
  return readShareIntentFromQuery() || readStoredShareIntent();
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
  const [code, setCode] = useState('');
  const [linkSent, setLinkSent] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
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
      const share = readShareIntent();
      const response = await fetch('/.netlify/functions/chat-ticket', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(share ? { share } : {}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.url) throw new Error(body.error || 'Could not open Top 100 Chat.');
      callbackTokenRef.current = '';
      clearStoredShareIntent();
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
    rememberShareIntent();

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

    // Signed in before, but the hour-long access token has run out: renew it.
    let cancelled = false;
    refreshStoredSession().then((token) => {
      if (cancelled) return;
      if (token) { setActiveToken(token); launchChat(token); } else setStatus('');
    });

    // Signed in in another tab of this browser (a sign-in link, a code, or the Manager Portal):
    // carry on here without asking again.
    const onStorage = (event) => {
      if (event.key !== getConfiguredStorageKey() || launchedForToken.current) return;
      const token = readStoredAccessToken();
      if (token) { setActiveToken(token); launchChat(token); }
    };
    window.addEventListener('storage', onStorage);
    return () => { cancelled = true; window.removeEventListener('storage', onStorage); };
  }, []);

  async function sendMagicLink(event) {
    event.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    setStatus('Sending your secure sign-in link…');
    rememberShareIntent();
    try {
      const { error } = await withChatTimeout(
        chatAuthClient.auth.signInWithOtp({
          email: email.trim(),
          options: {
            emailRedirectTo: window.location.hostname.endsWith('.netlify.app')
              ? `${window.location.origin}/chat${window.location.search}`
              : `https://manager.smtop100.blog/chat${window.location.search}`,
            shouldCreateUser: true,
          },
        }),
        'Sign-in link request',
        12000,
      );
      if (error) throw error;
      setLinkSent(true);
      setStatus('Check your email. Enter the code from the email below, or open its sign-in link on this device.');
    } catch (error) {
      setStatus(error?.message || 'We could not send the sign-in link. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  // Email and password, for managers who have set one in My Matches.
  async function signInWithPassword(event) {
    event.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);
    setStatus('Signing in…');
    try {
      const { data, error } = await withChatTimeout(chatAuthClient.auth.signInWithPassword({ email: email.trim(), password }), 'Password sign-in');
      if (error || !data?.session) throw error || new Error('We could not sign you in.');
      storeSession(data.session);
      setBusy(false);
      setActiveToken(data.session.access_token);
      launchChat(data.session.access_token);
    } catch (error) {
      setBusy(false);
      setStatus(/invalid login/i.test(error?.message || '')
        ? 'That email and password did not match. If you have not set a password yet, use an email link instead.'
        : error?.message || 'We could not sign you in.');
    }
  }

  // The code in the sign-in email: signs in on this device without leaving the page.
  async function verifyCode(event) {
    event.preventDefault();
    const token = code.replace(/\s+/g, '');
    if (!token) return;
    setBusy(true);
    setStatus('Checking the code…');
    try {
      const { data, error } = await withChatTimeout(chatAuthClient.auth.verifyOtp({ email: email.trim(), token, type: 'email' }), 'Sign-in code check');
      if (error || !data?.session) throw error || new Error('That code did not work.');
      storeSession(data.session);
      setBusy(false);
      setActiveToken(data.session.access_token);
      launchChat(data.session.access_token);
    } catch (error) {
      setBusy(false);
      setStatus(error?.message ? `${error.message} Use the newest email you received.` : 'That code did not work. Use the newest email you received.');
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
    clearStoredShareIntent();
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
          {usePassword ? <>
            <form onSubmit={signInWithPassword}>
              <label>Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={busy} /></label>
              <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required disabled={busy} /></label>
              <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
            </form>
            {status && <p className="status">{status}</p>}
            <p className="muted">Forgotten it? Sign in with an email link, then set a new password in My Matches.</p>
            <button type="button" className="secondary" disabled={busy} onClick={() => { setUsePassword(false); setStatus(''); }}>Email me a sign-in link instead</button>
          </> : <>
          <form onSubmit={sendMagicLink}>
            <label>Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={busy || linkSent} /></label>
            {!linkSent && <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Email me a sign-in link'}</button>}
          </form>
          {status && <p className="status">{status}</p>}
          {!linkSent && <button type="button" className="secondary" disabled={busy} onClick={() => { setUsePassword(true); setStatus(''); }}>Sign in with a password</button>}
          {linkSent && <>
            <form className="sign-in-code-form" onSubmit={verifyCode}>
              <label>Code from the email<input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,12}" maxLength={12} value={code} onChange={(event) => setCode(event.target.value)} required disabled={busy} /></label>
              <p className="muted">Best on a phone or in the Chat app: enter the code here rather than opening the link, which may open in a different browser.</p>
              <button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Sign in with code'}</button>
            </form>
            <button type="button" className="secondary" disabled={busy} onClick={() => { setLinkSent(false); setCode(''); setStatus(''); }}>Use a different email</button>
          </>}
          </>}
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
