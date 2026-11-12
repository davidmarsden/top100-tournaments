// Manager Portal news, every 10 minutes:
// - each new vacancy notifies every manager once it has settled (notify_new_vacancies());
// - after 18:00 UK time, one evening digest per manager of the day's new blog posts, new managers
//   and votes opening (lib/portalNews.mjs, enqueue_news_digest()). The dedupe key makes it once a
//   day; a day with nothing new sends nothing.
// push-dispatch-scheduled.mjs sends the queued notifications. Set TOP100_PORTAL_NEWS_ENABLED to
// "false" to stop both.
import { envValue, rpc } from './lib/pushDispatch.mjs';
import { BLOG_FEED_URL, digestItems, digestWindow, formatDigest, parseFeed } from './lib/portalNews.mjs';

const WORLD = 'top-100';

export default async () => {
  if (String(envValue('TOP100_PORTAL_NEWS_ENABLED') || '').toLowerCase() === 'false') {
    return Response.json({ skipped: true, reason: 'TOP100_PORTAL_NEWS_ENABLED is false.' });
  }
  const config = { supabaseUrl: Netlify.env.get('VITE_SUPABASE_URL'), serviceRoleKey: Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY') };
  if (!config.supabaseUrl || !config.serviceRoleKey) return Response.json({ skipped: true, reason: 'Supabase is not configured.' });

  const errors = [];
  let vacancies = null;
  try {
    vacancies = await rpc(config, 'notify_new_vacancies', { p_world_slug: WORLD });
  } catch (error) {
    errors.push(`vacancies: ${error.message}`);
  }

  let digest = null;
  const window = digestWindow();
  if (window) {
    try {
      // Any source failing fails the run, so the next run (10 minutes later) tries again: a digest
      // is sent once a day, so it must never go out with a source missing.
      const ok = (label) => (response) => {
        if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
        return response;
      };
      const [feed, appointmentData, votes] = await Promise.all([
        fetch(BLOG_FEED_URL, { headers: { 'user-agent': 'Top100PortalNews/1.0' } }).then(ok('blog feed')).then((r) => r.text()),
        rpc(config, 'public_appointment_decisions', { p_world_slug: WORLD }),
        fetch(`${config.supabaseUrl}/rest/v1/voting_events?select=title,event_type,status,opens_at,closes_at&status=in.(open,closed)&event_type=in.(awards,poll)`, {
          headers: { apikey: config.serviceRoleKey, Authorization: `Bearer ${config.serviceRoleKey}` },
        }).then(ok('voting_events')).then((r) => r.json()),
      ]);
      const notification = formatDigest(digestItems({ posts: parseFeed(feed), appointmentData, votes }, window));
      digest = notification
        ? { day: window.day, queued: await rpc(config, 'enqueue_news_digest', { p_day: window.day, p_title: notification.title, p_body: notification.body, p_url: notification.url }) }
        : { day: window.day, queued: 0, reason: 'nothing new' };
    } catch (error) {
      errors.push(`digest: ${error.message}`);
    }
  }

  if (errors.length) {
    console.error('portal-news:', errors.join(' | '));
    return Response.json({ error: errors.join(' | '), vacancies, digest }, { status: 500 });
  }
  return Response.json({ ok: true, vacancies, digest });
};

export const config = { schedule: '*/10 * * * *' };
