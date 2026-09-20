import { createClient } from '@supabase/supabase-js';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function publicSupabaseClient() {
  const url = Netlify.env.get('VITE_SUPABASE_URL');
  const key = Netlify.env.get('VITE_SUPABASE_ANON_KEY');
  if (!url || !key) throw new Error('Supabase public server configuration is missing.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

export default async (request) => {
  if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);

  const url = new URL(request.url);
  const tournamentId = Number(url.searchParams.get('id'));
  if (!Number.isInteger(tournamentId) || tournamentId < 1) {
    return json({ error: 'A valid tournament id is required.' }, 400);
  }

  try {
    const supabase = publicSupabaseClient();

    let tournamentResult = await supabase
      .from('tournaments')
      .select('id, name, status, rules_notes, secondary_bracket_name, max_entries, actual_entries, group_count, teams_per_group, knockout_teams, tournament_structure, season_number, public_slug, slug, is_public, registration_status, game_worlds(id, name, slug), competition_types(id, name, slug)')
      .eq('id', tournamentId)
      .eq('is_public', true)
      .maybeSingle();

    if (tournamentResult.error) {
      tournamentResult = await supabase
        .from('tournaments')
        .select('id, name, status, rules_notes, secondary_bracket_name, max_entries, actual_entries, group_count, teams_per_group, knockout_teams')
        .eq('id', tournamentId)
        .eq('is_public', true)
        .maybeSingle();
    }

    if (tournamentResult.error) throw tournamentResult.error;
    if (!tournamentResult.data) return json({ error: 'Tournament not found.' }, 404);

    const knockoutOnly = tournamentResult.data.tournament_structure === 'knockout_only';

    const [matchesResult, entriesResult, roundDatesResult, finalResolutionResult, honoursResult, forfeitsResult] = await Promise.all([
      supabase
        .from('matches')
        .select('id, stage, round, leg, match_order, fixture_date, home_entry_id, away_entry_id, home_score, away_score, home_normal_time_score, away_normal_time_score, winner_entry_id, loser_entry_id, decided_by, home_extra_time_score, away_extra_time_score, home_penalty_score, away_penalty_score, status, bracket, home_placeholder, away_placeholder, groups(id, code, name), home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(id, name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(id, name))')
        .eq('tournament_id', tournamentId),
      supabase
        .from('tournament_entries')
        .select('id, seed, rating, pot, group_code, prize_draw_eligible, teams(id, name), managers(id, name, display_name)')
        .eq('tournament_id', tournamentId)
        .order('seed', { ascending: true }),
      supabase
        .from('tournament_round_dates')
        .select('id, bracket, round, leg1_date, leg2_date')
        .eq('tournament_id', tournamentId),
      knockoutOnly
        ? supabase.rpc('public_knockout_final_resolved', { target_tournament_id: tournamentId })
        : Promise.resolve({ data: false, error: null }),
      supabase
        .from('honours')
        .select('id, honour, position, tournament_id, tournaments(id, name), entry:tournament_entries!honours_entry_id_fkey(id, teams(id, name), managers(id, name, display_name))')
        .order('tournament_id', { ascending: false }),
      supabase
        .from('forfeits')
        .select('id, reason, penalty, affects_prize_draw, match_id, forfeiting_entry:tournament_entries!forfeits_forfeiting_entry_id_fkey(id, teams(id, name), managers(id, name, display_name))'),
    ]);

    if (matchesResult.error) throw matchesResult.error;

    const matchIds = new Set((matchesResult.data || []).map((match) => match.id));
    const forfeits = forfeitsResult.error
      ? []
      : (forfeitsResult.data || []).filter((row) => matchIds.has(row.match_id));

    return json({
      tournament: tournamentResult.data,
      matches: matchesResult.data || [],
      entries: entriesResult.error ? [] : (entriesResult.data || []),
      roundDates: roundDatesResult.error ? [] : (roundDatesResult.data || []),
      knockoutFinalPublicResolved: !finalResolutionResult.error && Boolean(finalResolutionResult.data),
      honours: honoursResult.error ? [] : (honoursResult.data || []),
      forfeits,
    });
  } catch (error) {
    console.error('public-tournament-data failed', error);
    return json({ error: error?.message || 'Could not load tournament data.' }, 502);
  }
};

export const config = {
  path: '/api/public-tournament-data',
};
