import AdminDashboard from './components/AdminDashboard.jsx';
import AdminGate from './components/AdminGate.jsx';
import ManagerAccountsPage from './components/ManagerAccountsPage.jsx';
import ManagerPortal from './components/ManagerPortal.jsx';
import ManagerRegistrationPortal from './components/ManagerRegistrationPortal.jsx';
import PublicVotingResults from './components/PublicVotingResults.jsx';
import ResultSubmissionsPage from './components/ResultSubmissionsPage.jsx';
import Top100BrandShell from './components/Top100BrandShell.jsx';
import TournamentRouter, { isAdminPath } from './components/TournamentRouter.jsx';
import VotingPortal from './components/VotingPortal.jsx';
import { TournamentProvider } from './context/TournamentProvider.jsx';

function isManagerPath() {
  return /^\/manager\/?$/.test(window.location.pathname);
}

function isManagerRegistrationPath() {
  return /^\/manager\/registrations?\/?$/.test(window.location.pathname);
}

function isManagerAccountsPath() {
  return /^\/admin\/manager-accounts\/?$/.test(window.location.pathname);
}

function isResultSubmissionsPath() {
  return /^\/admin\/result-submissions\/?$/.test(window.location.pathname);
}

function isVotingHost() {
  return window.location.hostname === 'vote.smtop100.blog';
}

function isVotingPath() {
  return /^\/vote\/?$/.test(window.location.pathname);
}

function TournamentManagerShell({ children }) {
  return <Top100BrandShell product="Tournaments" current="tournaments">{children}</Top100BrandShell>;
}

export default function App() {
  if (isVotingHost()) {
    return <Top100BrandShell product="Voting Results" current="voting"><PublicVotingResults /></Top100BrandShell>;
  }
  if (isManagerPath()) return <TournamentManagerShell><ManagerPortal /></TournamentManagerShell>;
  if (isManagerRegistrationPath()) return <TournamentManagerShell><ManagerRegistrationPortal /></TournamentManagerShell>;
  if (isVotingPath()) return <Top100BrandShell product="Voting" current="voting"><VotingPortal /></Top100BrandShell>;
  if (isManagerAccountsPath()) return <AdminGate requireGlobal><ManagerAccountsPage /></AdminGate>;
  if (isResultSubmissionsPath()) return <AdminGate requireGlobal><ResultSubmissionsPage /></AdminGate>;
  if (!isAdminPath()) return <Top100BrandShell><TournamentRouter /></Top100BrandShell>;
  return <AdminGate><TournamentProvider><AdminDashboard /></TournamentProvider></AdminGate>;
}
