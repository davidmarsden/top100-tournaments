// Formats the Top 100 Chat market digest from chat_market_digest() and signs it for the chat
// gateway's /auth/digest route. Kept free of Netlify globals so it can be tested with node.
import crypto from 'node:crypto';

export const PORTAL_URL = 'https://manager.smtop100.blog/';
const MAX_LENGTH = 3800;

// One question to close each digest, picked by date so it changes daily.
export const PROMPTS = [
  'Signing of the day? Reply with your pick.',
  'Best value deal on that list? Reply below.',
  'Who overpaid? Make your case.',
  'Which listed player would you take a punt on?',
  "What's your club still short of before next season?",
  'Any swaps worth doing? Reply with what you need and what you can offer.',
  "Who's the best loan option for game time right now?",
];

export function money(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '£0';
  if (n >= 1e6) return `£${(n / 1e6).toFixed(1)}m`;
  return `£${Math.round(n / 1e3)}k`;
}

const ratio = (value) => `${Number(value).toFixed(1)}×`;
const clean = (value, max = 120) => String(value ?? '').replace(/\s+/g, ' ').replace(/[*_`[\]]/g, '').trim().slice(0, max);
const ukDate = (date) => new Date(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' });
const GROUPS = { GK: 'goalkeeper', CB: 'centre-back', FB: 'full-back', DM: 'defensive midfielder', CM: 'central midfielder', W: 'winger', AM: 'attacking midfielder', ST: 'striker' };

// Soccer Manager names come in capitals ("M.SILVETTI", "I.HANSEN-AARÖEN"): "M. Silvetti", "I. Hansen-Aarön".
export function playerName(value) {
  const text = clean(value, 40);
  if (text !== text.toUpperCase()) return text;
  return text.toLowerCase()
    .replace(/(^|[\s.\-'’])(\p{L})/gu, (whole, before, letter) => before + letter.toUpperCase())
    .replace(/\.(?=\S)/g, '. ');
}

function playerLine(p) {
  return `${playerName(p.player)} (${p.rating}${p.age ? `, ${p.age}` : ''}${p.position ? `, ${clean(p.position, 20)}` : ''})`;
}

function dealLine(d) {
  const buyer = d.buyer ? ` (${clean(d.buyer, 40)})` : '';
  return `- ${playerLine(d)}: ${clean(d.from, 40)} → ${clean(d.to, 40)}${buyer} · ${money(d.fee)}`;
}

function boardLine(p) {
  if (p.kind === 'offered') {
    return `- ${clean(p.club, 40)} offering ${playerName(p.player)} (${p.playerRating}${p.playerPosition ? `, ${clean(p.playerPosition, 20)}` : ''})${p.askingPrice ? `, asking ${money(p.askingPrice)}` : ''}`;
  }
  const rating = p.minRating && p.maxRating ? `${p.minRating}-${p.maxRating} rated ` : p.minRating ? `${p.minRating}+ rated ` : '';
  const what = `${rating}${p.group ? GROUPS[p.group] || p.group : 'player'}`;
  const deals = (p.dealTypes || []).join('/');
  return `- ${clean(p.club, 40)} want a ${what}${deals ? ` (${deals})` : ''}${p.maxFee ? `, up to ${money(p.maxFee)}` : ''}`;
}

// Whether there's anything worth posting.
export function hasNews(d) {
  return Boolean(d && (Number(d.deals) > 0 || Number(d.newlyListedCount) > 0 || Number(d.newlyUnhappyCount) > 0
    || Number(d.board?.wanted) > 0 || Number(d.board?.offered) > 0 || (d.newsfeed || []).length > 0));
}

export function formatMarketDigest(d, now = new Date()) {
  const title = `${d.world} market · ${ukDate(now)}`;
  const parts = [];

  if (Number(d.deals) > 0) {
    const typical = d.typicalRatio ? ` Straight cash deals went for a typical ${ratio(d.typicalRatio)} the player's value.` : '';
    parts.push(`${d.deals} completed deal${d.deals === 1 ? '' : 's'} since ${ukDate(d.from)}, ${money(d.totalFees)} changing hands.${typical}`);
  }
  if (d.biggest?.length) parts.push(['**Biggest deals**', ...d.biggest.slice(0, 5).map(dealLine)].join('\n'));

  const talking = [];
  if (d.dearest) talking.push(`- Top dollar: ${playerLine(d.dearest)} went to ${clean(d.dearest.to, 40)} for ${money(d.dearest.fee)}, ${ratio(d.dearest.ratio)} his value. Worth it?`);
  if (d.cheapest) talking.push(`- Bargain: ${playerLine(d.cheapest)} went to ${clean(d.cheapest.to, 40)} for ${money(d.cheapest.fee)}, ${ratio(d.cheapest.ratio)} his value.`);
  if (talking.length) parts.push(['**Talking points**', ...talking].join('\n'));

  if (Number(d.partExchanges) > 0) {
    const px = d.biggestPartExchange;
    const example = px ? ` The biggest: ${playerName(px.player)} (${px.rating}) ${clean(px.from, 40)} → ${clean(px.to, 40)}${px.with ? `, with ${playerName(px.with)} going the other way` : ''}.` : '';
    parts.push(`**Swaps:** ${d.partExchanges} part-exchange deal${d.partExchanges === 1 ? '' : 's'}.${example}`);
  }

  if (d.newlyListed?.length) {
    parts.push([`**New on the transfer list** (${d.newlyListedCount})`,
      ...d.newlyListed.slice(0, 5).map((p) => `- ${playerLine(p)}, ${clean(p.club, 40)}${p.askingPrice ? `, asking ${money(p.askingPrice)}` : p.askingLabel ? `, ${clean(p.askingLabel, 30).toLowerCase()}` : ''}`),
    ].join('\n'));
  }
  if (d.newlyUnhappy?.length) {
    parts.push([`**Newly unhappy** (${d.newlyUnhappyCount}): might be available, or worth a loan`,
      ...d.newlyUnhappy.slice(0, 3).map((p) => `- ${playerLine(p)}, ${clean(p.club, 40)}`),
    ].join('\n'));
  }

  const board = d.board || {};
  if (Number(board.wanted) > 0 || Number(board.offered) > 0) {
    parts.push([`**On the transfer board**: ${board.wanted} new wanted, ${board.offered} new offers (${board.open} open in all)`,
      ...(board.latest || []).slice(0, 4).map(boardLine),
      `Post yours in the Manager Portal: ${PORTAL_URL}`,
    ].join('\n'));
  } else {
    parts.push(`Looking for someone, or want to move a player on? Post it on the transfer board in the Manager Portal and it's matched with the market: ${PORTAL_URL}`);
  }

  if (d.newsfeed?.length) {
    parts.push(['**From the newsfeed**', ...d.newsfeed.slice(0, 3).map((n) => `- ${clean(n.manager, 40)}, ${clean(n.club, 40)}: "${clean(n.message, 160)}"`)].join('\n'));
  }

  const prompt = PROMPTS[Math.floor(now.getTime() / 86400000) % PROMPTS.length];
  parts.push(prompt);

  // Keep within the gateway limit: drop sections from the end of the middle until it fits.
  let markdown = parts.join('\n\n');
  while (markdown.length > MAX_LENGTH && parts.length > 2) {
    parts.splice(parts.length - 2, 1);
    markdown = parts.join('\n\n');
  }
  return { title, markdown: markdown.slice(0, MAX_LENGTH) };
}

export function digestKey(worldSlug, now = new Date()) {
  const day = new Date(now).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  return `${worldSlug}:market:${day}`;
}

// Matches the gateway: HMAC-SHA256 over "<timestamp>.<body>" with a key derived from the SSO secret.
export function signDigest(body, ssoSecret, timestamp = Math.floor(Date.now() / 1000)) {
  const key = crypto.createHmac('sha256', ssoSecret).update('top100-chat-digest-v1').digest();
  const signature = crypto.createHmac('sha256', key).update(`${timestamp}.${body}`).digest('base64url');
  return { timestamp: String(timestamp), signature };
}
