// Every five minutes: queue day-before / fixture-day reminders (from 08:00 UK
// time, idempotent per fixture and day), the daily "sync due" admin reminder
// (from 09:00 UK time when the last sync is over a day old), squad-limit alerts
// (once per breach), Gold membership and login alerts (once per change or
// threshold) and retry anything still pending.
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
    // Optional: never let the admin reminder block fixture reminders or retries.
    const syncReminders = await rpc(config, 'enqueue_sync_due_reminders').catch((error) => ({ error: error.message }));
    const squadCapAlerts = await rpc(config, 'enqueue_squad_cap_alerts').catch((error) => ({ error: error.message }));
    const managerStatusAlerts = await rpc(config, 'enqueue_manager_status_alerts').catch((error) => ({ error: error.message }));
    const alerts = { reminders, syncReminders, squadCapAlerts, managerStatusAlerts };
    if (missing.length) return json({ ok: true, ...alerts, push: `not configured (${missing.join(', ')})` });
    return json({ ok: true, ...alerts, ...(await dispatchPending(config)) });
  } catch (error) {
    return json({ error: error.message || 'Scheduled push dispatch failed.' }, 500);
  }
};

export const config = { schedule: '*/5 * * * *' };
