import AdminDashboard from './components/AdminDashboard.jsx';
import AdminGate from './components/AdminGate.jsx';
import AdminControlRoom from './components/AdminControlRoom.jsx';
import AuthSessionBridge from './components/AuthSessionBridge.jsx';
import ManagerAccountsPage from './components/ManagerAccountsPage.jsx';
import ManagerEntry from './components/ManagerEntry.jsx';
import ManagerSquadDashboard from './components/ManagerSquadDashboard.jsx';
import ManagerLabPage from './components/ManagerLabPage.jsx';
import PublicVotingResults from './components/PublicVotingResults.jsx';
import PublicOpenPolls from './components/PublicOpenPolls.jsx';
import ResultSubmissionsPage from './components/ResultSubmissionsPage.jsx';
import SoccerManagerSyncPage from './components/SoccerManagerSyncPage.jsx';
import Top100BrandShell from './components/Top100BrandShell.jsx';
import Top100ChatAccess from './components/Top100ChatAccess.jsx';
import TournamentRouter, { isAdminPath } from './components/TournamentRouter.jsx';
import VotingEntry from './components/VotingEntry.jsx';
import { TournamentProvider } from './context/TournamentProvider.jsx';

function isManagerPath() { return /^\/manager\/?$/.test(window.location.pathname); }
function isManagerRegistrationPath() { return /^\/manager\/registrations?\/?$/.test(window.location.pathname); }
function isManagerChatPath() { return /^\/manager\/chat\/?$/.test(window.location.pathname); }
function isManagerSquadPath() { return /^\/manager\/squad\/?$/.test(window.location.pathname); }
function isChatPath() { return /^\/chat\/?$/.test(window.location.pathname); }
function isManagerHostRegistrationPath() { return /^\/(?:manager\/)?registrations?\/?$/.test(window.location.pathname); }
function isManagerHostChatPath() { return /^\/(?:manager\/)?chat\/?$/.test(window.location.pathname); }
function isManagerHostSquadPath() { return /^\/(?:manager\/)?squad\/?$/.test(window.location.pathname); }
function isManagerHostPortalPath() { return /^\/(?:manager\/?)?$/.test(window.location.pathname); }
function isManagerAccountsPath() { return /^\/admin\/manager-accounts\/?$/.test(window.location.pathname); }
function isResultSubmissionsPath() { return /^\/admin\/result-submissions\/?$/.test(window.location.pathname); }
function isSoccerManagerSyncPath() { return /^\/admin\/soccer-manager-sync\/?$/.test(window.location.pathname); }
function isManagerLabPath() { return /^\/admin\/manager-lab\/?$/.test(window.location.pathname); }
function isAuthSessionBridgePath() { return /^\/auth\/session-bridge\/?$/.test(window.location.pathname); }
function isVotingHost() { return window.location.hostname === 'vote.smtop100.blog'; }
function isManagerHost() { return window.location.hostname === 'manager.smtop100.blog'; }
function isAdminHost() { return window.location.hostname === 'admin.smtop100.blog'; }
function isVotingPath() { return /^\/vote\/?$/.test(window.location.pathname); }
function isPollResultsPath() { return /^\/results\/?$/.test(window.location.pathname); }

function ManagerShell({ children, product = 'My Matches' }) {
  return <Top100BrandShell product={product} current="manager">{children}</Top100BrandShell>;
}

function forwardManagerHostPathToTournaments() {
  const target = new URL(window.location.href);
  target.hostname = 'tournaments.smtop100.blog';
  window.location.replace(target.toString());
}

export default function App() {
  if (isAdminHost() && isAuthSessionBridgePath()) return <AuthSessionBridge />;
  if (isAdminHost()) return <AdminGate requireGlobal><Top100BrandShell product="Control Room" current="admin"><AdminControlRoom /></Top100BrandShell></AdminGate>;

  if (isVotingHost()) {
    if (isVotingPath()) return <Top100BrandShell product="Community Polls" current="vote"><VotingEntry /></Top100BrandShell>;
    if (isPollResultsPath()) return <Top100BrandShell product="Community Polls" current="voting-results"><PublicVotingResults /></Top100BrandShell>;
    return <Top100BrandShell product="Community Polls" current="polls"><PublicOpenPolls /></Top100BrandShell>;
  }

  if (isManagerHost()) {
    if (isAuthSessionBridgePath()) return <AuthSessionBridge />;
    if (isManagerHostChatPath()) return <ManagerShell><Top100ChatAccess /></ManagerShell>;
    if (isManagerHostSquadPath()) return <ManagerShell product="Squad & Transfers"><ManagerSquadDashboard /></ManagerShell>;
    if (isManagerHostRegistrationPath()) return <ManagerShell><ManagerEntry registrationMode /></ManagerShell>;
    if (isManagerHostPortalPath()) return <ManagerShell><ManagerEntry /></ManagerShell>;
    forwardManagerHostPathToTournaments(); return null;
  }

  if (isAuthSessionBridgePath()) return <AuthSessionBridge />;
  if (isChatPath()) return <ManagerShell><Top100ChatAccess /></ManagerShell>;
  if (isManagerChatPath()) { window.location.replace(`https://manager.smtop100.blog/chat${window.location.search}`); return null; }
  if (isManagerSquadPath()) { window.location.replace(`https://manager.smtop100.blog/squad${window.location.search}`); return null; }
  if (isManagerPath()) { window.location.replace('https://manager.smtop100.blog/'); return null; }
  if (isManagerRegistrationPath()) { window.location.replace('https://manager.smtop100.blog/registrations'); return null; }
  if (isVotingPath()) { window.location.replace('https://vote.smtop100.blog/vote'); return null; }
  if (isManagerAccountsPath()) return <AdminGate requireGlobal><ManagerAccountsPage /></AdminGate>;
  if (isResultSubmissionsPath()) return <AdminGate requireGlobal><ResultSubmissionsPage /></AdminGate>;
  if (isSoccerManagerSyncPath()) return <AdminGate requireGlobal><SoccerManagerSyncPage /></AdminGate>;
  if (isManagerLabPath()) return <AdminGate requireGlobal><ManagerLabPage /></AdminGate>;
  if (!isAdminPath()) return <Top100BrandShell><TournamentRouter /></Top100BrandShell>;
  return <AdminGate><TournamentProvider><AdminDashboard /></TournamentProvider></AdminGate>;
}