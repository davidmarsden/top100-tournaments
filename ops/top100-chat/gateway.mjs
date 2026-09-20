#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const host = process.env.TOP100_CHAT_GATEWAY_HOST || '127.0.0.1';
const port = Number(process.env.TOP100_CHAT_GATEWAY_PORT || 1470);
const rssChatPort = Number(process.env.TOP100_CHAT_RSS_PORT || 1430);
const ssoSecret = String(process.env.TOP100_CHAT_SSO_SECRET || '');
const cookieSecret = crypto.createHmac('sha256', ssoSecret).update('top100-chat-cookie-v1').digest();
const cookieName = 'top100_chat_session';
const sessionLifetimeSeconds = Number(process.env.TOP100_CHAT_SESSION_SECONDS || 43200);
const here = path.dirname(fileURLToPath(import.meta.url));
const shellHtml = fs.readFileSync(path.join(here, 'shell.html'), 'utf8');
const usedNonces = new Map();

if (ssoSecret.length < 32) {
  console.error('TOP100_CHAT_SSO_SECRET must be at least 32 characters.');
  process.exit(1);
}

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

function bootstrapHtml(user) {
  const memory = JSON.stringify({
    email: user.emailAddress,
    code: user.emailSecret,
    screenname: user.screenname,
  }).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Opening Top 100 Chat…</title></head>
<body><p>Opening Top 100 Chat…</p><script>
localStorage.rssNetworkMemory = ${JSON.stringify(memory)};
location.replace('/');
</script></body></html>`;
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

    send(response, 200, bootstrapHtml(user), {
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

  if (url.pathname === '/login' || url.pathname === '/login/') {
    send(response, 200, shellHtml.replace('{{ERROR}}', url.searchParams.get('error') ? '<p class="notice">That sign-in link could not be used. Please sign in again.</p>' : ''), {
      'Content-Type': 'text/html; charset=utf-8',
    });
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
