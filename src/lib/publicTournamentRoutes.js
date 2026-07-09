export const LIVE_STATUSES = ['published', 'groups_approved', 'draft', 'completed'];

export function parseTournamentPath(pathname = window.location.pathname) {
  const parts = pathname.split('/').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { mode: 'home' };
  const legacy = pathname.match(/^\/(?:tournaments|public)\/(\d+)\/?$/);
  if (legacy) return { mode: 'id', tournamentId: Number(legacy[1]) };
  if (parts.length < 2) return { mode: 'unknown', parts };
  const [worldSlug, competitionSlug, seasonSlug] = parts;
  return { mode: 'slug', worldSlug, competitionSlug, seasonSlug: seasonSlug || null };
}

export function normalStatus(row) {
  return String(row?.status || '').toLowerCase();
}

export function routeTitle(parts) {
  if (!parts || parts.mode === 'home') return 'Tournament Centre';
  if (parts.mode === 'id') return `Tournament ${parts.tournamentId}`;
  return `${parts.worldSlug} / ${parts.competitionSlug}${parts.seasonSlug ? ' / ' + parts.seasonSlug : ''}`.replaceAll('-', ' ');
}

export function pickLiveTournament(rows = []) {
  const ranked = [...rows].sort((a, b) => {
    const aRank = LIVE_STATUSES.indexOf(normalStatus(a));
    const bRank = LIVE_STATUSES.indexOf(normalStatus(b));
    const ar = aRank === -1 ? 99 : aRank;
    const br = bRank === -1 ? 99 : bRank;
    return ar - br || Number(b.season_number || 0) - Number(a.season_number || 0) || Number(b.id || 0) - Number(a.id || 0);
  });
  return ranked[0] || null;
}

export function routePath(row, { live = false } = {}) {
  const world = row?.game_worlds?.slug || row?.game_world_slug || 'top-100';
  const competition = row?.competition_types?.slug || row?.competition_slug || 'youth-cup';
  if (live) return `/${world}/${competition}`;
  const season = row?.public_slug || (row?.season_number ? `s${row.season_number}` : null);
  return `/${world}/${competition}${season ? `/${season}` : ''}`;
}

export function groupRouteRows(rows = []) {
  const worlds = [];
  const worldMap = new Map();
  rows.forEach((row) => {
    const worldSlug = row.game_worlds?.slug || row.game_world_slug;
    const worldName = row.game_worlds?.name || row.game_world_name || worldSlug;
    const competitionSlug = row.competition_types?.slug || row.competition_slug;
    const competitionName = row.competition_types?.name || row.competition_name || competitionSlug;
    if (!worldSlug || !competitionSlug) return;
    if (!worldMap.has(worldSlug)) {
      const world = { slug: worldSlug, name: worldName, competitions: [], competitionMap: new Map() };
      worldMap.set(worldSlug, world);
      worlds.push(world);
    }
    const world = worldMap.get(worldSlug);
    if (!world.competitionMap.has(competitionSlug)) {
      const competition = { slug: competitionSlug, name: competitionName, seasons: [] };
      world.competitionMap.set(competitionSlug, competition);
      world.competitions.push(competition);
    }
    world.competitionMap.get(competitionSlug).seasons.push(row);
  });
  worlds.forEach((world) => {
    world.competitions.sort((a, b) => a.name.localeCompare(b.name));
    world.competitions.forEach((competition) => competition.seasons.sort((a, b) => Number(b.season_number || 0) - Number(a.season_number || 0) || Number(b.id || 0) - Number(a.id || 0)));
    delete world.competitionMap;
  });
  worlds.sort((a, b) => a.name.localeCompare(b.name));
  return worlds;
}
