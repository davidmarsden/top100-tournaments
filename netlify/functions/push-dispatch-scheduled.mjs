// Every five minutes: queue day-before / fixture-day reminders (from 08:00 UK
// time, idempotent per fixture and day) and retry anything still pending.
import { dispatchPending, missingConfig, pushConfig, rpc } from './lib/pushDispatch.mjs';

const json = (body, status = 200) => Response.json(body, { status });

export default async () => {
  const config = pushConfig();
  const missing = missingConfig(config);
  if (missing.includes('supabaseUrl') || missing.includes('serviceRoleKey')) {
    return json({ skipped: true, reason: 'Supabase is not configured.' }, 202);
  }

  try {
    // Reminders go to the in-app inbox even when Web Push isn't configured.
    const reminders = await rpc(config, 'enqueue_due_fixture_reminders');
    if (missing.length) return json({ ok: true, reminders, push: `not configured (${missing.join(', ')})` });
    return json({ ok: true, reminders, ...(await dispatchPending(config)) });
  } catch (error) {
    return json({ error: error.message || 'Scheduled push dispatch failed.' }, 500);
  }
};

export const config = { schedule: '*/5 * * * *' };
