import PublicTournamentPage from './PublicTournamentPage.jsx';
import PublicTournamentRoute from './PublicTournamentRoute.jsx';

function publicTournamentIdFromPath() {
  const match = window.location.pathname.match(/^\/(?:tournaments|public)\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}
function defaultPublicTournamentId() {
  const id = Number(import.meta.env.VITE_PUBLIC_TOURNAMENT_ID || '13');
  return Number.isFinite(id) && id > 0 ? id : 13;
}
export function isAdminPath() {
  return window.location.pathname.match(/^\/admin\/?$/);
}

export default function TournamentRouter() {
  const explicitPublicTournamentId = publicTournamentIdFromPath();
  if (explicitPublicTournamentId) return <PublicTournamentPage tournamentId={explicitPublicTournamentId} />;
  return <PublicTournamentRoute fallbackTournamentId={defaultPublicTournamentId()} />;
}
