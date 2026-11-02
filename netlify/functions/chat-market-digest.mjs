// Daily Top 100 Chat market digest: reads chat_market_digest() for Top 100, writes a short post
// and sends it to the chat gateway (chat.smtop100.blog/auth/digest), signed with the shared
// TOP100_CHAT_SSO_SECRET. Posts only when TOP100_CHAT_DIGEST_ENABLED is "true" and there is
// something new; records each posted digest so the next one starts where it ended.
import { envValue, rpc } from './lib/pushDispatch.mjs';
import { digestKey, formatMarketDigest, hasNews, signDigest } from './lib/chatDigest.mjs';

const WORLD = 'top-100';

export default async () => {
  const enabled = String(envValue('TOP100_CHAT_DIGEST_ENABLED') || '').toLowerCase() === 'true';
  const secret = String(envValue('TOP100_CHAT_SSO_SECRET') || '');
  const url = envValue('TOP100_CHAT_DIGEST_URL') || 'https://chat.smtop100.blog/auth/digest';
  const config = { supabaseUrl: Netlify.env.get('VITE_SUPABASE_URL'), serviceRoleKey: Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY') };
  if (!enabled) return Response.json({ skipped: true, reason: 'TOP100_CHAT_DIGEST_ENABLED is not true.' });
  if (!config.supabaseUrl || !config.serviceRoleKey || secret.length < 32) {
    return Response.json({ skipped: true, reason: 'Supabase or TOP100_CHAT_SSO_SECRET is not configured.' });
  }

  try {
    const now = new Date();
    const digest = await rpc(config, 'chat_market_digest', { p_world_slug: WORLD });
    if (!hasNews(digest)) return Response.json({ skipped: true, reason: 'Nothing new since the last digest.' });

    const key = digestKey(WORLD, now);
    const post = formatMarketDigest(digest, now);
    const body = JSON.stringify({ key, title: post.title, markdown: post.markdown, from: digest.from, to: digest.to });
    const { timestamp, signature } = signDigest(body, secret);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-top100-digest-timestamp': timestamp, 'x-top100-digest-signature': signature },
      body,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || `Chat gateway returned HTTP ${response.status}`);

    // A repeat of a key the chat already posted (a retried run) records the period of the post
    // that was actually published, so nothing between that post and this run is skipped.
    await rpc(config, 'record_chat_market_digest', {
      p_world_slug: WORLD, p_digest_key: key, p_from: result.from || digest.from, p_to: result.to || digest.to,
      p_chat_item_id: result.id == null ? null : String(result.id),
      p_summary: { deals: digest.deals, totalFees: digest.totalFees, newlyListed: digest.newlyListedCount, duplicate: Boolean(result.duplicate) },
    });
    return Response.json({ ok: true, key, chatItemId: result.id ?? null, duplicate: Boolean(result.duplicate) });
  } catch (error) {
    console.error('chat-market-digest:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
};

// Daily at 18:41 UTC (early evening in the UK), when managers are most active.
export const config = { schedule: '41 18 * * *' };
