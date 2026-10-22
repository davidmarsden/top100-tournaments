// Every five minutes: queue day-before / fixture-day reminders (from 08:00 UK
// time, idempotent per fixture and day) and retry anything still pending.
import { dispatchPending, missingConfig, pushConfig, rpc } from './lib/pushDispatch.mjs';

const json = (body, status = 200) => Response.json(body, { status });

export default async () => {
  const config = pushConfig();
  const missing = missingConfig(config);
  if (missing.length) return json({ skipped: true, reason: `Push delivery is not configured (${missing.join(', ')}).` }, 202);

  try {
    const reminders = await rpc(config, 'enqueue_due_fixture_reminders');
    return json({ ok: true, reminders, ...(await dispatchPending(config)) });
  } catch (error) {
    return json({ error: error.message || 'Scheduled push dispatch failed.' }, 500);
  }
};

export const config = { schedule: '*/5 * * * *' };
