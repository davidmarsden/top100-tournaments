#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const host = process.env.TOP100_CHAT_GATEWAY_HOST || '127.0.0.1';
const port = Number(process.env.TOP100_CHAT_GATEWAY_PORT || 1470);
const rssChatPort = Number(process.env.TOP100_CHAT_RSS_PORT || 1430);
const ssoSecret = String(process.env.TOP100_CHAT_SSO_SECRET || '');
const vapidPublicKey = String(process.env.TOP100_CHAT_VAPID_PUBLIC_KEY || '');
const vapidPrivateKey = String(process.env.TOP100_CHAT_VAPID_PRIVATE_KEY || '');
const vapidSubject = String(process.env.TOP100_CHAT_VAPID_SUBJECT || 'mailto:admin@smtop100.blog');
const pushStorePath = String(process.env.TOP100_CHAT_PUSH_STORE || '/var/lib/top100-chat/push-subscriptions.json');
const maxPushSubscriptionsPerManager = 8;
const maxPushSubscriptionsTotal = 500;
const cookieSecret = crypto.createHmac('sha256', ssoSecret).update('top100-chat-cookie-v1').digest();
const cookieName = 'top100_chat_session';
const sessionLifetimeSeconds = Number(process.env.TOP100_CHAT_SESSION_SECONDS || 43200);
const here = path.dirname(fileURLToPath(import.meta.url));
const shellHtml = fs.readFileSync(path.join(here, 'shell.html'), 'utf8');
const clientThemeCss = fs.readFileSync(path.join(here, 'client-theme.css'), 'utf8');
const clientBrandJs = fs.readFileSync(path.join(here, 'client-brand.js'), 'utf8');
const usedNonces = new Map();
const upstreamClientHome = 'https://code.scripting.com/rsschat/index.html';
let clientHomeCache = '';
let pushSubscriptions = [];

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
}

const pwaManifest = JSON.stringify({
  name: 'Top 100 Chat',
  short_name: 'Top 100 Chat',
  description: 'Private chat for approved Top 100 Soccer Manager World managers.',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#071526',
  theme_color: '#0B1F3B',
  icons: [
    {
      src: '/top100-chat-icon.svg',
      sizes: 'any',
      type: 'image/svg+xml',
      purpose: 'any maskable',
    },
  ],
});

const pwaIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#0B1F3B"/>
  <path d="M78 362h356" stroke="#CBD5E1" stroke-width="16" stroke-linecap="round"/>
  <circle cx="256" cy="362" r="38" fill="#0B1F3B" stroke="#CBD5E1" stroke-width="16"/>
  <text x="256" y="278" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="174" font-weight="800" fill="#10B981">100</text>
  <text x="256" y="430" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="52" font-weight="700" fill="#F8FAFC">CHAT</text>
</svg>`;

const pwaServiceWorker = `'use strict';

