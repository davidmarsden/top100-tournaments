type SocialProfile = {
  title: string;
  description: string;
  image?: string;
};

const PROFILES: Record<string, SocialProfile> = {
  'tournaments.smtop100.blog': {
    title: 'Top 100 Tournaments',
    description: 'Youth Cup, World Club Cup and other Top 100 competitions, fixtures, results and tournament history.',
    image: 'https://tournaments.smtop100.blog/top100-social-tournaments.png',
  },
  'manager.smtop100.blog': {
    title: 'Top 100 Manager Portal',
    description: 'Top 100 manager sign-in, club tools and tournament administration.',
    image: 'https://manager.smtop100.blog/top100-social-manager.png',
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
  const image = profile.image ? escapeAttribute(profile.image) : null;
  const imageMetadata = image
    ? `    <meta property="og:image" content="${image}" />\n` +
      `    <meta property="og:image:width" content="1200" />\n` +
      `    <meta property="og:image:height" content="630" />\n` +
      `    <meta name="twitter:card" content="summary_large_image" />\n` +
      `    <meta name="twitter:image" content="${image}" />\n`
    : `    <meta name="twitter:card" content="summary" />\n`;

  let html = await response.text();
  html = html.replace(/<title>.*?<\/title>/is, `<title>${title}</title>`);
  html = html.replace(
    '</head>',
    `    <meta property="og:site_name" content="Top 100" />\n` +
      `    <meta property="og:type" content="website" />\n` +
      `    <meta property="og:title" content="${title}" />\n` +
      `    <meta property="og:description" content="${description}" />\n` +
      `    <meta property="og:url" content="${canonicalUrl}" />\n` +
      imageMetadata +
      `    <meta name="twitter:title" content="${title}" />\n` +
      `    <meta name="twitter:description" content="${description}" />\n` +
      '  </head>',
  );

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('etag');
  headers.delete('last-modified');

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
