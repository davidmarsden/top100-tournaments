const json = (body, status = 200) => Response.json(body, { status });

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function supabaseRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) {
    const message = data?.message || data?.error_description || data?.error || text || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return data;
}

async function sendResendEmail(resendApiKey, body) {
  const maxAttempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${resendApiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (response.ok) return;

      const errorText = await response.text();
      const error = new Error(`Resend rejected the notification: ${errorText.slice(0, 800)}`);
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maxAttempts) throw error;
      lastError = error;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
    }

    await sleep(500 * (2 ** (attempt - 1)));
  }

  throw lastError || new Error('Resend delivery failed.');
}

export default async (request) => {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const supabaseUrl = Netlify.env.get('VITE_SUPABASE_URL');
  const serviceRoleKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendApiKey = Netlify.env.get('RESEND_API_KEY');
  const adminEmail = Netlify.env.get('MANAGER_CLAIM_ADMIN_EMAIL');
  const webhookSecret = Netlify.env.get('MANAGER_CLAIM_WEBHOOK_SECRET');
  const emailFrom = Netlify.env.get('MANAGER_CLAIM_EMAIL_FROM') || 'Top 100 Tournaments <notifications@smtop100.blog>';
  const adminUrl = Netlify.env.get('MANAGER_ACCOUNTS_ADMIN_URL') || 'https://youth-cup.smtop100.blog/admin/manager-accounts';

  if (!supabaseUrl || !serviceRoleKey) {
    return json({ error: 'Supabase notification configuration is incomplete.' }, 503);
  }
  if (!webhookSecret || request.headers.get('x-manager-claim-webhook-secret') !== webhookSecret) {
    return json({ error: 'Invalid webhook credentials.' }, 401);
  }
  if (!resendApiKey || !adminEmail) {
    return json({ skipped: true, reason: 'Email notifications are not configured.' }, 202);
  }

  let payload;
  try { payload = await request.json(); } catch { return json({ error: 'Invalid JSON body.' }, 400); }
  const claimId = Number(payload?.claimId);
  if (!Number.isInteger(claimId) || claimId <= 0) return json({ error: 'A valid claimId is required.' }, 400);

  const serviceHeaders = {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  };
  let reservationMade = false;
  let reservedAt = null;

  try {
    const rows = await supabaseRequest(
      `${supabaseUrl}/rest/v1/manager_portal_claims?id=eq.${claimId}&select=id,email,claimed_manager_name,claimed_club_name,status,admin_notified_at,created_at`,
      { headers: serviceHeaders },
    );
    const claim = rows?.[0];
    if (!claim) return json({ error: 'Manager claim not found.' }, 404);
    if (claim.status !== 'pending') return json({ skipped: true, reason: 'Claim is not pending.' });
    if (claim.admin_notified_at) return json({ skipped: true, reason: 'Administrator already notified.' });

    reservedAt = new Date().toISOString();
    const reserved = await supabaseRequest(
      `${supabaseUrl}/rest/v1/manager_portal_claims?id=eq.${claimId}&status=eq.pending&admin_notified_at=is.null&select=id`,
      {
        method: 'PATCH',
        headers: { ...serviceHeaders, prefer: 'return=representation' },
        body: JSON.stringify({ admin_notified_at: reservedAt, admin_notification_error: null }),
      },
    );
    if (!reserved?.length) return json({ skipped: true, reason: 'Claim was reviewed or notification already reserved.' });
    reservationMade = true;

    const managerName = escapeHtml(claim.claimed_manager_name);
    const clubName = escapeHtml(claim.claimed_club_name);
    const claimantEmail = escapeHtml(claim.email);
    const reviewLink = escapeHtml(adminUrl);

    await sendResendEmail(resendApiKey, {
      from: emailFrom,
      to: [adminEmail],
      subject: `Manager account awaiting approval: ${claim.claimed_manager_name}`,
      html: `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#172033"><h2>Manager account awaiting approval</h2><p>A manager has submitted a Top 100 account claim.</p><table><tr><td><strong>Manager</strong></td><td>${managerName}</td></tr><tr><td><strong>Club</strong></td><td>${clubName}</td></tr><tr><td><strong>Email</strong></td><td>${claimantEmail}</td></tr></table><p><a href="${reviewLink}">Review manager claims</a></p><p style="color:#5f6f8e;font-size:13px">Automatic notification from Top 100 Tournaments.</p></body></html>`,
      text: `Manager account awaiting approval\n\nManager: ${claim.claimed_manager_name}\nClub: ${claim.claimed_club_name}\nEmail: ${claim.email}\n\nReview: ${adminUrl}`,
    });

    return json({ sent: true });
  } catch (error) {
    if (reservationMade && reservedAt) {
      const encodedReservedAt = encodeURIComponent(reservedAt);
      await fetch(`${supabaseUrl}/rest/v1/manager_portal_claims?id=eq.${claimId}&status=eq.pending&admin_notified_at=eq.${encodedReservedAt}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({
          admin_notified_at: null,
          admin_notification_error: String(error.message || error).slice(0, 1000),
        }),
      }).catch(() => {});
    }
    return json({ error: error.message || 'Could not send manager claim notification.' }, 500);
  }
};
