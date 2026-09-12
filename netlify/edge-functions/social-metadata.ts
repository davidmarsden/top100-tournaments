type SocialProfile = {
  title: string;
  description: string;
};

const PROFILES: Record<string, SocialProfile> = {
  'tournaments.smtop100.blog': {
    title: 'Top 100 Tournaments',
    description: 'Youth Cup, World Club Cup and other Top 100 competitions, fixtures, results and tournament history.',
  },
  'manager.smtop100.blog': {
    title: 'Top 100 Manager Portal',
    description: 'Top 100 manager sign-in, club tools and tournament administration.',
  },
  'vote.smtop100.blog': {
    title: 'Top 100 Voting',
    description: 'Top 100 community polls and manager voting.',
  },
};

const escapeAttribute = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

export default async (request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('text/html')) {
    return response;
  }

  const url = new URL(request.url);
  const profile = PROFILES[url.hostname] || PROFILES['tournaments.smtop100.blog'];
  const title = escapeAttribute(profile.title);
  const description = escapeAttribute(profile.description);
  const canonicalUrl = escapeAttribute(url.toString());

  let html = await response.text();
  html = html.replace(/<title>.*?<\/title>/is, `<title>${title}</title>`);
  html = html.replace(
    '</head>',
    `    <meta property="og:site_name" content="Top 100" />\n` +
      `    <meta property="og:type" content="website" />\n` +
      `    <meta property="og:title" content="${title}" />\n` +
      `    <meta property="og:description" content="${description}" />\n` +
      `    <meta property="og:url" content="${canonicalUrl}" />\n` +
      `    <meta name="twitter:title" content="${title}" />\n` +
      `    <meta name="twitter:description" content="${description}" />\n` +
      '  </head>',
  );

  const headers = new Headers(response.headers);
  headers.delete('content-length');

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const config = {
  path: '/*',
  excludedPath: '/.netlify/functions/*',
};
