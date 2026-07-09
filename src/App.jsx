import AdminDashboard from './components/AdminDashboard.jsx';
import AdminGate from './components/AdminGate.jsx';
import TournamentRouter, { isAdminPath } from './components/TournamentRouter.jsx';
import { TournamentProvider } from './context/TournamentProvider.jsx';

export default function App() {
  if (!isAdminPath()) return <TournamentRouter />;
  return <AdminGate><TournamentProvider><AdminDashboard /></TournamentProvider></AdminGate>;
}