// Top 100 Chat is private and live. Deliberately do not cache navigations,
// API responses, feeds, threads or other chat content.
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (key) { return key.indexOf('top100-chat-') === 0; })
            .map(function (key) { return caches.delete(key); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('push', function (event) {
  var payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch (e) {}
  var title = payload.title || 'Top 100 Chat';
  var options = {
    body: payload.body || 'You have a new reply.',
    icon: '/top100-chat-icon.svg',
    badge: '/top100-chat-icon.svg',
    tag: payload.tag || 'top100-chat-reply',
    data: { url: payload.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
      for (var i = 0; i < clients.length; i += 1) {
        var client = clients[i];
        if ('focus' in client) {
          if ('navigate' in client) return client.navigate(target).then(function () { return client.focus(); });
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
`;

if (ssoSecret.length < 32) {
  console.error('TOP100_CHAT_SSO_SECRET must be at least 32 characters.');
  process.exit(1);
}


function loadPushSubscriptions() {
  try {
    const parsed = JSON.parse(fs.readFileSync(pushStorePath, 'utf8'));
    pushSubscriptions = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('push store load:', error.message);
    pushSubscriptions = [];
  }
}

function savePushSubscriptions() {
  const dir = path.dirname(pushStorePath);
  fs.mkdirSync(dir, { recursive: true });
  const temp = pushStorePath + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(pushSubscriptions, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temp, pushStorePath);
}

function readJsonBody(request, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        reject(new Error('Request body too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('Invalid JSON body.')); }
    });
    request.on('error', reject);
  });
}

function getSessionForRequest(request) {
  return verifySession(parseCookies(request)[cookieName]);
}

function normalizeSubscription(value) {
  if (!value || typeof value !== 'object') return null;
  const endpoint = String(value.endpoint || '').trim();
  const p256dh = String(value.keys?.p256dh || '').trim();
  const auth = String(value.keys?.auth || '').trim();
  try {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== 'https:') return null;
  } catch {
    return null;
  }
  if (!p256dh || !auth || endpoint.length > 2048 || p256dh.length > 256 || auth.length > 128) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(p256dh) || !/^[A-Za-z0-9_-]+$/.test(auth)) return null;
  return { endpoint, expirationTime: value.expirationTime ?? null, keys: { p256dh, auth } };
}

function isLoopback(request) {
  const address = request.socket.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function cleanNotificationText(value, max = 180) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

async function sendReplyPush(event) {
  const recipientMatch = /^manager(\d+)$/.exec(String(event.recipientScreenname || ''));
  const senderMatch = /^manager(\d+)$/.exec(String(event.senderScreenname || ''));
  if (!recipientMatch) return;
  const managerId = Number(recipientMatch[1]);
  if (senderMatch && Number(senderMatch[1]) === managerId) return;

  const replyId = Number(event.replyId);
  const senderName = cleanNotificationText(event.senderName, 120) || 'A Top 100 manager';
  const body = cleanNotificationText(event.excerpt, 180) || 'replied to your post.';
  const payload = JSON.stringify({
    title: senderName + ' replied in Top 100 Chat',
    body,
    url: Number.isInteger(replyId) && replyId > 0 ? '/?id=' + replyId : '/',
    tag: Number.isInteger(replyId) && replyId > 0 ? 'top100-chat-reply-' + replyId : 'top100-chat-reply'
  });

  const nowSeconds = Math.floor(Date.now() / 1000);
  const targets = pushSubscriptions.filter((entry) =>
    Number(entry.managerId) === managerId &&
    Number(entry.sessionExp || 0) > nowSeconds
  );
  for (const entry of targets) {
    const stillRegistered = pushSubscriptions.some((candidate) =>
      candidate.endpoint === entry.endpoint &&
      Number(candidate.managerId) === managerId &&
      Number(candidate.sessionExp || 0) > Math.floor(Date.now() / 1000)
    );
    if (!stillRegistered) continue;

    try {
      await webpush.sendNotification(entry.subscription, payload, { TTL: 3600 });
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        pushSubscriptions = pushSubscriptions.filter((candidate) => candidate.endpoint !== entry.endpoint);
        savePushSubscriptions();
      } else {
        console.error('push send:', error.statusCode || '', error.message);
      }
    }
  }
}

loadPushSubscriptions();

function cleanExpiredNonces() {
  const now = Math.floor(Date.now() / 1000);
  for (const [nonce, expiry] of usedNonces) if (expiry <= now) usedNonces.delete(nonce);
}

function timingSafeEqualText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifySignedValue(value, secret, maxVersion = 1) {
  const [encoded, signature] = String(value || '').split('.');
  if (!encoded || !signature) throw new Error('Malformed signed value.');
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (!timingSafeEqualText(signature, expected)) throw new Error('Invalid signature.');
  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!payload || Number(payload.v) > maxVersion) throw new Error('Unsupported signed value.');
  return payload;
}

function signSession(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', cookieSecret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifySession(value) {
  const payload = verifySignedValue(value, cookieSecret);
  const now = Math.floor(Date.now() / 1000);
  if (payload.world !== 'top-100' || !payload.sub || !payload.mid || Number(payload.exp) <= now) throw new Error('Expired session.');
  return payload;
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const split = part.indexOf('=');
    return split < 0 ? [part, ''] : [part.slice(0, split), decodeURIComponent(part.slice(split + 1))];
  }));
}

function send(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    'Cache-Control': 'no-store, private',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  response.end(body);
}

function redirect(response, location, headers = {}) {
  send(response, 302, '', { Location: location, ...headers });
}

function normalizeShareFromUrl(url) {
  const title = String(url.searchParams.get('shareTitle') || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 180);
  const rawUrl = String(url.searchParams.get('shareUrl') || '').trim().slice(0, 500);
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'smtop100.blog') return null;
    return { title, url: parsed.toString() };
  } catch {
    return null;
  }
}

function shareQuery(share) {
  const params = new URLSearchParams({
    shareUrl: share.url,
  });
  if (share.title) params.set('shareTitle', share.title);
  return params.toString();
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { timeout: 5000 }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`rss.chat SSO helper returned ${response.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('rss.chat SSO helper timed out.')));
    request.on('error', reject);
  });
}

function bootstrapHtml(user, share) {
  const params = new URLSearchParams({
    emailconfirmed: 'true',
    email: user.emailAddress,
    code: user.emailSecret,
    screenname: user.screenname,
  });

  if (share?.url) {
    params.set('compose', '1');
    params.set('top100ObjectUrl', String(share.url));
    params.set('top100ObjectType', 'post');
    if (share.title) params.set('top100ObjectTitle', String(share.title));
  }

  // Hand the identity to rss.chat through its own confirmation callback path.
  // The rss.chat client persists rssNetworkMemory itself and immediately strips
  // these one-time query parameters from the visible URL.
  const target = '/?' + params.toString();

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Opening Top 100 Chat…</title></head>
<body><p>Opening Top 100 Chat…</p><script>
location.replace(${JSON.stringify(target)});
</script></body></html>`;
}

async function getTop100ClientHome() {
  if (clientHomeCache) return clientHomeCache;

  const upstream = await fetch(upstreamClientHome, {
    headers: { 'User-Agent': 'Top100Chat/1.0' },
  });
  if (!upstream.ok) throw new Error(`Could not fetch rss.chat client source: HTTP ${upstream.status}`);

  let html = await upstream.text();
  if (!html.includes('</head>') || !html.includes('</body>')) {
    throw new Error('rss.chat client source is missing expected document markers.');
  }

  const favicon = "<link rel=\"icon\" type=\"image/svg+xml\" href=\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230B1F3B'/%3E%3Cpath d='M10 45h44' stroke='%23CBD5E1' stroke-width='2'/%3E%3Ccircle cx='32' cy='45' r='5' fill='%230B1F3B' stroke='%23CBD5E1' stroke-width='2'/%3E%3Ctext x='32' y='35' text-anchor='middle' font-family='Arial,sans-serif' font-size='22' font-weight='800' fill='%2310B981'%3E100%3C/text%3E%3C/svg%3E\">";
  const headInjection = favicon +
    '<link rel="manifest" href="/manifest.webmanifest">' +
    '<link rel="apple-touch-icon" href="/top100-chat-icon.svg">' +
    '<meta name="theme-color" content="#0B1F3B">' +
    '<meta name="mobile-web-app-capable" content="yes">' +
    '<meta name="apple-mobile-web-app-capable" content="yes">' +
    '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">' +
    '<meta name="apple-mobile-web-app-title" content="Top 100 Chat">' +
    '<style>' + clientThemeCss + '</style>' +
    '<script>(function(){try{var p=new URLSearchParams(location.search);var u=p.get("top100ObjectUrl")||p.get("shareUrl")||"";if(p.get("compose")==="1"&&u){sessionStorage.setItem("top100ChatObjectIntent",JSON.stringify({compose:true,url:u,type:(p.get("top100ObjectType")||"post"),title:(p.get("top100ObjectTitle")||p.get("shareTitle")||"Top 100 post")}));}}catch(e){}})();</script>' +
    '<script>if("serviceWorker" in navigator){window.addEventListener("load",function(){navigator.serviceWorker.register("/pwa-sw.js",{scope:"/",updateViaCache:"none"}).catch(function(){});});}</script>';

  html = html.replace('</head>', headInjection + '</head>');
  clientHomeCache = html.replace('</body>', '<script>' + clientBrandJs + '</script></body>');
  return clientHomeCache;
}

async function claim(request, response, url) {
  try {
    cleanExpiredNonces();
    const ticket = url.searchParams.get('ticket');
    const payload = verifySignedValue(ticket, ssoSecret);
    const now = Math.floor(Date.now() / 1000);

    if (payload.world !== 'top-100' || !payload.sub || !payload.mid || !payload.email || !payload.nonce) throw new Error('Incomplete ticket.');
    if (Number(payload.exp) <= now || Number(payload.iat) > now + 30) throw new Error('Expired ticket.');
    if (usedNonces.has(payload.nonce)) throw new Error('This ticket has already been used.');
    usedNonces.set(payload.nonce, Number(payload.exp));

    const helper = new URL(`http://127.0.0.1:${rssChatPort}/localtop100sso`);
    helper.searchParams.set('managerid', String(payload.mid));
    helper.searchParams.set('email', String(payload.email));
    helper.searchParams.set('displayname', String(payload.name || 'Top 100 manager'));
    const user = await getJson(helper);

    if (!user?.screenname || !user?.emailAddress || !user?.emailSecret) throw new Error('rss.chat did not return a usable account.');

    const session = signSession({
      v: 1,
      sub: payload.sub,
      mid: Number(payload.mid),
      world: 'top-100',
      name: String(payload.name || 'Top 100 manager'),
      iat: now,
      exp: now + sessionLifetimeSeconds,
    });

    send(response, 200, bootstrapHtml(user, payload.share), {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': `${cookieName}=${encodeURIComponent(session)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${sessionLifetimeSeconds}`,
    });
  } catch (error) {
    console.error('claim:', error.message);
    redirect(response, '/login?error=access');
  }
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'https://chat.smtop100.blog');

  if (url.pathname === '/push/config') {
    try {
      getSessionForRequest(request);
      send(response, 200, JSON.stringify({ enabled: Boolean(vapidPublicKey && vapidPrivateKey), vapidPublicKey }), {
        'Content-Type': 'application/json; charset=utf-8',
      });
    } catch {
      send(response, 401, JSON.stringify({ error: 'Authentication required.' }), {
        'Content-Type': 'application/json; charset=utf-8',
      });
    }
    return;
  }

  if (url.pathname === '/push/subscribe' && request.method === 'POST') {
    try {
      const session = getSessionForRequest(request);
      if (!vapidPublicKey || !vapidPrivateKey) throw new Error('Push notifications are not configured.');
      const body = await readJsonBody(request);
      const subscription = normalizeSubscription(body.subscription);
      if (!subscription) throw new Error('Invalid push subscription.');

      const now = new Date().toISOString();
      const existing = pushSubscriptions.find((entry) => entry.endpoint === subscription.endpoint);
      if (existing) {
        existing.managerId = Number(session.mid);
        existing.subscription = subscription;
        existing.sessionExp = Number(session.exp);
        existing.updatedAt = now;
      } else {
        const managerCount = pushSubscriptions.filter((entry) => Number(entry.managerId) === Number(session.mid)).length;
        if (managerCount >= maxPushSubscriptionsPerManager) {
          send(response, 429, JSON.stringify({ error: 'Too many notification devices are registered for this manager.' }), {
            'Content-Type': 'application/json; charset=utf-8',
          });
          return;
        }
        if (pushSubscriptions.length >= maxPushSubscriptionsTotal) {
          send(response, 503, JSON.stringify({ error: 'Notification subscription capacity has been reached.' }), {
            'Content-Type': 'application/json; charset=utf-8',
          });
          return;
        }

        pushSubscriptions.push({
          endpoint: subscription.endpoint,
          managerId: Number(session.mid),
          subscription,
          sessionExp: Number(session.exp),
          createdAt: now,
          updatedAt: now,
        });
      }
      savePushSubscriptions();
      send(response, 204, '');
    } catch (error) {
      send(response, 400, JSON.stringify({ error: error.message }), {
        'Content-Type': 'application/json; charset=utf-8',
      });
    }
    return;
  }

  if (url.pathname === '/push/subscribe' && request.method === 'DELETE') {
    try {
      const session = getSessionForRequest(request);
      const body = await readJsonBody(request);
      const endpoint = String(body.endpoint || '').trim();
      pushSubscriptions = pushSubscriptions.filter((entry) => !(entry.endpoint === endpoint && Number(entry.managerId) === Number(session.mid)));
      savePushSubscriptions();
      send(response, 204, '');
    } catch (error) {
      send(response, 400, JSON.stringify({ error: error.message }), {
        'Content-Type': 'application/json; charset=utf-8',
      });
    }
    return;
  }

  if (url.pathname === '/internal/reply' && request.method === 'POST') {
    if (!isLoopback(request)) {
      send(response, 403, 'Forbidden.', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }
    try {
      const event = await readJsonBody(request);
      await sendReplyPush(event);
      send(response, 204, '');
    } catch (error) {
      console.error('reply push event:', error.message);
      send(response, 400, 'Bad request.', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    return;
  }

  if (url.pathname === '/manifest.webmanifest') {
    send(response, 200, pwaManifest, {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    });
    return;
  }

  if (url.pathname === '/top100-chat-icon.svg') {
    send(response, 200, pwaIconSvg, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400',
    });
    return;
  }

  if (url.pathname === '/pwa-sw.js') {
    send(response, 200, pwaServiceWorker, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    });
    return;
  }

  if (url.pathname === '/client-home') {
    try {
      const html = await getTop100ClientHome();
      send(response, 200, html, { 'Content-Type': 'text/html; charset=utf-8' });
    } catch (error) {
      console.error('client-home:', error.message);
      send(response, 502, 'Top 100 Chat client source unavailable.', { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    return;
  }

  if (url.pathname === '/login' || url.pathname === '/login/') {
    send(response, 200, shellHtml.replace('{{ERROR}}', url.searchParams.get('error') ? '<p class="notice">That sign-in link could not be used. Please sign in again.</p>' : ''), {
      'Content-Type': 'text/html; charset=utf-8',
    });
    return;
  }

  if (url.pathname === '/share') {
    const share = normalizeShareFromUrl(url);
    if (!share) {
      redirect(response, '/');
      return;
    }

    const query = shareQuery(share);
    try {
      verifySession(parseCookies(request)[cookieName]);
      const params = new URLSearchParams({
        compose: '1',
        top100ObjectUrl: share.url,
        top100ObjectType: 'post',
      });
      if (share.title) params.set('top100ObjectTitle', share.title);
      redirect(response, '/?' + params.toString());
    } catch {
      redirect(response, 'https://manager.smtop100.blog/chat?' + query);
    }
    return;
  }

  if (url.pathname === '/auth/claim') {
    await claim(request, response, url);
    return;
  }

  if (url.pathname === '/auth/check') {
    try {
      const session = verifySession(parseCookies(request)[cookieName]);
      send(response, 204, '', {
        'X-Top100-Manager-Id': String(session.mid),
        'X-Top100-Manager-Name': encodeURIComponent(session.name || ''),
      });
    } catch {
      redirect(response, '/login');
    }
    return;
  }

  if (url.pathname === '/auth/logout') {
    try {
      const session = getSessionForRequest(request);
      pushSubscriptions = pushSubscriptions.filter((entry) => Number(entry.managerId) !== Number(session.mid));
      savePushSubscriptions();
    } catch {
      // The session may already be expired or absent; logout should still
      // clear browser state and the clubhouse cookie.
    }

    send(response, 200, '<!doctype html><meta charset="utf-8"><script>localStorage.removeItem("rssNetworkMemory");location.replace("/login");</script>', {
      'Content-Type': 'text/html; charset=utf-8',
      'Set-Cookie': `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    });
    return;
  }

  send(response, 404, 'Not found.', { 'Content-Type': 'text/plain; charset=utf-8' });
});

server.listen(port, host, () => {
  console.log(`Top 100 Chat gateway listening on http://${host}:${port}`);
});
