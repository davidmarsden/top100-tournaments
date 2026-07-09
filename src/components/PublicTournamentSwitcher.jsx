import { useMemo } from 'react';
import { groupRouteRows, routePath } from '../lib/publicTournamentRoutes';

function currentParts(pathname = window.location.pathname) {
  const parts = pathname.split('/').map((part) => part.trim()).filter(Boolean);
  return { worldSlug: parts[0] || 'top-100', competitionSlug: parts[1] || 'youth-cup', seasonSlug: parts[2] || null };
}
function labelSeason(row) {
  if (row.season_number) return `S${row.season_number}`;
  if (row.public_slug) return row.public_slug.toUpperCase();
  return row.name;
}
function findWorld(worlds, slug) {
  return worlds.find((world) => world.slug === slug) || worlds[0] || null;
}
function findCompetition(world, slug) {
  return world?.competitions?.find((competition) => competition.slug === slug) || world?.competitions?.[0] || null;
}
function liveRowFor(competition) {
  return [...(competition?.seasons || [])].sort((a, b) => {
    const rank = { published: 0, groups_approved: 1, draft: 2, completed: 3, archived: 4 };
    const ar = rank[String(a.status || '').toLowerCase()] ?? 99;
    const br = rank[String(b.status || '').toLowerCase()] ?? 99;
    return ar - br || Number(b.season_number || 0) - Number(a.season_number || 0) || Number(b.id || 0) - Number(a.id || 0);
  })[0] || null;
}
function livePathFor(world, competition) {
  const live = liveRowFor(competition);
  return live ? routePath(live, { live: true }) : `/${world?.slug || 'top-100'}/${competition?.slug || 'youth-cup'}`;
}

export default function PublicTournamentSwitcher({ routes = [], currentTournament }) {
  const worlds = useMemo(() => groupRouteRows(routes), [routes]);
  if (!worlds.length) return null;
  const parts = currentParts();
  const currentWorld = findWorld(worlds, currentTournament?.game_worlds?.slug || parts.worldSlug);
  const currentCompetition = findCompetition(currentWorld, currentTournament?.competition_types?.slug || parts.competitionSlug);
  const currentSeasonPath = currentTournament ? routePath(currentTournament) : window.location.pathname;

  function goTo(path) {
    if (path && path !== window.location.pathname) window.location.href = path;
  }
  function onWorldChange(event) {
    const world = findWorld(worlds, event.target.value);
    const competition = world?.competitions?.[0];
    goTo(livePathFor(world, competition));
  }
  function onCompetitionChange(event) {
    const competition = findCompetition(currentWorld, event.target.value);
    goTo(livePathFor(currentWorld, competition));
  }
  function onSeasonChange(event) {
    goTo(event.target.value);
  }

  return <section className="public-tournament-switcher" aria-label="Tournament selector">
    <label>World<select value={currentWorld?.slug || ''} onChange={onWorldChange}>{worlds.map((world) => <option key={world.slug} value={world.slug}>{world.name}</option>)}</select></label>
    <label>Competition<select value={currentCompetition?.slug || ''} onChange={onCompetitionChange}>{(currentWorld?.competitions || []).map((competition) => <option key={competition.slug} value={competition.slug}>{competition.name}</option>)}</select></label>
    <label>Season<select value={currentSeasonPath} onChange={onSeasonChange}>{currentCompetition && <option value={livePathFor(currentWorld, currentCompetition)}>Latest / live</option>}{(currentCompetition?.seasons || []).map((row) => <option key={row.id} value={routePath(row)}>{labelSeason(row)} · {row.status}</option>)}</select></label>
  </section>;
}
