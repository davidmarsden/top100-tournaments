// Takes back appointment announcements so the Chat job posts them again, e.g. when profile cards
// were added after the first posts went out. Run as root on the chat server:
//
//   set -a; . /etc/top100-chat.env; set +a
//   node /opt/top100-chat/repost-appointments.mjs 28 13 14 15 16
//
// (season, then the vacancy ids). For each vacancy it deletes the "Top 100 News" post recorded under
// top-100:appointment:s<season>:v<id> (rss.chat /deletepost, over loopback) and forgets the key, so
// netlify/functions/chat-appointments.mjs announces it again on its next run (every 10 minutes,
// within three days of publishing), now with the profile card. Add --dry-run to only list them.
import fs from 'node:fs';
import http from 'node:http';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [season, ...ids] = args.filter((arg) => arg !== '--dry-run').map(Number);
if (!Number.isInteger(season) || !ids.length || ids.some((id) => !Number.isInteger(id))) {
  console.error('Usage: node repost-appointments.mjs <season> <vacancy id>... [--dry-run]');
  process.exit(1);
}

const rssChatPort = Number(process.env.TOP100_CHAT_RSS_PORT || 1430);
const storePath = String(process.env.TOP100_CHAT_DIGEST_STORE || '/var/lib/top100-chat/digests.json');
const newsBot = {
  managerId: Number(process.env.TOP100_CHAT_NEWS_BOT_ID || 900000002),
  email: String(process.env.TOP100_CHAT_NEWS_BOT_EMAIL || 'news@smtop100.blog'),
  name: 'Top 100 News',
};

const call = (url, method = 'GET') => new Promise((resolve, reject) => {
  const request = http.request(url, { method, timeout: 15000 }, (response) => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', (chunk) => { body += chunk; });
    response.on('end', () => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`${url.pathname} returned ${response.statusCode}: ${body.slice(0, 200)}`));
        return;
      }
      try { resolve(JSON.parse(body)); } catch { resolve(body); }
    });
  });
  request.on('timeout', () => request.destroy(new Error(`${url.pathname} timed out.`)));
  request.on('error', reject);
  request.end();
});

const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
const keys = ids.map((id) => `top-100:appointment:s${season}:v${id}`);
const found = keys.filter((key) => store[key]);
for (const key of keys) console.log(store[key] ? `${key}: chat item ${store[key].id}, posted ${store[key].at}` : `${key}: not posted (nothing to do)`);
if (dryRun || !found.length) process.exit(0);

const helper = new URL(`http://127.0.0.1:${rssChatPort}/localtop100sso`);
helper.searchParams.set('managerid', String(newsBot.managerId));
helper.searchParams.set('email', newsBot.email);
helper.searchParams.set('displayname', newsBot.name);
const bot = await call(helper);
if (!bot?.emailAddress || !bot?.emailSecret) throw new Error('rss.chat did not return the Top 100 News account.');

for (const key of found) {
  if (store[key].id != null) {
    const remove = new URL(`http://127.0.0.1:${rssChatPort}/deletepost`);
    remove.searchParams.set('emailaddress', bot.emailAddress);
    remove.searchParams.set('emailcode', bot.emailSecret);
    remove.searchParams.set('id', String(store[key].id));
    try {
      const result = await call(remove, 'POST');
      if (result && typeof result === 'object' && result.message && result.id == null) throw new Error(result.message);
      console.log(`${key}: deleted chat item ${store[key].id}`);
    } catch (error) {
      console.error(`${key}: could not delete chat item ${store[key].id} (${error.message}); kept, not reposted`);
      continue;
    }
  }
  // Re-read before writing, so a post the gateway made meanwhile isn't lost.
  const latest = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  delete latest[key];
  const temporary = `${storePath}.tmp`;
  const { uid, gid } = fs.statSync(storePath);
  fs.writeFileSync(temporary, JSON.stringify(latest), { mode: 0o600 });
  // Keep the gateway's ownership (www-data), or it could no longer record new posts.
  fs.chownSync(temporary, uid, gid);
  fs.renameSync(temporary, storePath);
  console.log(`${key}: forgotten; the Chat job will announce it again within 10 minutes`);
}
