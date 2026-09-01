import AdminDashboard from './components/AdminDashboard.jsx';
import AdminGate from './components/AdminGate.jsx';
import ManagerAccountsPage from './components/ManagerAccountsPage.jsx';
import ManagerPortal from './components/ManagerPortal.jsx';
import ManagerRegistrationPortal from './components/ManagerRegistrationPortal.jsx';
import ResultSubmissionsPage from './components/ResultSubmissionsPage.jsx';
import Top100BrandShell from './components/Top100BrandShell.jsx';
import TournamentRouter, { isAdminPath } from './components/TournamentRouter.jsx';
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

export default function App() {
  if (isManagerPath()) return <ManagerPortal />;
  if (isManagerRegistrationPath()) return <ManagerRegistrationPortal />;
  if (isManagerAccountsPath()) return <AdminGate requireGlobal><ManagerAccountsPage /></AdminGate>;
  if (isResultSubmissionsPath()) return <AdminGate requireGlobal><ResultSubmissionsPage /></AdminGate>;
  if (!isAdminPath()) return <Top100BrandShell><TournamentRouter /></Top100BrandShell>;
  return <AdminGate><TournamentProvider><AdminDashboard /></TournamentProvider></AdminGate>;
}
