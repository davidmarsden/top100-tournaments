import { createClient } from '@supabase/supabase-js';

const headers = { 'Content-Type': 'application/json' };

function reply(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

function database() {
  const url = String(process.env.VITE_SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('Registration service is not configured.');
  return createClient(url, key, { auth: { persistSession: false } });
}

const keyOf = (value = '') => String(value)
  .normalize('NFKD')
  .replace(/\p{Diacritic}/gu, '')
  .trim()
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, '');

async function resolveTournament(db, input) {
  const fields = 'id, name, status, max_entries, actual_entries, registration_status, registration_opens_at, registration_closes_at, season_number, public_slug, game_world_id, game_worlds(name, slug), competition_types(name, slug)';
  if (input.tournamentId) {
    const result = await db.from('tournaments').select(fields).eq('id', Number(input.tournamentId)).maybeSingle();
    if (result.error) throw result.error;
    return result.data;
  }

  let query = db.from('tournaments')
    .select('id, name, status, max_entries, actual_entries, registration_status, registration_opens_at, registration_closes_at, season_number, public_slug, game_world_id, game_worlds!inner(name, slug), competition_types!inner(name, slug)')
    .eq('game_worlds.slug', input.worldSlug)
    .eq('competition_types.slug', input.competitionSlug)
    .eq('is_public', true);

  if (input.seasonSlug) query = query.eq('public_slug', input.seasonSlug);
  else query = query.in('status', ['draft', 'groups_approved', 'published']).order('season_number', { ascending: false }).limit(1);

  const result = await query;
  if (result.error) throw result.error;
  return result.data?.[0] || null;
}

function capacity(tournament) {
  const maxEntries = Number(tournament.max_entries || 0);
  return Number.isFinite(maxEntries) && maxEntries > 0 ? maxEntries : null;
}

function windowState(tournament) {
  const now = Date.now();
  const opens = tournament.registration_opens_at ? Date.parse(tournament.registration_opens_at) : null;
  const closes = tournament.registration_closes_at ? Date.parse(tournament.registration_closes_at) : null;
  const maxEntries = capacity(tournament);
  if (tournament.registration_status !== 'open') return { open: false, reason: tournament.registration_status === 'full' ? 'Registration is full.' : 'Registration is not open.' };
  if (opens && now < opens) return { open: false, reason: 'Registration has not opened yet.' };
  if (closes && now >= closes) return { open: false, reason: 'Registration has closed.' };
  if (maxEntries && Number(tournament.actual_entries || 0) >= maxEntries) return { open: false, reason: 'Registration is full.' };
  return { open: true, reason: '' };
}

async function config(db, tournament) {
  const [clubsResult, registrationsResult] = await Promise.all([
    db.from('game_world_clubs')
      .select('id, club_name, current_manager_name')
      .eq('game_world_id', tournament.game_world_id)
      .eq('active', true)
      .eq('occupied', true)
      .order('club_name'),
    db.from('tournament_registrations')
      .select('id, manager_name, club_name, rating, status, submitted_at, promoted_entry_id')
      .eq('tournament_id', tournament.id)
      .in('status', ['pending', 'approved'])
      .order('submitted_at', { ascending: true }),
  ]);
  if (clubsResult.error) throw clubsResult.error;
  if (registrationsResult.error) throw registrationsResult.error;

  const registrations = registrationsResult.data || [];
  const maxEntries = capacity(tournament);
  return {
    tournament,
    window: windowState(tournament),
    clubs: clubsResult.data || [],
    registrations,
    registrationsReceived: registrations.length,
    placesRemaining: maxEntries ? Math.max(0, maxEntries - registrations.length) : null,
    capacityDecided: Boolean(maxEntries),
  };
}

async function resolveClub(db, tournament, body) {
  let query = db.from('game_world_clubs')
    .select('id, club_name, club_key, current_manager_name, manager_key, occupied, active')
    .eq('game_world_id', tournament.game_world_id)
    .eq('active', true)
    .eq('occupied', true);
  if (body.clubId) query = query.eq('id', Number(body.clubId));
  else query = query.eq('club_key', keyOf(body.clubName || ''));
  const result = await query.maybeSingle();
  if (result.error) throw result.error;
  return result.data;
}

async function signedInAccount(db, event, tournament) {
  const authorization = String(event.headers?.authorization || event.headers?.Authorization || '');
  const token = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
  if (!token) return null;
  const { data: userData, error: userError } = await db.auth.getUser(token);
  if (userError || !userData?.user?.id) return null;
  const accountResult = await db.from('manager_portal_accounts')
    .select('auth_user_id, manager_id, game_world_id, active')
    .eq('auth_user_id', userData.user.id)
    .eq('active', true)
    .maybeSingle();
  if (accountResult.error || !accountResult.data || Number(accountResult.data.game_world_id) !== Number(tournament.game_world_id)) return null;
  return accountResult.data;
}

async function submit(db, tournament, body, event) {
  const availability = windowState(tournament);
  if (!availability.open) return reply(409, { ok: false, error: availability.reason });

  const managerName = String(body.managerName || '').trim();
  const rating = Number(body.rating);
  if (managerName.length < 2) return reply(400, { ok: false, error: 'Enter your manager name.' });
  if (!Number.isInteger(rating) || rating < 65 || rating > 90) return reply(400, { ok: false, error: 'Choose an average team rating from 65 to 90.' });

  const club = await resolveClub(db, tournament, body);
  if (!club) return reply(400, { ok: false, error: 'Choose a currently managed club from this game world.' });
  if (!club.current_manager_name || keyOf(club.current_manager_name) !== keyOf(managerName)) {
    return reply(409, {
      ok: false,
      managerMismatch: true,
      expectedManager: club.current_manager_name,
      error: `${club.club_name} is currently listed as managed by ${club.current_manager_name || 'another manager'}. Check your manager name and club selection.`,
    });
  }

  const managerKey = club.manager_key || keyOf(managerName);
  const duplicateResult = await db.from('tournament_registrations')
    .select('id, manager_name, club_name')
    .eq('tournament_id', tournament.id)
    .in('status', ['pending', 'approved'])
    .or(`manager_key.eq.${managerKey},club_key.eq.${club.club_key}`);
  if (duplicateResult.error) throw duplicateResult.error;
  if (duplicateResult.data?.length) {
    const duplicate = duplicateResult.data[0];
    return reply(409, { ok: false, duplicate: true, existingRegistration: duplicate, error: `${duplicate.club_name} is already registered for this tournament.` });
  }

  const account = await signedInAccount(db, event, tournament);
  const result = await db.from('tournament_registrations').insert({
    tournament_id: tournament.id,
    manager_name: club.current_manager_name,
    manager_email: null,
    club_name: club.club_name,
    rating,
    notes: null,
    status: 'pending',
    manager_key: managerKey,
    email_key: '',
    club_key: club.club_key,
    auth_user_id: account?.auth_user_id || null,
    manager_id: account?.manager_id || null,
  }).select('id, manager_name, club_name, rating, status, submitted_at').single();

  if (result.error) {
    if (result.error.code === '23505') return reply(409, { ok: false, duplicate: true, error: 'This manager or club is already registered.' });
    throw result.error;
  }

  return reply(201, {
    ok: true,
    registration: result.data,
    registrationId: result.data.id,
    submittedAt: result.data.submitted_at,
    linkedToPortal: Boolean(account),
    message: 'Registration received.',
  });
}

export async function handler(event) {
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
    if (event.httpMethod === 'POST') return await submit(db, tournament, body, event);
    return reply(405, { ok: false, error: 'Method not allowed.' });
  } catch (error) {
    return reply(500, { ok: false, error: error.message });
  }
}
