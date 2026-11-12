// The Manager Portal's evening news digest (category "news"): new blog posts, new managers and votes
// opening in the 24 hours to 18:00 UK time, in one notification per manager per day. Built by
// netlify/functions/portal-news.mjs and queued with enqueue_news_digest().
import { recentAppointments } from './chatAppointments.mjs';

export const BLOG_FEED_URL = 'https://smtop100.blog/feed.xml';
export const DIGEST_HOUR = 18;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#34': '"' };
const decode = (text) => String(text || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (match, code) => {
    if (code[0] === '#') return String.fromCodePoint(code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : Number(code.slice(1)));
    return ENTITIES[code.toLowerCase()] ?? match;
  })
  .replace(/\s+/g, ' ')
  .trim();

const tag = (item, name) => (item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i')) || [])[1] || '';

// Posts from the blog's RSS feed: { title, link, published (ms) }. Untitled posts are skipped.
export function parseFeed(xml) {
  return (String(xml || '').match(/<item>[\s\S]*?<\/item>/gi) || [])
    .map((item) => ({ title: decode(tag(item, 'title')), link: decode(tag(item, 'link')), published: Date.parse(decode(tag(item, 'pubDate'))) }))
    .filter((post) => post.title && Number.isFinite(post.published));
}

// Minutes London is ahead of UTC at a moment (0 in winter, 60 in summer).
function londonOffsetMinutes(at) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(at).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return Math.round((asUtc - Math.floor(at.getTime() / 60000) * 60000) / 60000);
}

// Today's digest window, the 24 hours to 18:00 UK time, once that time has passed; null before it.
export function digestWindow(now = new Date()) {
  const at = new Date(now);
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  const naive = Date.parse(`${day}T${String(DIGEST_HOUR).padStart(2, '0')}:00:00Z`);
  const end = naive - londonOffsetMinutes(new Date(naive)) * 60000;
  if (at.getTime() < end) return null;
  return { day, start: end - 24 * 60 * 60 * 1000, end };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const closing = (value) => new Date(value).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });

// Everything new in the window. appointmentData is public_appointment_decisions(); votes are open
// awards and polls ({ title, event_type, opens_at, closes_at }).
export function digestItems({ posts = [], appointmentData = null, votes = [] }, window) {
  const inWindow = (time) => Number.isFinite(time) && time >= window.start && time < window.end;
  return {
    posts: posts.filter((post) => inWindow(post.published)).sort((a, b) => a.published - b.published),
    appointments: recentAppointments(appointmentData, new Date(window.end), 1).filter((vacancy) => inWindow(Date.parse(vacancy.publishedAt))),
    votes: votes.filter((vote) => ['awards', 'poll'].includes(vote.event_type) && inWindow(Date.parse(vote.opens_at))),
  };
}

// The notification, or null when there's nothing new.
export function formatDigest({ posts, appointments, votes }) {
  const counts = [];
  const lines = [];
  if (posts.length) {
    counts.push(plural(posts.length, 'new post'));
    lines.push(`On the blog: ${posts.map((post) => post.title).join('; ')}.`);
  }
  if (appointments.length) {
    counts.push(plural(appointments.length, 'new manager'));
    lines.push(`${appointments.length === 1 ? 'New manager' : 'New managers'}: ${appointments.map((v) => `${v.appointed} at ${v.club}`).join('; ')}.`);
  }
  if (votes.length) {
    counts.push(votes.length === 1 ? 'voting open' : `${votes.length} votes open`);
    lines.push(`Voting open: ${votes.map((v) => `${v.title}${v.closes_at ? ` (closes ${closing(v.closes_at)})` : ''}`).join('; ')}.`);
  }
  if (!lines.length) return null;
  let body = lines.join(' ');
  if (body.length > 600) body = `${body.slice(0, 599)}…`;
  const url = posts.length ? (posts.length === 1 ? posts[0].link : 'https://smtop100.blog/')
    : appointments.length ? 'https://tournaments.smtop100.blog/appointments'
      : votes.some((v) => v.event_type === 'awards') ? 'https://awards.smtop100.blog/vote' : 'https://vote.smtop100.blog/';
  return { title: `Top 100 today: ${counts.join(', ')}`, body, url };
}
