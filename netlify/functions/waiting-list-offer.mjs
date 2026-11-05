// Waiting list (rule 3.3): emails an applicant their club offer. POST { entryId } with the signed-in
// official's Supabase access token as a Bearer token; waiting_list_offer_details() checks that the
// caller is an official and that the entry has an open offer, and waiting_list_offer_emailed()
// records the send once Resend has accepted it.
// Replies go to the admin team (MANAGER_CLAIM_ADMIN_EMAIL).
const json = (body, status = 200) => Response.json(body, { status });

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

const longDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' }) : '');

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
  let entryId, sendId;
  try {
    const body = await request.json();
    entryId = Number(body?.entryId);
    // One id per click: a deliberate resend is a new email, while a retried request of the same
    // click reuses the key and isn't sent twice.
    sendId = /^[A-Za-z0-9-]{8,64}$/.test(String(body?.sendId || '')) ? String(body.sendId) : crypto.randomUUID();
  } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  if (!Number.isInteger(entryId) || entryId <= 0) return json({ error: 'A valid entryId is required.' }, 400);

  // As the signed-in official, so the function's own check decides.
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/waiting_list_offer_details`, {
    method: 'POST',
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_id: entryId }),
  });
  const offer = await response.json().catch(() => null);
  if (!response.ok) return json({ error: offer?.message || `Could not read the offer (HTTP ${response.status}).` }, response.status === 401 ? 401 : 400);

  const deadline = longDate(offer.deadline);
  const subject = `${offer.world}: you're offered ${offer.club}`;
  const text = `Hi ${offer.managerName},\n\nGood news from the ${offer.world} waiting list: the admin team would like to offer you ${offer.club}.\n\n`
    + `${deadline ? `Please reply to this email by ${deadline} to accept. ` : 'Please reply to this email to accept. '}If we don't hear from you by then, the club will be offered to the next manager on the list.\n\n`
    + `Once you've accepted and taken over the club in Soccer Manager, link it to your Manager Account at https://manager.smtop100.blog/\n\nThe Top 100 admin team`;
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#172033">`
    + `<p>Hi ${escapeHtml(offer.managerName)},</p>`
    + `<p>Good news from the ${escapeHtml(offer.world)} waiting list: the admin team would like to offer you <strong>${escapeHtml(offer.club)}</strong>.</p>`
    + `<p>${deadline ? `Please reply to this email by <strong>${escapeHtml(deadline)}</strong> to accept. ` : 'Please reply to this email to accept. '}If we don't hear from you by then, the club will be offered to the next manager on the list.</p>`
    + `<p>Once you've accepted and taken over the club in Soccer Manager, link it to your <a href="https://manager.smtop100.blog/">Manager Account</a>.</p>`
    + `<p>The Top 100 admin team</p></body></html>`;

  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${resendApiKey}`, 'content-type': 'application/json', 'idempotency-key': `waiting-list-offer-${entryId}-${sendId}` },
    body: JSON.stringify({ from: emailFrom, to: [offer.email], ...(adminEmail ? { reply_to: adminEmail, bcc: [adminEmail] } : {}), subject, text, html }),
  });
  if (!sent.ok) return json({ error: `The email could not be sent (HTTP ${sent.status}): ${(await sent.text()).slice(0, 300)}` }, 502);
  // Only now record the send, so "Offer emailed" never shows for an email that didn't go.
  const recorded = await fetch(`${supabaseUrl}/rest/v1/rpc/waiting_list_offer_emailed`, {
    method: 'POST',
    headers: { apikey: anonKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ p_id: entryId }),
  });
  return json({ ok: true, to: offer.email, recorded: recorded.ok });
};
