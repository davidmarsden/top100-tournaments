const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json; charset=utf-8' },
  body: JSON.stringify(body),
});

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

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

export async function handler(event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey = process.env.RESEND_API_KEY;
  const adminEmail = process.env.MANAGER_CLAIM_ADMIN_EMAIL;
  const emailFrom = process.env.MANAGER_CLAIM_EMAIL_FROM || 'Top 100 Tournaments <notifications@resend.dev>';
  const adminUrl = process.env.MANAGER_ACCOUNTS_ADMIN_URL || `${process.env.URL || ''}/admin/manager-accounts`;

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json(503, { error: 'Supabase notification configuration is incomplete.' });
  }
  if (!resendApiKey || !adminEmail) {
    return json(202, { skipped: true, reason: 'Email notifications are not configured.' });
  }

  const authorization = event.headers.authorization || event.headers.Authorization;
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Authentication required.' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'Invalid JSON body.' }); }
  const claimId = Number(payload.claimId);
  if (!Number.isInteger(claimId) || claimId <= 0) return json(400, { error: 'A valid claimId is required.' });

  try {
    const user = await supabaseRequest(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization },
    });

    const serviceHeaders = {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
    };

    const rows = await supabaseRequest(
      `${supabaseUrl}/rest/v1/manager_portal_claims?id=eq.${claimId}&auth_user_id=eq.${encodeURIComponent(user.id)}&select=id,email,claimed_manager_name,claimed_club_name,status,admin_notified_at,created_at`,
      { headers: serviceHeaders },
    );
    const claim = rows?.[0];
    if (!claim) return json(404, { error: 'Manager claim not found.' });
    if (claim.status !== 'pending') return json(200, { skipped: true, reason: 'Claim is not pending.' });
    if (claim.admin_notified_at) return json(200, { skipped: true, reason: 'Administrator already notified.' });

    const reservedAt = new Date().toISOString();
    const reserved = await supabaseRequest(
      `${supabaseUrl}/rest/v1/manager_portal_claims?id=eq.${claimId}&admin_notified_at=is.null&select=id`,
      {
        method: 'PATCH',
        headers: { ...serviceHeaders, prefer: 'return=representation' },
        body: JSON.stringify({ admin_notified_at: reservedAt, admin_notification_error: null }),
      },
    );
    if (!reserved?.length) return json(200, { skipped: true, reason: 'Notification already reserved.' });

    const managerName = escapeHtml(claim.claimed_manager_name);
    const clubName = escapeHtml(claim.claimed_club_name);
    const claimantEmail = escapeHtml(claim.email);
    const reviewLink = escapeHtml(adminUrl);

    const emailResponse = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${resendApiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: emailFrom,
        to: [adminEmail],
        subject: `Manager account awaiting approval: ${claim.claimed_manager_name}`,
        html: `
          <div style="font-family:Arial,sans-serif;line-height:1.55;color:#172033">
            <h2 style="margin-bottom:8px">Manager account awaiting approval</h2>
            <p>A manager has submitted a Top 100 account claim.</p>
            <table style="border-collapse:collapse;margin:18px 0">
              <tr><td style="padding:6px 14px 6px 0;font-weight:bold">Manager</td><td>${managerName}</td></tr>
              <tr><td style="padding:6px 14px 6px 0;font-weight:bold">Club</td><td>${clubName}</td></tr>
              <tr><td style="padding:6px 14px 6px 0;font-weight:bold">Email</td><td>${claimantEmail}</td></tr>
            </table>
            <p><a href="${reviewLink}" style="display:inline-block;background:#1d4ed8;color:white;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:bold">Review manager claims</a></p>
            <p style="color:#5f6f8e;font-size:13px">This is an automatic notification from Top 100 Tournaments.</p>
          </div>`,
        text: `Manager account awaiting approval\n\nManager: ${claim.claimed_manager_name}\nClub: ${claim.claimed_club_name}\nEmail: ${claim.email}\n\nReview: ${adminUrl}`,
      }),
    });

    if (!emailResponse.ok) {
      const errorText = await emailResponse.text();
      await fetch(`${supabaseUrl}/rest/v1/manager_portal_claims?id=eq.${claimId}`, {
        method: 'PATCH',
        headers: serviceHeaders,
        body: JSON.stringify({ admin_notified_at: null, admin_notification_error: errorText.slice(0, 1000) }),
      });
      return json(502, { error: 'Email provider rejected the notification.' });
    }

    return json(200, { sent: true });
  } catch (error) {
    return json(500, { error: error.message || 'Could not send manager claim notification.' });
  }
}
