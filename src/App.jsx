import AdminDashboard from './components/AdminDashboard.jsx';
import AdminGate from './components/AdminGate.jsx';
import ManagerAccountsPage from './components/ManagerAccountsPage.jsx';
import ManagerPortal from './components/ManagerPortal.jsx';
import ResultSubmissionsPage from './components/ResultSubmissionsPage.jsx';
import TournamentRouter, { isAdminPath } from './components/TournamentRouter.jsx';
import { TournamentProvider } from './context/TournamentProvider.jsx';

function isManagerPath() {
  return /^\/manager\/?$/.test(window.location.pathname);
}

function isManagerAccountsPath() {
  return /^\/admin\/manager-accounts\/?$/.test(window.location.pathname);
}

function isResultSubmissionsPath() {
  return /^\/admin\/result-submissions\/?$/.test(window.location.pathname);
}

export default function App() {
  if (isManagerPath()) return <ManagerPortal />;
  if (isManagerAccountsPath()) return <AdminGate><ManagerAccountsPage /></AdminGate>;
  if (isResultSubmissionsPath()) return <AdminGate><ResultSubmissionsPage /></AdminGate>;
  if (!isAdminPath()) return <TournamentRouter />;
  return <AdminGate><TournamentProvider><AdminDashboard /></TournamentProvider></AdminGate>;
}
