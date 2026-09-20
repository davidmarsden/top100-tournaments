import { useEffect, useRef, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const CHAT_SESSION_TIMEOUT_MS = 8000;

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

    let active = true;
    withChatTimeout(supabase.auth.getSession(), 'Sign-in check').then(({ data, error }) => {
      if (!active) return;
      if (error) throw error;
      setSession(data.session || null);
      if (!data.session) setStatus('');
    }).catch((error) => {
      if (!active) return;
      setSession(null);
      setStatus('We could not check an existing sign-in automatically. You can still sign in below.');
      console.warn('Top 100 Chat session check failed:', error);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      setSession(nextSession);
      if (!nextSession) setStatus('');
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
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
    setBusy(true);
    setStatus('Sending your secure sign-in link…');
    try {
      const { error } = await withChatTimeout(
        supabase.auth.signInWithOtp({
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
        {!busy && <div className="button-row"><button type="button" onClick={() => launchChat(session.access_token)}>Try again</button><button type="button" className="secondary" onClick={signOut}>Sign out</button></div>}
      </section>
    </main>
  );
}
