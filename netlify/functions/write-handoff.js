// "Write for Top 100": signs a manager who is already signed in to the Manager Portal straight in to
// the Publishing Desk (write.smtop100.blog), so they don't sign in twice. Both use the same Supabase
// accounts but keep separate sessions, one per site. This checks the Portal session, then makes a
// one-time sign-in token for the same account (no email is sent) and returns the Desk link with it
// in the URL fragment. The Desk exchanges it for its own session (supabase.auth.verifyOtp) and
// removes it from the address bar. The Desk still checks the account is an approved manager.
import { createClient } from '@supabase/supabase-js';

const DESK_URL = 'https://write.smtop100.blog/';
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' };

const reply = (statusCode, body) => ({ statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) });

function database() {
  const url = String(process.env.VITE_SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('The Publishing Desk sign-in is not configured.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function bearerToken(event) {
  const value = String(event.headers?.authorization || event.headers?.Authorization || '');
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method not allowed.' });
  try {
    const token = bearerToken(event);
    if (!token) return reply(401, { ok: false, error: 'Sign in to the Manager Portal first.' });

    const db = database();
    const { data: userData, error: userError } = await db.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user?.id || !user.email) return reply(401, { ok: false, error: 'Your sign-in has expired. Sign in again.' });

    const { data: account, error: accountError } = await db
      .from('manager_portal_accounts')
      .select('manager_id')
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .limit(1)
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) return reply(403, { ok: false, error: 'Writing for Top 100 needs an approved manager account.' });

    const { data: link, error: linkError } = await db.auth.admin.generateLink({ type: 'magiclink', email: user.email });
    const hashedToken = link?.properties?.hashed_token;
    if (linkError || !hashedToken) throw linkError || new Error('No sign-in token was returned.');

    return reply(200, { ok: true, url: `${DESK_URL}#handoff=${encodeURIComponent(hashedToken)}` });
  } catch (error) {
    console.error('write-handoff:', error);
    return reply(500, { ok: false, error: 'We could not open the Publishing Desk. Please try again.' });
  }
}
