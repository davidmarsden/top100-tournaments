// Announces new vacancies and newly published appointments (rule 3.2) in Top 100 Chat: one post
// per vacancy (from chat_open_vacancies()) and one per new manager, with their profile card when
// there is one (from public_appointment_decisions()). Each goes to the chat gateway's signed
// /auth/digest route, posted by the "Top 100 News" account. The gateway remembers each post's key,
// so each is announced once however often this runs. Set TOP100_CHAT_APPOINTMENTS_ENABLED to
// "false" to stop it.
import { envValue, rpc } from './lib/pushDispatch.mjs';
import { signDigest } from './lib/chatDigest.mjs';
import { appointmentKey, formatAppointmentPost, formatVacancyPost, newVacancies, recentAppointments, vacancyKey } from './lib/chatAppointments.mjs';

const WORLD = 'top-100';

export default async () => {
  const disabled = String(envValue('TOP100_CHAT_APPOINTMENTS_ENABLED') || '').toLowerCase() === 'false';
  const secret = String(envValue('TOP100_CHAT_SSO_SECRET') || '');
  const url = envValue('TOP100_CHAT_DIGEST_URL') || 'https://chat.smtop100.blog/auth/digest';
  const config = { supabaseUrl: Netlify.env.get('VITE_SUPABASE_URL'), serviceRoleKey: Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY') };
  if (disabled) return Response.json({ skipped: true, reason: 'TOP100_CHAT_APPOINTMENTS_ENABLED is false.' });
  if (!config.supabaseUrl || !config.serviceRoleKey || secret.length < 32) {
    return Response.json({ skipped: true, reason: 'Supabase or TOP100_CHAT_SSO_SECRET is not configured.' });
  }

  const send = async (key, post) => {
    const body = JSON.stringify({ key, title: post.title, markdown: post.markdown, account: 'news' });
    const { timestamp, signature } = signDigest(body, secret);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-top100-digest-timestamp': timestamp, 'x-top100-digest-signature': signature },
      body,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error || `Chat gateway returned HTTP ${response.status} for ${key}`);
    return { key, chatItemId: result.id ?? null, duplicate: Boolean(result.duplicate) };
  };

  const results = [];
  const errors = [];
  // Vacancies first, then appointments; a failure in one doesn't stop the other.
  try {
    for (const vacancy of newVacancies(await rpc(config, 'chat_open_vacancies', { p_world_slug: WORLD }))) {
      results.push(await send(vacancyKey(WORLD, vacancy), formatVacancyPost(vacancy)));
    }
  } catch (error) {
    errors.push(`vacancies: ${error.message}`);
  }
  try {
    const data = await rpc(config, 'public_appointment_decisions', { p_world_slug: WORLD });
    for (const vacancy of recentAppointments(data)) {
      results.push(await send(appointmentKey(WORLD, data.season, vacancy), formatAppointmentPost(data.season, vacancy)));
    }
  } catch (error) {
    errors.push(`appointments: ${error.message}`);
  }
  const posted = results.filter((r) => !r.duplicate).length;
  if (errors.length) {
    console.error('chat-appointments:', errors.join(' | '));
    return Response.json({ error: errors.join(' | '), posted, results }, { status: 500 });
  }
  return Response.json({ ok: true, posted, results });
};

// Every 10 minutes, so an announcement follows soon after the decision is published.
export const config = { schedule: '*/10 * * * *' };
