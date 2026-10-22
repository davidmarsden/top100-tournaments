// Shared Web Push delivery for the Top 100 app (manager.smtop100.blog).
//
// Notifications are queued in public.manager_notifications by database triggers
// and RPCs. This claims pending rows in batches (FOR UPDATE SKIP LOCKED, so the
// pg_net wake-up and the scheduled sweep can overlap safely), pushes each one to
// the manager's registered devices and reports the outcome back.
import crypto from 'node:crypto';
import webpush from 'web-push';

const BATCH_SIZE = 100;
const TIME_BUDGET_MS = 20000;

export function pushConfig() {
  return {
    supabaseUrl: Netlify.env.get('VITE_SUPABASE_URL'),
    serviceRoleKey: Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    vapidPublicKey: Netlify.env.get('VITE_VAPID_PUBLIC_KEY'),
    vapidPrivateKey: Netlify.env.get('VAPID_PRIVATE_KEY'),
    vapidSubject: Netlify.env.get('VAPID_SUBJECT') || 'mailto:admin@smtop100.blog',
  };
}

export function missingConfig(config) {
  return ['supabaseUrl', 'serviceRoleKey', 'vapidPublicKey', 'vapidPrivateKey'].filter((key) => !config[key]);
}

export function secretsMatch(provided, expected) {
  if (!provided || !expected) return false;
  const a = crypto.createHash('sha256').update(String(provided)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function rpc(config, name, args = {}) {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(`${name}: ${data?.message || text || `HTTP ${response.status}`}`);
  return data;
}

async function deliver(notification, gone) {
  const subscriptions = (notification.subscriptions || []).filter((sub) => !gone.has(sub.endpoint));
  if (!subscriptions.length) return { id: notification.id, status: 'skipped', error: 'no registered devices' };

  const payload = JSON.stringify({
    id: notification.id,
    title: notification.title,
    body: notification.body,
    url: notification.url,
    tag: `${notification.category}-${notification.id}`,
  });

  let delivered = 0;
  let transient = '';
  await Promise.all(subscriptions.map(async (sub) => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 60 * 60 * 24, urgency: notification.category === 'opponent_actions' ? 'high' : 'normal' },
      );
      delivered += 1;
    } catch (error) {
      const status = error?.statusCode;
      if (status === 404 || status === 410) gone.add(sub.endpoint);
      else transient = `HTTP ${status || '?'}: ${String(error?.body || error?.message || error).slice(0, 300)}`;
    }
  }));

  if (delivered) return { id: notification.id, status: 'sent', error: transient || null };
  if (transient) return { id: notification.id, status: 'pending', error: transient };
  return { id: notification.id, status: 'skipped', error: 'all devices expired' };
}

export async function dispatchPending(config) {
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  const started = Date.now();
  const totals = { claimed: 0, sent: 0, skipped: 0, retrying: 0, removedDevices: 0 };

  while (Date.now() - started < TIME_BUDGET_MS) {
    const batch = await rpc(config, 'claim_pending_push_notifications', { p_limit: BATCH_SIZE });
    if (!Array.isArray(batch) || !batch.length) break;
    totals.claimed += batch.length;

    const gone = new Set();
    const results = [];
    for (const notification of batch) results.push(await deliver(notification, gone));

    await rpc(config, 'complete_push_notifications', { p_results: results, p_gone_endpoints: [...gone] });
    totals.sent += results.filter((r) => r.status === 'sent').length;
    totals.skipped += results.filter((r) => r.status === 'skipped').length;
    totals.retrying += results.filter((r) => r.status === 'pending').length;
    totals.removedDevices += gone.size;
    if (batch.length < BATCH_SIZE) break;
  }
  return totals;
}
