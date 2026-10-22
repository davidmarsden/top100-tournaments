// Woken by pg_net (public.wake_push_dispatcher) right after new notifications
// commit. Protected by the shared secret stored in Netlify and Supabase Vault.
import { dispatchPending, missingConfig, pushConfig, secretsMatch } from './lib/pushDispatch.mjs';

const json = (body, status = 200) => Response.json(body, { status });

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!secretsMatch(request.headers.get('x-top100-push-secret'), Netlify.env.get('TOP100_PUSH_DISPATCH_SECRET'))) {
    return json({ error: 'Forbidden.' }, 403);
  }
  const config = pushConfig();
  const missing = missingConfig(config);
  if (missing.length) return json({ skipped: true, reason: `Push delivery is not configured (${missing.join(', ')}).` }, 202);

  try {
    return json({ ok: true, ...(await dispatchPending(config)) });
  } catch (error) {
    return json({ error: error.message || 'Push dispatch failed.' }, 500);
  }
};
