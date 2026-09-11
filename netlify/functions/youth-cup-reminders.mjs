const json = (body, status = 200) => Response.json(body, { status });

const TERMINAL_MATCH_STATUSES = new Set(['played', 'forfeit', 'voided', 'cancelled']);

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;').replaceAll("'", '&#039;');

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new Error(data?.message || data?.error || text || `HTTP ${response.status}`);
  return data;
}

function isoDay(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function addDays(day, amount) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return isoDay(date);
}

function matchTypeForToday(match, prefs, today) {
  if (!match.fixture_date || TERMINAL_MATCH_STATUSES.has(match.status)) return null;
  if (prefs.deadline_day && match.fixture_date === today) return 'deadline_day';
  if (prefs.day_before && match.fixture_date === addDays(today, 1)) return 'day_before';
  if (prefs.fixture_assigned && match.fixture_date > today) return 'fixture_assigned';
  return null;
}

function deliveryKeyFor(accountId, match, type) {
  const scheduleVersion = ['day_before', 'deadline_day'].includes(type) ? `:${match.fixture_date}` : '';
  return `youth-cup:${accountId}:${match.id}:${type}${scheduleVersion}`;
}

function subjectFor(type, club, opponent) {
  if (type === 'deadline_day') return `Youth Cup today: ${club} v ${opponent}`;
  if (type === 'day_before') return `Youth Cup reminder: ${club} play tomorrow`;
  return `New Youth Cup fixture: ${club} v ${opponent}`;
}

function bodyFor(type, details) {
  const { club, opponent, venue, fixtureDate, stage, round, tournamentUrl } = details;
  const intro = type === 'deadline_day'
    ? 'Your Youth Cup fixture date is today and the result is still outstanding.'
    : type === 'day_before'
      ? 'A quick reminder that your Youth Cup fixture is tomorrow.'
      : 'A Youth Cup fixture has been assigned to your club.';
  const roundText = [stage, round].filter(Boolean).join(' · ');
  const responsibilitiesHtml = '<p><strong>Your responsibility as manager</strong></p><ul><li>Arrange the match with your opponent in good time.</li><li>For Saturday fixtures, the Soccer Manager match request must be sent <strong>before Wednesday</strong>.</li><li>Make sure the match is played and the result is submitted through the Manager Portal.</li><li>If there is a problem arranging or playing the fixture, contact your opponent and the tournament organiser promptly rather than waiting for the deadline.</li></ul><p>These reminders are a courtesy and do not replace the Youth Cup rules or manager responsibilities.</p>';
  const responsibilitiesText = 'Your responsibility as manager:\n- Arrange the match with your opponent in good time.\n- For Saturday fixtures, the Soccer Manager match request must be sent before Wednesday.\n- Make sure the match is played and the result is submitted through the Manager Portal.\n- If there is a problem arranging or playing the fixture, contact your opponent and the tournament organiser promptly rather than waiting for the deadline.\n\nThese reminders are a courtesy and do not replace the Youth Cup rules or manager responsibilities.';
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;line-height:1.55;color:#172033"><h2>${escapeHtml(subjectFor(type, club, opponent))}</h2><p>${escapeHtml(intro)}</p><p><strong>${escapeHtml(club)}</strong> · ${escapeHtml(venue)} v ${escapeHtml(opponent)}<br>${escapeHtml(fixtureDate)}${roundText ? `<br>${escapeHtml(roundText)}` : ''}</p>${responsibilitiesHtml}<p><a href="${escapeHtml(tournamentUrl)}">Open Youth Cup</a> · <a href="https://manager.smtop100.blog/">Manager Portal</a></p><p style="color:#5f6f8e;font-size:13px">You opted in to Youth Cup reminders in your Manager Portal. You can change or switch off reminders there at any time.</p></body></html>`;
  const text = `${intro}\n\n${club} · ${venue} v ${opponent}\n${fixtureDate}${roundText ? `\n${roundText}` : ''}\n\n${responsibilitiesText}\n\nYouth Cup: ${tournamentUrl}\nManager Portal: https://manager.smtop100.blog/\n\nYou opted in to these reminders in your Manager Portal.`;
  return { html, text };
}

