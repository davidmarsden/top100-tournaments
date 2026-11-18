// Prize draw: emails each winner their prize and how to claim it. POST { drawId } with the
// signed-in organiser's Supabase access token as a Bearer token; prize_draw_winner_contacts()
// checks that the caller may manage the draw, and prize_draw_winners_emailed() records who was
// sent one, so calling again only emails the winners still to do (after a failure, say).
// A winner without a Manager Portal account, or added to the draw by hand, has no email on file
// and is listed in `missing`.
// Replies go to the admin team (MANAGER_CLAIM_ADMIN_EMAIL).
const json = (body, status = 200) => Response.json(body, { status });

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const supabaseUrl = Netlify.env.get('VITE_SUPABASE_URL');
  const anonKey = Netlify.env.get('VITE_SUPABASE_ANON_KEY');
  const resendApiKey = Netlify.env.get('RESEND_API_KEY');
  const adminEmail = Netlify.env.get('MANAGER_CLAIM_ADMIN_EMAIL');
  const emailFrom = Netlify.env.get('MANAGER_CLAIM_EMAIL_FROM') || 'Top 100 <notifications@smtop100.blog>';
  if (!supabaseUrl || !anonKey) return json({ error: 'Supabase is not configured.' }, 503);
  if (!resendApiKey) return json({ error: 'Email is not configured (RESEND_API_KEY).' }, 503);

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Sign in first.' }, 401);
  let drawId;
  try { drawId = Number((await request.json())?.drawId); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  if (!Number.isInteger(drawId) || drawId <= 0) return json({ error: 'A valid drawId is required.' }, 400);

  const rpc = (name, body) => fetch(`${supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  // As the signed-in organiser, so the function's own check decides.
  const response = await rpc('prize_draw_winner_contacts', { p_draw_id: drawId });
  const winners = await response.json().catch(() => null);
  if (!response.ok) return json({ error: winners?.message || `Could not read the winners (HTTP ${response.status}).` }, response.status === 401 ? 401 : 400);
  if (!Array.isArray(winners) || !winners.length) return json({ error: 'This draw has no winners.' }, 400);
  if (!winners[0].published) return json({ error: 'Publish the draw before emailing the winners.' }, 400);

  const sent = [], sentKeys = [], already = [], missing = [], failed = [];
  for (const winner of winners) {
    if (!winner.email) { missing.push(winner.name); continue; }
    if (winner.already_emailed) { already.push(winner.name); continue; }
    const prize = winner.prize || 'see the tournament page';
    const subject = `You won the ${winner.title}`;
    const text = `Hi ${winner.name},\n\nCongratulations! You're one of the winners of the ${winner.title}.\n\nYour prize: ${prize}.\n\n`
      + `${winner.how_to_claim ? `${winner.how_to_claim}\n\n` : ''}`
      + `The draw and all the winners are at ${winner.page_url}\n\nThe Top 100 admin team`;
    const html = '<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#172033">'
      + `<p>Hi ${escapeHtml(winner.name)},</p>`
      + `<p>Congratulations! You're one of the winners of the ${escapeHtml(winner.title)}.</p>`
      + `<p>Your prize: <strong>${escapeHtml(prize)}</strong>.</p>`
      + `${winner.how_to_claim ? `<p>${escapeHtml(winner.how_to_claim)}</p>` : ''}`
      + `<p>The draw and all the winners are on the <a href="${escapeHtml(winner.page_url)}">tournament page</a>.</p>`
      + '<p>The Top 100 admin team</p></body></html>';
    const result = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${resendApiKey}`, 'content-type': 'application/json', 'idempotency-key': `prize-draw-${drawId}-${winner.winner_key}` },
      body: JSON.stringify({ from: emailFrom, to: [winner.email], ...(adminEmail ? { reply_to: adminEmail } : {}), subject, text, html }),
    });
    if (result.ok) { sent.push(winner.name); sentKeys.push(winner.winner_key); } else failed.push(`${winner.name} (HTTP ${result.status})`);
  }

  // Record only the winners whose email went, so a failed one is retried next time.
  let allEmailed = false;
  if (sentKeys.length) {
    const recorded = await rpc('prize_draw_winners_emailed', { p_draw_id: drawId, p_winner_keys: sentKeys });
    allEmailed = recorded.ok && Boolean(await recorded.json().catch(() => null));
  } else allEmailed = failed.length === 0 && already.length > 0;
  return json({ ok: failed.length === 0, sent, already, missing, failed, allEmailed });
};
