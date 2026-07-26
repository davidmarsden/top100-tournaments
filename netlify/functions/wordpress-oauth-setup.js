const crypto = require('crypto');

const COOKIE_NAME = 'top100_wp_oauth_state';
const COOKIE_PATH = '/.netlify/functions/wordpress-oauth-setup';
const COOKIE_MAX_AGE_SECONDS = 600;

const html = (statusCode, body, extraHeaders = {}) => ({
  statusCode,
  headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...extraHeaders,
  },
  body,
});

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function page(title, content) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body{font-family:system-ui,-apple-system,sans-serif;max-width:760px;margin:0 auto;padding:32px 20px;line-height:1.55;background:#f6f8fb;color:#172033}
    main{background:#fff;border:1px solid #dce3ef;border-radius:18px;padding:28px;box-shadow:0 12px 30px rgba(18,34,61,.08)}
    h1{margin-top:0} code,pre{font-family:ui-monospace,SFMono-Regular,monospace;background:#eef2f8;border-radius:8px}
    code{padding:.15rem .35rem} pre{padding:16px;overflow-wrap:anywhere;white-space:pre-wrap}
    a.button{display:inline-block;padding:12px 18px;border-radius:10px;background:#2563eb;color:white;text-decoration:none;font-weight:700}
    .warning{padding:12px 14px;border-left:4px solid #d97706;background:#fff7ed}
  </style>
</head>
<body><main>${content}</main></body>
</html>`;
}

function config(event) {
  const clientId = String(process.env.WORDPRESS_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.WORDPRESS_CLIENT_SECRET || '').trim();
  const site = String(process.env.WORDPRESS_SITE_ID || 'smtop100.blog').trim();
  const host = String(event.headers.host || '').trim();
  if (!clientId || !clientSecret || !host) {
    throw new Error('Add WORDPRESS_CLIENT_ID and WORDPRESS_CLIENT_SECRET in Netlify before starting OAuth setup.');
  }
  const redirectUri = `https://${host}${COOKIE_PATH}`;
  return { clientId, clientSecret, site, redirectUri };
}

function cookiesFrom(event) {
  const raw = String(event.headers.cookie || event.headers.Cookie || '');
  return raw.split(';').reduce((cookies, part) => {
    const index = part.indexOf('=');
    if (index < 0) return cookies;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
    return cookies;
  }, {});
}

function stateCookie(value, maxAge = COOKIE_MAX_AGE_SECONDS) {
  return `${COOKIE_NAME}=${encodeURIComponent(value)}; Path=${COOKIE_PATH}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

function statesMatch(returnedState, cookieState) {
  if (!returnedState || !cookieState) return false;
  const returned = Buffer.from(returnedState);
  const stored = Buffer.from(cookieState);
  return returned.length === stored.length && crypto.timingSafeEqual(returned, stored);
}

exports.handler = async (event) => {
  try {
    const { clientId, clientSecret, site, redirectUri } = config(event);
    const params = event.queryStringParameters || {};
    const code = String(params.code || '');
    const returnedState = String(params.state || '');
    const oauthError = String(params.error || '');
    const cookieState = cookiesFrom(event)[COOKIE_NAME] || '';

    if (oauthError) {
      return html(400, page('WordPress connection failed', `<h1>WordPress connection failed</h1><p>${escapeHtml(params.error_description || oauthError)}</p>`), {
        'Set-Cookie': stateCookie('', 0),
      });
    }

    if (!code) {
      const state = crypto.randomBytes(32).toString('base64url');
      const authorize = new URL('https://public-api.wordpress.com/oauth2/authorize');
      authorize.searchParams.set('client_id', clientId);
      authorize.searchParams.set('redirect_uri', redirectUri);
      authorize.searchParams.set('response_type', 'code');
      authorize.searchParams.set('blog', site);
      authorize.searchParams.set('state', state);
      return html(200, page('Connect WordPress.com', `
        <h1>Connect WordPress.com</h1>
        <p>This one-time setup authorises the Top 100 Tournament App to create draft posts on <strong>${escapeHtml(site)}</strong>.</p>
        <p><a class="button" href="${escapeHtml(authorize.toString())}">Authorise with WordPress.com</a></p>
        <p class="warning">Only continue if this page is on your own Tournament Hub domain.</p>
      `), {
        'Set-Cookie': stateCookie(state),
      });
    }

    if (!statesMatch(returnedState, cookieState)) {
      return html(403, page('Invalid OAuth state', '<h1>Invalid OAuth state</h1><p>This callback was not initiated by this browser, or the setup session expired. Restart the setup from the beginning.</p>'), {
        'Set-Cookie': stateCookie('', 0),
      });
    }

    const form = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    });
    const response = await fetch('https://public-api.wordpress.com/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
      throw new Error(payload.error_description || payload.error || `WordPress.com token exchange failed (${response.status}).`);
    }

    return html(200, page('WordPress connected', `
      <h1>WordPress.com connected</h1>
      <p>Copy these values into Netlify environment variables, then redeploy.</p>
      <h2>WORDPRESS_ACCESS_TOKEN</h2>
      <pre>${escapeHtml(payload.access_token)}</pre>
      <h2>WORDPRESS_SITE_ID</h2>
      <pre>${escapeHtml(payload.blog_id || site)}</pre>
      <p class="warning">Treat the access token like a password. Do not share it or leave this page open after copying it.</p>
    `), {
      'Set-Cookie': stateCookie('', 0),
    });
  } catch (error) {
    console.error('WordPress OAuth setup failed:', error.message);
    return html(500, page('WordPress setup error', `<h1>WordPress setup error</h1><p>${escapeHtml(error.message || 'Setup failed.')}</p>`), {
      'Set-Cookie': stateCookie('', 0),
    });
  }
};