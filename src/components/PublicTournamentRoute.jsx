import { useEffect, useMemo, useState } from 'react';
import PublicTournamentPage from './PublicTournamentPage.jsx';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const LIVE_STATUSES = ['published', 'groups_approved', 'draft', 'completed'];

function routeParts(pathname = window.location.pathname) {
  const parts = pathname.split('/').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const [worldSlug, competitionSlug, seasonSlug] = parts;
  if (!worldSlug || !competitionSlug) return null;
  return { worldSlug, competitionSlug, seasonSlug: seasonSlug || null };
}
function normalStatus(row) { return String(row?.status || '').toLowerCase(); }
function routeTitle(parts) {
  if (!parts) return 'Tournament';
  return `${parts.worldSlug} / ${parts.competitionSlug}${parts.seasonSlug ? ' / ' + parts.seasonSlug : ''}`.replaceAll('-', ' ');
}
function pickLiveTournament(rows = []) {
  const ranked = [...rows].sort((a, b) => {
    const aRank = LIVE_STATUSES.indexOf(normalStatus(a));
    const bRank = LIVE_STATUSES.indexOf(normalStatus(b));
    const ar = aRank === -1 ? 99 : aRank;
    const br = bRank === -1 ? 99 : bRank;
    return ar - br || Number(b.season_number || 0) - Number(a.season_number || 0) || Number(b.id || 0) - Number(a.id || 0);
  });
  return ranked[0] || null;
}

export default function PublicTournamentRoute({ fallbackTournamentId }) {
  const parts = useMemo(() => routeParts(), []);
  const [resolvedId, setResolvedId] = useState(parts ? null : fallbackTournamentId);
  const [status, setStatus] = useState(parts ? 'Finding tournament...' : '');

  useEffect(() => {
    if (!parts) { setResolvedId(fallbackTournamentId); return; }
    resolveRoute();
  }, [parts?.worldSlug, parts?.competitionSlug, parts?.seasonSlug, fallbackTournamentId]);

  async function resolveRoute() {
    if (!hasSupabaseConfig || !supabase) {
      setResolvedId(fallbackTournamentId);
      setStatus('Supabase is not connected; showing default tournament.');
      return;
    }

    const select = 'id, name, status, season_number, public_slug, is_public, game_worlds!inner(slug), competition_types!inner(slug)';
    let query = supabase
      .from('tournaments')
      .select(select)
      .eq('is_public', true)
      .eq('game_worlds.slug', parts.worldSlug)
      .eq('competition_types.slug', parts.competitionSlug);

    if (parts.seasonSlug) query = query.eq('public_slug', parts.seasonSlug.toLowerCase());
    else query = query.in('status', LIVE_STATUSES);

    const { data, error } = await query;
    if (error) {
      setResolvedId(fallbackTournamentId);
      setStatus('Could not resolve route yet. Run the V2.1 SQL migration, then this URL will work. Showing default tournament for now.');
      return;
    }

    const row = parts.seasonSlug ? (data || [])[0] : pickLiveTournament(data || []);
    if (!row) {
      setStatus(`No public tournament found for ${routeTitle(parts)}.`);
      setResolvedId(null);
      return;
    }

    setResolvedId(row.id);
    setStatus('');
  }

  if (resolvedId) return <PublicTournamentPage tournamentId={resolvedId} />;

  return <main className="app-shell public-archive tournament-hub">
    <section className="card">
      <p className="eyebrow">Tournament route</p>
      <h1>{routeTitle(parts)}</h1>
      <p className="status">{status || 'Tournament not found.'}</p>
    </section>
  </main>;
}
