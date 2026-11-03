#!/usr/bin/env node
// Private feed links: a read-only URL for one manager's own rss.chat feed
// (/users/manager<ID>/rss.xml), for readers that can't sign in to Top 100 Chat,
// such as a feed reader or an assistant. The token is an HMAC of the manager id with a key
// derived from TOP100_CHAT_SSO_SECRET, so it can't be guessed. Changing
// TOP100_CHAT_FEED_SALT revokes every link at once.
//
// Print a link on the Droplet:
//   set -a; . /etc/top100-chat.env; set +a; node /opt/top100-chat/feed-link.mjs 108
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const FEED_PATH = /^\/feed\/(\d{1,12})\/([A-Za-z0-9_-]{43})\.xml$/;

export function feedKey(ssoSecret, salt = '') {
  return crypto.createHmac('sha256', String(ssoSecret)).update(`top100-chat-feed-v1:${salt}`).digest();
}

export function feedToken(managerId, key) {
  return crypto.createHmac('sha256', key).update(`feed:${Number(managerId)}`).digest('base64url');
}

// The manager id for a valid /feed/<id>/<token>.xml path, or null.
export function verifyFeedPath(pathname, key) {
  const match = FEED_PATH.exec(String(pathname || ''));
  if (!match) return null;
  const managerId = Number(match[1]);
  if (!Number.isSafeInteger(managerId) || managerId <= 0) return null;
  const expected = Buffer.from(feedToken(managerId, key));
  const given = Buffer.from(match[2]);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? managerId : null;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const managerId = Number(process.argv[2]);
  const secret = String(process.env.TOP100_CHAT_SSO_SECRET || '');
  if (!Number.isSafeInteger(managerId) || managerId <= 0) {
    console.error('Usage: node feed-link.mjs <manager id>   (the number in /users/manager<ID>/rss.xml)');
    process.exit(1);
  }
  if (secret.length < 32) {
    console.error('TOP100_CHAT_SSO_SECRET is not set. Run: set -a; . /etc/top100-chat.env; set +a');
    process.exit(1);
  }
  const base = String(process.env.TOP100_CHAT_PUBLIC_URL || 'https://chat.smtop100.blog').replace(/\/$/, '');
  const key = feedKey(secret, String(process.env.TOP100_CHAT_FEED_SALT || ''));
  console.log(`${base}/feed/${managerId}/${feedToken(managerId, key)}.xml`);
}
