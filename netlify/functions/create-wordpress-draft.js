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
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  if (!adminResponse.ok) return false;
  return Boolean(await adminResponse.json());
}

async function wordpressRequest(path, options = {}) {
  const siteUrl = String(process.env.WORDPRESS_SITE_URL || '').replace(/\/$/, '');
  const username = process.env.WORDPRESS_USERNAME;
  const password = process.env.WORDPRESS_APP_PASSWORD;
  if (!siteUrl || !username || !password) throw new Error('WordPress credentials are not configured.');
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const response = await fetch(`${siteUrl}/wp-json/wp/v2${path}`, {
    ...options,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || `WordPress request failed (${response.status}).`);
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
    const isAdmin = await verifyAdminToken(token);
    if (!isAdmin) return json(403, { error: 'Verified tournament administrator access is required.' });

    const body = JSON.parse(event.body || '{}');
    const title = String(body.title || '').trim();
    const markdown = String(body.markdown || '').trim();
    if (!title || !markdown) return json(400, { error: 'A title and report body are required.' });
    if (title.length > 200 || markdown.length > 100000) return json(400, { error: 'The report is too large to publish.' });

    const categoryNames = uniqueTermNames(body.categories, 5);
    const tagNames = uniqueTermNames(body.tags, 10);
    const categoryIds = (await Promise.all(categoryNames.map((name) => ensureTerm('categories', name)))).filter(Boolean);
    const tagIds = (await Promise.all(tagNames.map((name) => ensureTerm('tags', name)))).filter(Boolean);

    const post = await wordpressRequest('/posts', {
      method: 'POST',
      body: JSON.stringify({
        title,
        content: markdownToHtml(markdown),
        status: 'draft',
        categories: categoryIds,
        tags: tagIds,
      }),
    });

    const siteUrl = String(process.env.WORDPRESS_SITE_URL || '').replace(/\/$/, '');
    return json(200, {
      id: post.id,
      status: post.status,
      url: post.link || null,
      edit_url: post.id ? `${siteUrl}/wp-admin/post.php?post=${post.id}&action=edit` : null,
    });
  } catch (error) {
    console.error('WordPress draft creation failed:', error);
    return json(500, { error: error.message || 'Could not create WordPress draft.' });
  }
};