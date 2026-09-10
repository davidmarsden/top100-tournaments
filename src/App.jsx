import AdminDashboard from './components/AdminDashboard.jsx';
import AdminGate from './components/AdminGate.jsx';
import ManagerAccountsPage from './components/ManagerAccountsPage.jsx';
import ManagerPortal from './components/ManagerPortal.jsx';
import ManagerRegistrationPortal from './components/ManagerRegistrationPortal.jsx';
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

function canonicalVotingUrl() {
  const target = new URL('https://tournaments.smtop100.blog/vote');
  target.search = window.location.search;
  target.hash = window.location.hash;
  return target.toString();
}

function isVotingPath() {
  return /^\/vote\/?$/.test(window.location.pathname);
}

function TournamentManagerShell({ children }) {
  return <Top100BrandShell product="Tournaments" current="tournaments">{children}</Top100BrandShell>;
}

export default function App() {
  if (isVotingHost()) {
    // Supabase browser sessions are origin-scoped. Keep vote.smtop100.blog as a
    // friendly entry point, but run authenticated voting on the same origin as
    // the Manager Portal so an existing manager session is reused.
    window.location.replace(canonicalVotingUrl());
    return null;
  }
  if (isManagerPath()) return <TournamentManagerShell><ManagerPortal /></TournamentManagerShell>;
  if (isManagerRegistrationPath()) return <TournamentManagerShell><ManagerRegistrationPortal /></TournamentManagerShell>;
  if (isVotingPath()) return <Top100BrandShell product="Voting" current="voting"><VotingPortal /></Top100BrandShell>;
  if (isManagerAccountsPath()) return <AdminGate requireGlobal><ManagerAccountsPage /></AdminGate>;
  if (isResultSubmissionsPath()) return <AdminGate requireGlobal><ResultSubmissionsPage /></AdminGate>;
  if (!isAdminPath()) return <Top100BrandShell><TournamentRouter /></Top100BrandShell>;
  return <AdminGate><TournamentProvider><AdminDashboard /></TournamentProvider></AdminGate>;
}
