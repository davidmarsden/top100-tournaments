import { createClient } from '@supabase/supabase-js';

// GET /.netlify/functions/transfer-bans: the public register of transfer bans (bans in force or
// ended since September 2026, with their required sales), read by the blog's daily rebuild of
// smtop100.blog/transfer-bans/. Same details the Transfer Bans page has always published.

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
      'access-control-allow-origin': '*',
    },
  });
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
  const url = Netlify.env.get('VITE_SUPABASE_URL');
  const key = Netlify.env.get('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) return json({ error: 'Supabase public server configuration is missing.' }, 500);

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await supabase.rpc('public_transfer_ban_register', { p_world_slug: 'top-100' });
  if (error) return json({ error: error.message }, 502);
  return json({ asOf: new Date().toISOString().slice(0, 10), bans: data || [] });
};