async function sendResend(apiKey, payload, idempotencyKey) {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
      'idempotency-key': idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Resend HTTP ${response.status}: ${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

export default async () => {
  const supabaseUrl = Netlify.env.get('VITE_SUPABASE_URL');
  const serviceRoleKey = Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const resendApiKey = Netlify.env.get('RESEND_API_KEY');
  const emailFrom = Netlify.env.get('YOUTH_CUP_REMINDER_EMAIL_FROM') || 'Top 100 Youth Cup <notifications@smtop100.blog>';
  const tournamentUrl = Netlify.env.get('YOUTH_CUP_PUBLIC_URL') || 'https://tournaments.smtop100.blog/top-100/youth-cup';

  if (!supabaseUrl || !serviceRoleKey || !resendApiKey) return json({ skipped: true, reason: 'Reminder delivery is not fully configured.' }, 202);

  const headers = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}`, 'content-type': 'application/json' };
  const today = isoDay();
  let sent = 0; let skipped = 0; const errors = [];

  try {
    const competitionTypes = await requestJson(`${supabaseUrl}/rest/v1/competition_types?slug=eq.youth-cup&select=id`, { headers });
    const youthCupTypeId = competitionTypes?.[0]?.id;
    if (!youthCupTypeId) return json({ skipped: true, reason: 'Youth Cup competition type was not found.' }, 202);

    const prefs = await requestJson(`${supabaseUrl}/rest/v1/manager_reminder_preferences?youth_cup_enabled=eq.true&select=account_id,fixture_assigned,day_before,deadline_day`, { headers });
    for (const pref of prefs || []) {
      const accounts = await requestJson(`${supabaseUrl}/rest/v1/manager_portal_accounts?id=eq.${pref.account_id}&active=eq.true&select=id,manager_id,email,game_world_id,game_worlds!inner(slug)`, { headers });
      const account = accounts?.[0];
      if (!account || account.game_worlds?.slug !== 'top-100' || !account.email) { skipped += 1; continue; }

      const tournaments = await requestJson(`${supabaseUrl}/rest/v1/tournaments?game_world_id=eq.${account.game_world_id}&competition_type_id=eq.${youthCupTypeId}&is_public=eq.true&status=not.in.(archived,completed)&select=id,name,public_slug,season_number,status&order=season_number.desc`, { headers });
      const tournamentIds = (tournaments || []).map((row) => row.id);
      if (!tournamentIds.length) { skipped += 1; continue; }

      const entries = await requestJson(`${supabaseUrl}/rest/v1/tournament_entries?manager_id=eq.${account.manager_id}&tournament_id=in.(${tournamentIds.join(',')})&select=id,tournament_id,teams(name)`, { headers });
      if (!entries?.length) { skipped += 1; continue; }
      const entryIds = entries.map((entry) => entry.id).join(',');
      const matches = await requestJson(`${supabaseUrl}/rest/v1/matches?or=(home_entry_id.in.(${entryIds}),away_entry_id.in.(${entryIds}))&status=not.in.(played,forfeit,voided,cancelled)&select=id,tournament_id,stage,round,status,fixture_date,home_entry_id,away_entry_id,home_entry:tournament_entries!matches_home_entry_id_fkey(id,teams(name)),away_entry:tournament_entries!matches_away_entry_id_fkey(id,teams(name))`, { headers });

      for (const match of matches || []) {
        const ownEntry = entries.find((entry) => entry.id === match.home_entry_id || entry.id === match.away_entry_id);
        if (!ownEntry || ownEntry.tournament_id !== match.tournament_id) continue;
        const type = matchTypeForToday(match, pref, today);
        if (!type) continue;
        const deliveryKey = deliveryKeyFor(account.id, match, type);
        const prior = await requestJson(`${supabaseUrl}/rest/v1/manager_reminder_deliveries?delivery_key=eq.${encodeURIComponent(deliveryKey)}&select=id`, { headers });
        if (prior?.length) { skipped += 1; continue; }

        const isHome = match.home_entry_id === ownEntry.id;
        const club = ownEntry.teams?.name || 'Your club';
        const opponent = isHome ? (match.away_entry?.teams?.name || 'TBC') : (match.home_entry?.teams?.name || 'TBC');
        const venue = isHome ? 'Home' : 'Away';
        const details = { club, opponent, venue, fixtureDate: match.fixture_date || 'Date TBC', stage: match.stage, round: match.round, tournamentUrl };
        const body = bodyFor(type, details);

        try {
          const provider = await sendResend(resendApiKey, { from: emailFrom, to: [account.email], subject: subjectFor(type, club, opponent), html: body.html, text: body.text }, deliveryKey);
          await requestJson(`${supabaseUrl}/rest/v1/manager_reminder_deliveries`, {
            method: 'POST', headers: { ...headers, prefer: 'return=minimal' },
            body: JSON.stringify({ account_id: account.id, match_id: match.id, reminder_type: type, delivery_key: deliveryKey, provider_message_id: provider?.id || null }),
          });
          sent += 1;
        } catch (error) {
          errors.push({ accountId: account.id, matchId: match.id, type, error: String(error.message || error).slice(0, 500) });
        }
      }
    }
    return json({ ok: errors.length === 0, date: today, sent, skipped, errors });
  } catch (error) {
    return json({ error: error.message || 'Youth Cup reminder run failed.' }, 500);
  }
};

export const config = { schedule: '@hourly' };
