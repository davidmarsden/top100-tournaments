import { useEffect, useMemo, useState } from 'react';
import PublicTournamentPage from './PublicTournamentPage.jsx';
import PublicGroupTablesPortal from './PublicGroupTablesPortal.jsx';
import PublicForfeitRegisterPortal from './PublicForfeitRegisterPortal.jsx';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import { LIVE_STATUSES, parseTournamentPath, pickLiveTournament, routeTitle } from '../lib/publicTournamentRoutes';

const routeSelect = 'id, name, status, season_number, public_slug, slug, is_public, archive_quality, source, actual_entries, max_entries, game_worlds(id, name, slug), competition_types(id, name, slug)';

function isPlaceholderArchive(row) {
  return row?.archive_quality === 'placeholder' || (String(row?.status || '').toLowerCase() === 'archived' && Number(row?.actual_entries || 0) === 0 && row?.source !== 'challonge');
}

function publicRouteRows(rows = []) {
  return rows.filter((row) => row.is_public !== false && !isPlaceholderArchive(row));
}

export default function PublicTournamentRoute({ fallbackTournamentId }) {
  const route = useMemo(() => parseTournamentPath(), []);
  const [resolvedId, setResolvedId] = useState(route.mode === 'home' ? fallbackTournamentId : route.tournamentId || null);
  const [routes, setRoutes] = useState([]);
  const [status, setStatus] = useState(route.mode === 'home' || route.mode === 'id' ? '' : 'Finding tournament...');

  useEffect(() => { loadRoutes(); }, []);
  useEffect(() => {
    if (route.mode === 'home') { setResolvedId(fallbackTournamentId); return; }
    if (route.mode === 'id') { setResolvedId(route.tournamentId); return; }
    resolveRoute();
  }, [route.mode, route.worldSlug, route.competitionSlug, route.seasonSlug, fallbackTournamentId]);

  async function loadRoutes() {
    if (!hasSupabaseConfig || !supabase) return;
    let result = await supabase
      .from('tournaments')
      .select(routeSelect)
      .eq('is_public', true)
      .not('game_world_id', 'is', null)
      .not('competition_type_id', 'is', null)
      .order('season_number', { ascending: false });
    if (result.error) {
      result = await supabase
        .from('tournaments')
        .select('id, name, status, season_number, public_slug, slug, is_public, actual_entries, max_entries, game_worlds(id, name, slug), competition_types(id, name, slug)')
        .eq('is_public', true)
        .not('game_world_id', 'is', null)
        .not('competition_type_id', 'is', null)
        .order('season_number', { ascending: false });
    }
    setRoutes(publicRouteRows(result.data || []));
  }

  async function resolveRoute() {
    if (!hasSupabaseConfig || !supabase) {
      setResolvedId(fallbackTournamentId);
      setStatus('Supabase is not connected; showing default tournament.');
      return;
    }

    let query = supabase
      .from('tournaments')
      .select(routeSelect)
      .eq('is_public', true)
      .eq('game_worlds.slug', route.worldSlug)
      .eq('competition_types.slug', route.competitionSlug);

    if (route.seasonSlug) query = query.eq('public_slug', route.seasonSlug.toLowerCase());
    else query = query.in('status', LIVE_STATUSES);

    let { data, error } = await query;
    if (error) {
      let fallbackQuery = supabase
        .from('tournaments')
        .select('id, name, status, season_number, public_slug, slug, is_public, actual_entries, max_entries, game_worlds(id, name, slug), competition_types(id, name, slug)')
        .eq('is_public', true)
        .eq('game_worlds.slug', route.worldSlug)
        .eq('competition_types.slug', route.competitionSlug);
      if (route.seasonSlug) fallbackQuery = fallbackQuery.eq('public_slug', route.seasonSlug.toLowerCase());
      else fallbackQuery = fallbackQuery.in('status', LIVE_STATUSES);
      const fallback = await fallbackQuery;
      data = fallback.data;
      error = fallback.error;
    }
    if (error) {
      setResolvedId(fallbackTournamentId);
      setStatus('Could not resolve this route. Showing the default tournament for now.');
      return;
    }

    const candidates = publicRouteRows(data || []);
    const row = route.seasonSlug ? candidates[0] : pickLiveTournament(candidates);
    if (!row) {
      setStatus(`No public tournament found for ${routeTitle(route)}.`);
      setResolvedId(null);
      return;
    }

    setResolvedId(row.id);
    setStatus('');
  }

  if (resolvedId) return <>
    <PublicTournamentPage tournamentId={resolvedId} routeRows={routes} />
    <PublicGroupTablesPortal tournamentId={resolvedId} />
    <PublicForfeitRegisterPortal tournamentId={resolvedId} />
  </>;

  return <main className="app-shell public-archive tournament-hub">
    <section className="card">
      <p className="eyebrow">Tournament route</p>
      <h1>{routeTitle(route)}</h1>
      <p className="status">{status || 'Tournament not found.'}</p>
    </section>
  </main>;
}
