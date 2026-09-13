type SocialProfile = {
  title: string;
  description: string;
  image: string;
  imageAlt: string;
};

const PROFILES: Record<string, SocialProfile> = {
  'tournaments.smtop100.blog': {
    title: 'Top 100 Tournaments',
    description: 'Youth Cup, World Club Cup and other Top 100 competitions, with fixtures, results, registrations and tournament history.',
    image: 'https://tournaments.smtop100.blog/top100-social-tournaments.png',
    imageAlt: 'Top 100 Tournaments — Youth Cup, World Club Cup and more.',
  },
  'manager.smtop100.blog': {
    title: 'Top 100 My Matches',
    description: 'Your personalised Top 100 tournament view: upcoming fixtures, opponents, match responsibilities and submitted results.',
    image: 'https://manager.smtop100.blog/top100-social-manager.png',
    imageAlt: 'Top 100 My Matches — fixtures, opponents and results.',
  },
  'vote.smtop100.blog': {
    title: 'Top 100 Voting',
    description: 'Secure Top 100 community polls and manager voting, with one-manager-one-vote ballots and published results.',
    image: 'https://vote.smtop100.blog/top100-social-voting.png',
    imageAlt: 'Top 100 Voting — one manager, one vote.',
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
  const canonicalUrl = escapeAttribute(`${url.origin}${url.pathname}`);
  const image = escapeAttribute(profile.image);
  const imageAlt = escapeAttribute(profile.imageAlt);

  let html = await response.text();
  html = html.replace(/<title>.*?<\/title>/is, `<title>${title}</title>`);
  html = html.replace(
    '</head>',
    `    <meta name="description" content="${description}" />\n` +
      `    <link rel="canonical" href="${canonicalUrl}" />\n` +
      `    <meta property="og:site_name" content="Top 100" />\n` +
      `    <meta property="og:locale" content="en_GB" />\n` +
      `    <meta property="og:type" content="website" />\n` +
      `    <meta property="og:title" content="${title}" />\n` +
      `    <meta property="og:description" content="${description}" />\n` +
      `    <meta property="og:url" content="${canonicalUrl}" />\n` +
      `    <meta property="og:image" content="${image}" />\n` +
      `    <meta property="og:image:width" content="1200" />\n` +
      `    <meta property="og:image:height" content="630" />\n` +
      `    <meta property="og:image:alt" content="${imageAlt}" />\n` +
      `    <meta name="twitter:card" content="summary_large_image" />\n` +
      `    <meta name="twitter:title" content="${title}" />\n` +
      `    <meta name="twitter:description" content="${description}" />\n` +
      `    <meta name="twitter:image" content="${image}" />\n` +
      `    <meta name="twitter:image:alt" content="${imageAlt}" />\n` +
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
