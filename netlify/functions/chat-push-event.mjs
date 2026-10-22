// Receives reply events from the Top 100 Chat gateway (chat.smtop100.blog) so a
// reply also reaches the manager through the Top 100 app inbox and Web Push.
import { envValue, missingConfig, pushConfig, rpc, secretsMatch } from './lib/pushDispatch.mjs';

const json = (body, status = 200) => Response.json(body, { status });

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!secretsMatch(request.headers.get('x-top100-chat-event-secret'), envValue('TOP100_CHAT_EVENT_SECRET'))) {
    return json({ error: 'Forbidden.' }, 403);
  }
  const config = pushConfig();
  if (missingConfig(config).some((key) => key === 'supabaseUrl' || key === 'serviceRoleKey')) {
    return json({ skipped: true, reason: 'Supabase is not configured.' }, 202);
  }

  let event;
  try { event = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const managerId = Number(event?.managerId);
  const eventKey = String(event?.eventKey || '').trim();
  if (!Number.isSafeInteger(managerId) || managerId <= 0 || !eventKey) return json({ error: 'managerId and eventKey are required.' }, 400);

  try {
    const recipients = await rpc(config, 'enqueue_chat_reply_notification', {
      p_manager_id: managerId,
      p_author: String(event.author || '').slice(0, 120),
      p_excerpt: String(event.excerpt || '').slice(0, 400),
      p_url: String(event.url || ''),
      p_event_key: eventKey.slice(0, 200),
    });
    return json({ ok: true, recipients });
  } catch (error) {
    return json({ error: error.message || 'Chat event failed.' }, 500);
  }
};
