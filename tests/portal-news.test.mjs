import test from 'node:test';
import assert from 'node:assert/strict';
import { digestItems, digestWindow, formatDigest, marketLine, parseFeed } from '../netlify/functions/lib/portalNews.mjs';

const feed = `<rss><channel>
<item><title>Four Top 100 clubs need new managers</title><link>https://smtop100.blog/2026/11/12/four/</link><pubDate>Thu, 12 Nov 2026 14:35:56 +0000</pubDate></item>
<item><title>Old &amp; gold</title><link>https://smtop100.blog/2026/11/01/old/</link><pubDate>Sun, 01 Nov 2026 10:00:00 +0000</pubDate></item>
<item><title></title><link>https://smtop100.blog/2026/11/12/photo/</link><pubDate>Thu, 12 Nov 2026 15:00:00 +0000</pubDate></item>
</channel></rss>`;

test('reads titled posts from the blog feed', () => {
  const posts = parseFeed(feed);
  assert.deepEqual(posts.map((p) => p.title), ['Four Top 100 clubs need new managers', 'Old & gold']);
  assert.equal(posts[0].link, 'https://smtop100.blog/2026/11/12/four/');
});

test('the digest window is the 24 hours to 18:00 UK time, once it has passed', () => {
  assert.equal(digestWindow(new Date('2026-11-12T17:59:00Z')), null);
  const winter = digestWindow(new Date('2026-11-12T18:10:00Z'));
  assert.equal(winter.day, '2026-11-12');
  assert.equal(new Date(winter.end).toISOString(), '2026-11-12T18:00:00.000Z');
  assert.equal(new Date(winter.start).toISOString(), '2026-11-11T18:00:00.000Z');
  const summer = digestWindow(new Date('2026-07-01T17:05:00Z'));
  assert.equal(new Date(summer.end).toISOString(), '2026-07-01T17:00:00.000Z', '18:00 BST');
  assert.equal(digestWindow(new Date('2026-07-01T16:55:00Z')), null);
});

test('one digest of new posts, new managers and votes; nothing when nothing is new', () => {
  const window = digestWindow(new Date('2026-11-12T18:10:00Z'));
  const appointmentData = { season: 28, vacancies: [
    { id: 17, club: 'Udinese Calcio', division: 1, appointed: 'Giuseppe Trovato', publishedAt: '2026-11-12T14:05:51Z' },
    { id: 9, club: 'Old Club', division: 2, appointed: 'Someone', publishedAt: '2026-11-08T10:00:00Z' },
  ] };
  const votes = [{ title: 'S28 Awards', event_type: 'awards', opens_at: '2026-11-12T09:00:00Z', closes_at: '2026-11-15T12:00:00Z' },
    { title: 'Old poll', event_type: 'poll', opens_at: '2026-09-26T17:00:00Z' }];
  const items = digestItems({ posts: parseFeed(feed), appointmentData, votes }, window);
  const digest = formatDigest(items);
  assert.equal(digest.title, 'Top 100 today: 1 new post, 1 new manager, voting open');
  assert.match(digest.body, /^On the blog: Four Top 100 clubs need new managers\. New manager: Giuseppe Trovato at Udinese Calcio\. Voting open: S28 Awards \(closes Sun 15 Nov\)\.$/);
  assert.equal(digest.url, 'https://smtop100.blog/2026/11/12/four/');
  assert.ok(digest.body.length <= 600);
  assert.equal(formatDigest(digestItems({ posts: parseFeed(feed) }, digestWindow(new Date('2026-11-20T18:10:00Z')))), null);
});

test('adds the transfer market, as in the Chat market post', () => {
  const market = { deals: 19, totalValue: 181023000, totalFees: 88889000, newlyListedCount: 14,
    biggest: [{ player: 'G.SIMEONE', rating: 91, from: 'Sampdoria', to: 'Hellas Verona' }],
    board: { wanted: 2, offered: 1, open: 3 }, newsfeed: [{ manager: 'Kevin Trapp', club: 'AC Milan', message: 'Looking for a striker' }] };
  const line = marketLine(market);
  assert.match(line, /^Transfer market: 19 deals worth £181\.0m, biggest G\. Simeone \(91\) Sampdoria → Hellas Verona; 14 new on the transfer list; 2 wanted and 1 offered on the transfer board; newsfeed: Kevin Trapp \(AC Milan\): "Looking for a striker"\.$/);
  assert.equal(marketLine({ deals: 0, board: {} }), '');
  const only = formatDigest({ posts: [], appointments: [], votes: [], market: line });
  assert.equal(only.title, 'Top 100 today: transfer news');
  assert.equal(only.url, 'https://manager.smtop100.blog/');
});
