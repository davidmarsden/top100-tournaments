const json = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2">$1</a>');
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n');
  const output = [];
  let listOpen = false;
  let quoteOpen = false;
  const closeList = () => { if (listOpen) { output.push('</ul>'); listOpen = false; } };
  const closeQuote = () => { if (quoteOpen) { output.push('</blockquote>'); quoteOpen = false; } };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { closeList(); closeQuote(); continue; }
    if (line.startsWith('# ')) { closeList(); closeQuote(); continue; }
    if (line.startsWith('## ')) { closeList(); closeQuote(); output.push(`<h2>${inlineMarkdown(line.slice(3))}</h2>`); continue; }
    if (line.startsWith('### ')) { closeList(); closeQuote(); output.push(`<h3>${inlineMarkdown(line.slice(4))}</h3>`); continue; }
    if (line.startsWith('- ')) {
      closeQuote();
      if (!listOpen) { output.push('<ul>'); listOpen = true; }
      output.push(`<li>${inlineMarkdown(line.slice(2))}</li>`);
      continue;
    }
    if (line.startsWith('> ')) {
      closeList();
      if (!quoteOpen) { output.push('<blockquote>'); quoteOpen = true; }
      output.push(`<p>${inlineMarkdown(line.slice(2))}</p>`);
      continue;
    }
    closeList();
    closeQuote();
    output.push(`<p>${inlineMarkdown(line)}</p>`);
  }

  closeList();
  closeQuote();
  return output.join('\n');
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('Supabase server credentials are not configured.');
  return { url: url.replace(/\/$/, ''), anonKey };
}

async function verifyAdminToken(token) {
  const { url, anonKey } = supabaseConfig();
  const userResponse = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  if (!userResponse.ok) return false;
  const adminResponse = await fetch(`${url}/rest/v1/rpc/is_admin`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!adminResponse.ok) return false;
  return Boolean(await adminResponse.json());
}

function wordpressConfig() {
  const siteUrl = String(process.env.WORDPRESS_SITE_URL || '').replace(/\/$/, '');
  const site = String(process.env.WORDPRESS_SITE_ID || '').trim()
    || (() => { try { return new URL(siteUrl).hostname; } catch { return ''; } })();
  if (!site) throw new Error('WORDPRESS_SITE_ID or WORDPRESS_SITE_URL is not configured.');
  return { siteUrl, site };
}

async function wordpressAccessToken() {
  if (process.env.WORDPRESS_ACCESS_TOKEN) return process.env.WORDPRESS_ACCESS_TOKEN;
  const username = process.env.WORDPRESS_USERNAME;
  const password = process.env.WORDPRESS_APP_PASSWORD;
  const clientId = process.env.WORDPRESS_CLIENT_ID;
  const clientSecret = process.env.WORDPRESS_CLIENT_SECRET;
  if (!username || !password || !clientId || !clientSecret) {
    throw new Error('WordPress.com OAuth credentials are incomplete. Add WORDPRESS_CLIENT_ID and WORDPRESS_CLIENT_SECRET as well as the username and application password.');
  }
  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'password',
    username,
    password,
  });
  const response = await fetch('https://public-api.wordpress.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(payload.error_description || payload.error || `WordPress.com authentication failed (${response.status}).`);
  return payload.access_token;
}

async function wordpressRequest(path, options = {}) {
  const { site } = wordpressConfig();
  const token = await wordpressAccessToken();
  const response = await fetch(`https://public-api.wordpress.com/wp/v2/sites/${encodeURIComponent(site)}${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.error || `WordPress.com request failed (${response.status}).`);
    error.wordpressPayload = payload;
    throw error;
  }
  return payload;
}

async function ensureTerm(type, name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) return null;
  const found = await wordpressRequest(`/${type}?search=${encodeURIComponent(cleanName)}&per_page=100`);
  const exact = found.find((item) => String(item.name).toLowerCase() === cleanName.toLowerCase());
  if (exact) return exact.id;
  try {
    const created = await wordpressRequest(`/${type}`, { method: 'POST', body: JSON.stringify({ name: cleanName }) });
    return created.id;
  } catch (error) {
    const payload = error.wordpressPayload || {};
    const existingId = payload.code === 'term_exists' ? payload.data?.term_id : null;
    if (existingId) return existingId;
    throw error;
  }
}

function uniqueTermNames(values, limit) {
  const seen = new Set();
  const names = [];
  for (const value of Array.isArray(values) ? values : []) {
    const cleanName = String(value || '').trim();
    const key = cleanName.toLocaleLowerCase('en-GB');
    if (!cleanName || seen.has(key)) continue;
    seen.add(key);
    names.push(cleanName);
    if (names.length === limit) break;
  }
  return names;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  try {
    const token = String(event.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return json(401, { error: 'Admin authentication is required.' });
    if (!(await verifyAdminToken(token))) return json(403, { error: 'Verified tournament administrator access is required.' });

    const body = JSON.parse(event.body || '{}');
    const title = String(body.title || '').trim();
    const markdown = String(body.markdown || '').trim();
    if (!title || !markdown) return json(400, { error: 'A title and report body are required.' });
    if (title.length > 200 || markdown.length > 100000) return json(400, { error: 'The report is too large to publish.' });

    const categoryIds = (await Promise.all(uniqueTermNames(body.categories, 5).map((name) => ensureTerm('categories', name)))).filter(Boolean);
    const tagIds = (await Promise.all(uniqueTermNames(body.tags, 10).map((name) => ensureTerm('tags', name)))).filter(Boolean);
    const post = await wordpressRequest('/posts', {
      method: 'POST',
      body: JSON.stringify({ title, content: markdownToHtml(markdown), status: 'draft', categories: categoryIds, tags: tagIds }),
    });

    const { site, siteUrl } = wordpressConfig();
    return json(200, {
      id: post.id,
      status: post.status,
      url: post.link || null,
      edit_url: post.id ? `https://wordpress.com/post/${encodeURIComponent(site)}/${post.id}` : (siteUrl || null),
    });
  } catch (error) {
    console.error('WordPress draft creation failed:', error);
    return json(500, { error: error.message || 'Could not create WordPress draft.' });
  }
};
