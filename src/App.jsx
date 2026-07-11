import AdminDashboard from './components/AdminDashboard.jsx';
import AdminGate from './components/AdminGate.jsx';
import ManagerPortal from './components/ManagerPortal.jsx';
import TournamentRouter, { isAdminPath } from './components/TournamentRouter.jsx';
import { TournamentProvider } from './context/TournamentProvider.jsx';

function isManagerPath() {
  return /^\/manager\/?$/.test(window.location.pathname);
}

export default function App() {
  if (isManagerPath()) return <ManagerPortal />;
  if (!isAdminPath()) return <TournamentRouter />;
  return <AdminGate><TournamentProvider><AdminDashboard /></TournamentProvider></AdminGate>;
}
