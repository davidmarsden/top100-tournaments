import ArchiveWinnerHero from './ArchiveWinnerHero.jsx';
import PublicTournamentPage from './PublicTournamentPage.jsx';
import PublicTournamentRoute from './PublicTournamentRoute.jsx';
import '../archive-view.css';

function publicTournamentIdFromPath() {
  const match = window.location.pathname.match(/^\/(?:tournaments|public)\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}
function defaultPublicTournamentId() {
  const id = Number(import.meta.env.VITE_PUBLIC_TOURNAMENT_ID || '13');
  return Number.isFinite(id) && id > 0 ? id : 13;
}
function archiveRouteClass() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const seasonSlug = parts[2] || '';
  if (!/^s\d+(?:-\d+)?$/i.test(seasonSlug)) return '';
  if (/^s(?:14|15)(?:-\d+)?$/i.test(seasonSlug)) return 'historical-tournament-route mixed-format-archive-route';
  return 'historical-tournament-route knockout-only-archive-route';
}
export function isAdminPath() {
  return window.location.pathname.match(/^\/admin\/?$/);
}

export default function TournamentRouter() {
  const explicitPublicTournamentId = publicTournamentIdFromPath();
  if (explicitPublicTournamentId) return <PublicTournamentPage tournamentId={explicitPublicTournamentId} />;

  const route = <PublicTournamentRoute fallbackTournamentId={defaultPublicTournamentId()} />;
  const className = archiveRouteClass();
  return className
    ? <div className={className}>{className.includes('knockout-only') && <ArchiveWinnerHero />}{route}</div>
    : route;
}
