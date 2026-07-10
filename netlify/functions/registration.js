import { createClient } from '@supabase/supabase-js';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function reply(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function database() {
  const url = String(process.env.VITE_SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('Registration service is not configured.');
  return createClient(url, key, { auth: { persistSession: false } });
}

const keyOf = (value = '') => String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const emailOf = (value = '') => String(value).trim().toLowerCase();
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

async function resolveTournament(db, input) {
  if (input.tournamentId) {
    const result = await db.from('tournaments')
      .select('id, name, status, max_entries, actual_entries, registration_status, registration_opens_at, registration_closes_at, season_number, public_slug, game_worlds(name, slug), competition_types(name, slug)')
      .eq('id', Number(input.tournamentId)).maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  let query = db.from('tournaments')
    .select('id, name, status, max_entries, actual_entries, registration_status, registration_opens_at, registration_closes_at, season_number, public_slug, game_worlds!inner(name, slug), competition_types!inner(name, slug)')
    .eq('game_worlds.slug', input.worldSlug)
    .eq('competition_types.slug', input.competitionSlug)
    .eq('is_public', true);

  if (input.seasonSlug) query = query.eq('public_slug', input.seasonSlug);
  else query = query.in('status', ['draft', 'groups_approved', 'published']).order('season_number', { ascending: false }).limit(1);

  const result = await query;
  if (result.error) throw result.error;
  return result.data?.[0] || null;
}

function windowState(tournament) {
  const now = Date.now();
  const opens = tournament.registration_opens_at ? Date.parse(tournament.registration_opens_at) : null;
  const closes = tournament.registration_closes_at ? Date.parse(tournament.registration_closes_at) : null;
  if (tournament.registration_status !== 'open') return { open: false, reason: tournament.registration_status === 'full' ? 'Registration is full.' : 'Registration is not open.' };
  if (opens && now < opens) return { open: false, reason: 'Registration has not opened yet.' };
  if (closes && now >= closes) return { open: false, reason: 'Registration has closed.' };
  if (Number(tournament.actual_entries || 0) >= Number(tournament.max_entries || Infinity)) return { open: false, reason: 'Registration is full.' };
  return { open: true, reason: '' };
}

async function config(db, tournament) {
  const countResult = await db.from('tournament_registrations')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournament.id)
    .in('status', ['pending', 'approved']);
  if (countResult.error) throw countResult.error;
  return {
    tournament,
    window: windowState(tournament),
    registrationsReceived: countResult.count || 0,
    placesRemaining: Math.max(0, Number(tournament.max_entries || 0) - Number(tournament.actual_entries || 0)),
  };
}

async function submit(db, tournament, body) {
  const availability = windowState(tournament);
  if (!availability.open) return reply(409, { ok: false, error: availability.reason });

  const managerName = String(body.managerName || '').trim();
  const managerEmail = emailOf(body.managerEmail);
  const clubName = String(body.clubName || '').trim();
  const notes = String(body.notes || '').trim().slice(0, 1000) || null;
  const rating = body.rating === '' || body.rating === null || body.rating === undefined ? null : Number(body.rating);

  if (managerName.length < 2) return reply(400, { ok: false, error: 'Enter your manager name.' });
  if (!validEmail(managerEmail)) return reply(400, { ok: false, error: 'Enter a valid email address.' });
  if (clubName.length < 2) return reply(400, { ok: false, error: 'Enter your club name.' });
  if (rating !== null && !Number.isFinite(rating)) return reply(400, { ok: false, error: 'Rating must be a number.' });

  const managerKey = keyOf(managerName);
  const clubKey = keyOf(clubName);
  const duplicateResult = await db.from('tournament_registrations')
    .select('manager_key, email_key, club_key')
    .eq('tournament_id', tournament.id)
    .in('status', ['pending', 'approved'])
    .or(`manager_key.eq.${managerKey},email_key.eq.${managerEmail},club_key.eq.${clubKey}`);
  if (duplicateResult.error) throw duplicateResult.error;
  if (duplicateResult.data?.length) return reply(409, { ok: false, duplicate: true, error: 'This manager, email address or club is already registered.' });

  const result = await db.from('tournament_registrations').insert({
    tournament_id: tournament.id,
    manager_name: managerName,
    manager_email: managerEmail,
    club_name: clubName,
    rating,
    notes,
    status: 'pending',
    manager_key: managerKey,
    email_key: managerEmail,
    club_key: clubKey,
  }).select('id, submitted_at').single();

  if (result.error) {
    if (result.error.code === '23505') return reply(409, { ok: false, duplicate: true, error: 'This manager, email address or club is already registered.' });
    throw result.error;
  }

  return reply(201, { ok: true, registrationId: result.data.id, submittedAt: result.data.submitted_at, message: 'Registration received and awaiting admin approval.' });
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return reply(200, { ok: true });
  try {
    const body = event.httpMethod === 'POST' ? JSON.parse(event.body || '{}') : {};
    const query = event.queryStringParameters || {};
    const input = {
      tournamentId: body.tournamentId || query.tournamentId,
      worldSlug: body.worldSlug || query.worldSlug || 'top-100',
      competitionSlug: body.competitionSlug || query.competitionSlug || 'youth-cup',
      seasonSlug: body.seasonSlug || query.seasonSlug || null,
    };
    const db = database();
    const tournament = await resolveTournament(db, input);
    if (!tournament) return reply(404, { ok: false, error: 'Tournament not found.' });
    if (event.httpMethod === 'GET') return reply(200, { ok: true, ...(await config(db, tournament)) });
    if (event.httpMethod === 'POST') return await submit(db, tournament, body);
    return reply(405, { ok: false, error: 'Method not allowed.' });
  } catch (error) {
    return reply(500, { ok: false, error: error.message });
  }
}
