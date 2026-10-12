// Single sign-on bridge for My Matches (served at /auth/sso-bridge.html on admin. and tournaments.).
//
// My Matches loads this page in a hidden iframe and asks, by postMessage, whether this site has a
// signed-in Top 100 user. If so, the page mints a one-time handoff code (2-minute, single use) with
// create_manager_auth_handoff('manager') and returns ONLY that code. My Matches exchanges it for its
// own independent session; this site's session tokens never leave this site.
//
// Deliberately tiny: no React, no supabase-js, no app bundle, so it answers quickly on phones.

const ALLOWED_PARENTS = new Set(['https://manager.smtop100.blog']);
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL || '').trim().replace(/\/$/, '');
const ANON_KEY = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();
const PROJECT_REF = (() => { try { return new URL(SUPABASE_URL).hostname.split('.')[0]; } catch { return ''; } })();
const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;
const REFRESH_MARGIN_S = 60;

function sessionIdOf(accessToken) {
  try {
    const part = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part.padEnd(Math.ceil(part.length / 4) * 4, '='))).session_id || null;
  } catch { return null; }
}

function readSession() {
  try {
    const value = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    return value?.refresh_token ? value : null;
  } catch { return null; }
}

// Renew an expired access token the same way supabase-js does, and store the result where
// supabase-js reads it, so this site's own tabs carry on with the renewed session.
async function freshSession(stored) {
  const now = Math.floor(Date.now() / 1000);
  if (stored.access_token && (stored.expires_at || 0) > now + REFRESH_MARGIN_S) return stored;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: stored.refresh_token }),
  });
  if (!response.ok) return null;
  const renewed = await response.json();
  if (!renewed?.access_token) return null;
  const session = { ...renewed, expires_at: renewed.expires_at || now + (renewed.expires_in || 3600) };
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch { /* ignore */ }
  return session;
}

async function mintHandoffCode(session) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_manager_auth_handoff`, {
    method: 'POST',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ target_destination: 'manager' }),
  });
  if (!response.ok) return null; // e.g. signed in but no active manager account
  const code = await response.json();
  return /^[a-f0-9]{64}$/.test(code) ? code : null;
}

async function answer(request) {
  if (!SUPABASE_URL || !ANON_KEY) return { status: 'unavailable' };
  const stored = readSession();
  if (!stored) return { status: 'signed-out' };
  // My Matches tells us which session the user explicitly signed out of; never re-issue for it.
  const sourceSessionId = sessionIdOf(stored.access_token || '');
  if (request.suppressSessionId && sourceSessionId && request.suppressSessionId === sourceSessionId) {
    return { status: 'suppressed' };
  }
  const session = await freshSession(stored);
  if (!session) return { status: 'signed-out' };
  const code = await mintHandoffCode(session);
  return code ? { status: 'ok', code, sourceSessionId: sessionIdOf(session.access_token) } : { status: 'no-manager-account' };
}

window.addEventListener('message', async (event) => {
  // Trust the browser-supplied event.origin (not document.referrer, which browsers may strip),
  // and only answer our direct parent.
  if (!ALLOWED_PARENTS.has(event.origin) || event.source !== window.parent) return;
  if (event.data?.type !== 'top100-sso-request') return;
  let reply;
  try { reply = await answer(event.data); } catch { reply = { status: 'error' }; }
  event.source.postMessage({ type: 'top100-sso-response', nonce: event.data.nonce, ...reply }, event.origin);
});

// Tell the parent we are ready to receive its request.
if (window.parent !== window) {
  ALLOWED_PARENTS.forEach((origin) => window.parent.postMessage({ type: 'top100-sso-ready' }, origin));
}
