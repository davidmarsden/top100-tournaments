import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, private',
};

function reply(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

function database() {
  const url = String(process.env.VITE_SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('Top 100 chat SSO is not configured.');
  return createClient(url, key, { auth: { persistSession: false } });
}

function bearerToken(event) {
  const value = String(event.headers?.authorization || event.headers?.Authorization || '');
  return value.toLowerCase().startsWith('bearer ') ? value.slice(7).trim() : '';
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function signTicket(payload, secret) {
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return reply(405, { ok: false, error: 'Method not allowed.' });

  try {
    const secret = String(process.env.TOP100_CHAT_SSO_SECRET || '').trim();
    if (secret.length < 32) throw new Error('TOP100_CHAT_SSO_SECRET must be configured with at least 32 characters.');

    const token = bearerToken(event);
    if (!token) return reply(401, { ok: false, error: 'Sign in to My Matches first.' });

    const db = database();
    const { data: userData, error: userError } = await db.auth.getUser(token);
    const user = userData?.user;
    if (userError || !user?.id || !user.email) return reply(401, { ok: false, error: 'Your sign-in has expired. Sign in again.' });

    const { data: account, error: accountError } = await db
      .from('manager_portal_accounts')
      .select('auth_user_id, manager_id, game_world_id, active, managers(name, display_name), game_worlds(slug)')
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .maybeSingle();

    if (accountError) throw accountError;
    if (!account || account.game_worlds?.slug !== 'top-100') {
      return reply(403, { ok: false, error: 'Top 100 Chat is for approved Top 100 managers.' });
    }

    const now = Math.floor(Date.now() / 1000);
    const displayName = String(account.managers?.display_name || account.managers?.name || 'Top 100 manager').trim();
    const payload = {
      v: 1,
      sub: user.id,
      mid: Number(account.manager_id),
      email: user.email,
      name: displayName,
      world: 'top-100',
      iat: now,
      exp: now + 90,
      nonce: crypto.randomBytes(18).toString('base64url'),
    };

    const ticket = signTicket(payload, secret);
    const chatUrl = new URL('/auth/claim', 'https://chat.smtop100.blog');
    chatUrl.searchParams.set('ticket', ticket);

    return reply(200, { ok: true, url: chatUrl.toString() });
  } catch (error) {
    console.error('chat-ticket:', error);
    return reply(500, { ok: false, error: 'We could not open Top 100 Chat. Please try again.' });
  }
}
