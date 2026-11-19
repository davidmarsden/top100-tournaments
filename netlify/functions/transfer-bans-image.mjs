import { createClient } from '@supabase/supabase-js';

// GET /.netlify/functions/transfer-bans-image: the Most bans table as an SVG graphic, drawn from
// public_transfer_ban_table on every request (cached for an hour), for smtop100.blog/transfer-bans/.
// Same figures as the text table under it on the page: rank, manager, bans (one pip each), total
// time banned (a bar), longest ban and latest ban. Dark site colours; ban marks in the Manager
// Portal's ban red.

const W = 1000;
const PAD = 40;
const ROW = 52;
const HEAD = 150;
const COLHEAD = 34;
const FOOT = 74;
const FONT = "Inter, 'Segoe UI', system-ui, -apple-system, Helvetica, Arial, sans-serif";
const C = {
  surface: '#071526', panel: '#0b1f3b', rowAlt: '#0d2440', grid: '#1e3553',
  ink: '#f8fafc', secondary: '#cbd5e1', muted: '#8fa3b8', emerald: '#34d399',
  ban: '#ef4444', banTrack: '#2a2f45', nowBg: '#3b0d0d', nowInk: '#fecaca',
};
const COL = { rank: PAD + 18, name: PAD + 52, pips: 420, bar: 545, barW: 165, longest: 800, latest: W - PAD };

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const months = (days) => {
  const n = Math.max(1, Math.round(Number(days || 0) / 30.4));
  return `${n} month${n === 1 ? '' : 's'}`;
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthYear = (value) => {
  const [year, month] = String(value).slice(0, 7).split('-');
  return `${MONTHS[Number(month) - 1] || ''} ${year}`;
};
const truncate = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function svg(table) {
  const rows = table?.managers || [];
  const totals = table?.totals || {};
  const height = HEAD + COLHEAD + rows.length * ROW + FOOT;
  const maxDays = Math.max(1, ...rows.map((row) => Number(row.days) || 0));
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-labelledby="t d" font-family="${FONT}">`);
  out.push(`<title id="t">Most transfer bans in Top 100</title>`);
  out.push(`<desc id="d">${esc(rows.slice(0, 5).map((row) => `${row.manager}: ${row.bans} bans, ${months(row.days)} banned`).join('; '))}</desc>`);
  out.push(`<rect width="${W}" height="${height}" rx="24" fill="${C.surface}"/>`);
  out.push(`<rect x="12" y="12" width="${W - 24}" height="${height - 24}" rx="18" fill="${C.panel}"/>`);

  // Title block.
  out.push(`<text x="${PAD}" y="62" fill="${C.emerald}" font-size="13" font-weight="800" letter-spacing="2.4">TOP 100 · TRANSFER BANS</text>`);
  out.push(`<text x="${PAD}" y="102" fill="${C.ink}" font-size="34" font-weight="900" letter-spacing="-0.8">Most transfer bans</text>`);
  out.push(`<text x="${PAD}" y="130" fill="${C.secondary}" font-size="15">Ranked by bans, then time banned · ${esc(totals.bans ?? '')} bans for ${esc(totals.managers ?? '')} managers since ${esc(totals.firstYear ?? '2019')}</text>`);

  // Column headings.
  const hy = HEAD + 22;
  const head = (x, label, anchor = 'start') => out.push(`<text x="${x}" y="${hy}" fill="${C.muted}" font-size="12" font-weight="700" letter-spacing="1.2" text-anchor="${anchor}">${label}</text>`);
  head(COL.name, 'MANAGER');
  head(COL.pips, 'BANS');
  head(COL.bar, 'TIME BANNED');
  head(COL.longest, 'LONGEST');
  head(COL.latest, 'LATEST', 'end');
  out.push(`<line x1="${PAD}" x2="${W - PAD}" y1="${HEAD + COLHEAD}" y2="${HEAD + COLHEAD}" stroke="${C.grid}" stroke-width="1"/>`);

  // Rows: tied bans and time share a rank.
  let rank = 0;
  let previous = null;
  rows.forEach((row, index) => {
    const key = `${row.bans}|${row.days}`;
    if (key !== previous) { rank = index + 1; previous = key; }
    const top = HEAD + COLHEAD + index * ROW;
    const mid = top + ROW / 2;
    if (index % 2 === 1) out.push(`<rect x="${PAD - 12}" y="${top + 2}" width="${W - 2 * PAD + 24}" height="${ROW - 4}" rx="10" fill="${C.rowAlt}"/>`);

    out.push(`<text x="${COL.rank}" y="${mid + 6}" fill="${rank <= 3 ? C.ink : C.secondary}" font-size="${rank <= 3 ? 19 : 16}" font-weight="900" text-anchor="middle">${rank}</text>`);
    const name = truncate(String(row.manager || 'Unknown manager'), row.bannedNow ? 20 : 28);
    out.push(`<text x="${COL.name}" y="${mid + 6}" fill="${C.ink}" font-size="17" font-weight="700">${esc(name)}</text>`);
    if (row.bannedNow) {
      const pillX = COL.name + Math.min(name.length, 20) * 9.4 + 12;
      out.push(`<rect x="${pillX}" y="${mid - 11}" width="96" height="22" rx="11" fill="${C.nowBg}" stroke="${C.ban}" stroke-width="1.2"/>`);
      out.push(`<text x="${pillX + 48}" y="${mid + 4}" fill="${C.nowInk}" font-size="11" font-weight="800" letter-spacing="0.8" text-anchor="middle">BANNED NOW</text>`);
    }

    // One pip per ban (2px gaps), then the count.
    const bans = Number(row.bans) || 0;
    const shown = Math.min(bans, 8);
    for (let i = 0; i < shown; i += 1) {
      out.push(`<rect x="${COL.pips + i * 14}" y="${mid - 9}" width="12" height="18" rx="4" fill="${C.ban}"/>`);
    }
    out.push(`<text x="${COL.pips + shown * 14 + 8}" y="${mid + 6}" fill="${C.ink}" font-size="16" font-weight="800">${bans}</text>`);

    // Total time banned: a bar on a faint track, value beside it.
    const width = Math.max(4, Math.round((Number(row.days) || 0) / maxDays * COL.barW));
    out.push(`<rect x="${COL.bar}" y="${mid - 5}" width="${COL.barW}" height="10" rx="5" fill="${C.banTrack}"/>`);
    out.push(`<rect x="${COL.bar}" y="${mid - 5}" width="${width}" height="10" rx="5" fill="${C.ban}"/>`);
    out.push(`<text x="${COL.bar + COL.barW + 12}" y="${mid + 5}" fill="${C.secondary}" font-size="14">${esc(months(row.days))}</text>`);

    out.push(`<text x="${COL.longest}" y="${mid + 5}" fill="${C.secondary}" font-size="14">${esc(months(row.longestDays))}</text>`);
    out.push(`<text x="${COL.latest}" y="${mid + 5}" fill="${C.secondary}" font-size="14" text-anchor="end">${esc(monthYear(row.lastStarted))}</text>`);
  });

  // Footer.
  const fy = HEAD + COLHEAD + rows.length * ROW + 40;
  out.push(`<text x="${PAD}" y="${fy}" fill="${C.muted}" font-size="13">Records from before 2023 may be incomplete. Updated daily.</text>`);
  out.push(`<text x="${W - PAD}" y="${fy}" fill="${C.emerald}" font-size="13" font-weight="700" text-anchor="end">smtop100.blog/transfer-bans</text>`);
  out.push('</svg>');
  return out.join('\n');
}

export default async (request) => {
  if (request.method !== 'GET') return new Response('Method not allowed.', { status: 405 });
  const url = Netlify.env.get('VITE_SUPABASE_URL');
  const key = Netlify.env.get('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) return new Response('Supabase public server configuration is missing.', { status: 500 });
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await supabase.rpc('public_transfer_ban_table', { p_limit: 10 });
  if (error) return new Response(`Could not load the table: ${error.message}`, { status: 502 });
  return new Response(svg(data), {
    headers: {
      'content-type': 'image/svg+xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'access-control-allow-origin': '*',
    },
  });
};

export { svg };
