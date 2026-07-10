import { useState } from 'react';
import ChallongeImportManager from './ChallongeImportManager.jsx';
import EntrantsManager from './EntrantsManager.jsx';
import FixturesManager from './FixturesManager.jsx';
import GroupsApproval from './GroupsApproval.jsx';
import KnockoutManager from './KnockoutManager.jsx';
import ProgressBar, { isStepDone } from './ProgressBar.jsx';
import PublicPageManager from './PublicPageManager.jsx';
import RegistrationManager from './RegistrationManager.jsx';
import TablesManager from './TablesManager.jsx';
import TournamentCreateForm from './TournamentCreateForm.jsx';
import { isPlaceholderArchive, normalStatus, useTournament } from '../context/TournamentProvider.jsx';
import { publicTournamentPath } from '../lib/tournamentSlugs';
import { deleteTournamentsOnServer } from '../lib/deleteTournaments.js';
import { supabase } from '../lib/supabaseClient';

const modules = ['Overview', 'Registration', 'Entrants', 'Groups', 'Fixtures', 'Results', 'Tables', 'Knockout', 'Challonge', 'Public Page'];
const workflowSteps = ['Tournament', 'Registration', 'Entrants', 'Groups', 'Fixtures', 'Results', 'Tables', 'Knockout', 'Publish', 'Archive'];

export default function AdminDashboard() {
  const [activeModule, setActiveModule] = useState('Overview');
  const { selectedTournament, preview, progressStats, canUseDatabase, loading, refreshTournamentData } = useTournament();

  async function logout() { await supabase.auth.signOut(); window.location.href = '/'; }
  function onDemoPreview() { setActiveModule('Groups'); }

  return <main className="app-shell"><section className="hero"><div className="hero-row"><div><p className="eyebrow">Top 100 Tournament Manager</p><h1>Tournament control centre</h1><p>Create tournaments, manage registrations and entrants, generate groups and fixtures, enter results, build knockouts and publish a public tournament page.</p></div><button type="button" className="secondary admin-logout" onClick={logout}>Log out</button></div></section><ProgressBar selectedTournament={selectedTournament} preview={preview} progressStats={progressStats} onJump={setActiveModule} />{!canUseDatabase && <section className="warning-card"><strong>Supabase is not connected yet.</strong><span>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify environment variables.</span></section>}<section className="dashboard-layout"><aside className="sidebar card"><p className="eyebrow">Modules</p>{modules.map((module) => <button key={module} type="button" className={activeModule === module ? 'nav-pill active' : 'nav-pill'} onClick={() => setActiveModule(module)}>{module}</button>)}</aside><section className="workspace"><section className="grid two-columns compact"><TournamentCreateForm onDemoPreview={onDemoPreview} /><WorkflowCard selectedTournament={selectedTournament} preview={preview} progressStats={progressStats} /></section><section className="card module-card"><div className="card-header row"><div><p className="eyebrow">{activeModule}</p><h2>{moduleHeading(activeModule)}</h2></div><button type="button" className="secondary" onClick={refreshTournamentData} disabled={loading || !canUseDatabase}>Refresh tournament data</button></div><ModuleContent activeModule={activeModule} /></section></section></section></main>;
}

function WorkflowCard({ selectedTournament, preview, progressStats }) {
  return <section className="card"><div className="card-header"><p className="eyebrow">Workflow status</p><h2>{selectedTournament ? selectedTournament.name : 'No tournament selected'}</h2></div><ol className="steps">{workflowSteps.map((step, index) => { const done = step === 'Registration' ? Boolean(selectedTournament?.registration_status) : isStepDone(step, selectedTournament, preview, progressStats); return <li key={step} className={done ? 'done' : ''}><span>{done ? 'Done' : index + 1}</span>{step}</li>; })}</ol></section>;
}
function moduleHeading(activeModule) { const headings = { Overview: 'Tournament dashboard', Registration: 'Registration window and approvals', Entrants: 'Select teams and managers', Groups: 'Approve generated groups', Fixtures: 'Generate and manage fixtures', Results: 'Results archive and editing', Tables: 'Live group tables', Knockout: 'Cup and Shield draw', Challonge: 'Import legacy Challonge tournaments', 'Public Page': 'Publish and public view' }; return headings[activeModule] || activeModule; }
function ModuleContent({ activeModule }) {
  const { tournaments, selectedTournament, setSelectedTournamentId, preview, setPreview, buildPreview, refreshTournamentData, bulkSelectedIds, setBulkSelectedIds, setStatus, updateTournamentIds, loading } = useTournament();
  async function deleteSelected(ids, label = 'selected') {
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} ${label} tournament(s) and all linked data? This cannot be undone.`)) return;
    setStatus(`Deleting ${ids.length} tournament(s)...`);
    try {
      await deleteTournamentsOnServer(ids);
      setBulkSelectedIds([]);
      setSelectedTournamentId((current) => ids.includes(current) ? null : current);
      await refreshTournamentData();
      setStatus(`Deleted ${ids.length} tournament(s).`);
    } catch (error) {
      setStatus('Delete failed: ' + error.message);
    }
  }
  if (activeModule === 'Overview') return <Overview tournaments={tournaments} selectedTournament={selectedTournament} setSelectedTournamentId={setSelectedTournamentId} preview={preview} bulkSelectedIds={bulkSelectedIds} setBulkSelectedIds={setBulkSelectedIds} onDeleteTournaments={deleteSelected} onUpdateTournaments={updateTournamentIds} loading={loading} />;
  if (activeModule === 'Registration') return <RegistrationManager selectedTournament={selectedTournament} onTournamentUpdated={refreshTournamentData} />;
  if (activeModule === 'Entrants') return <EntrantsManager selectedTournament={selectedTournament} onPreviewGenerated={buildPreview} />;
  if (activeModule === 'Groups') return <GroupsApproval selectedTournament={selectedTournament} preview={preview} setPreview={setPreview} />;
  if (activeModule === 'Fixtures') return <FixturesManager selectedTournament={selectedTournament} preview={preview} stage="group" onlyOutstanding onDataChanged={refreshTournamentData} />;
  if (activeModule === 'Results') return <FixturesManager selectedTournament={selectedTournament} preview={preview} stage="group" onlyCompleted onDataChanged={refreshTournamentData} />;
  if (activeModule === 'Tables') return <TablesManager selectedTournament={selectedTournament} />;
  if (activeModule === 'Knockout') return <KnockoutManager selectedTournament={selectedTournament} onDataChanged={refreshTournamentData} />;
  if (activeModule === 'Challonge') return <ChallongeImportManager onTournamentUpdated={refreshTournamentData} />;
  if (activeModule === 'Public Page') return <PublicPageManager selectedTournament={selectedTournament} onTournamentUpdated={refreshTournamentData} />;
  return <p className="muted">Module coming next.</p>;
}
function Overview({ tournaments, selectedTournament, setSelectedTournamentId, preview, bulkSelectedIds, setBulkSelectedIds, onDeleteTournaments, onUpdateTournaments, loading }) {
  const [statusFilter, setStatusFilter] = useState('real');
  const placeholders = tournaments.filter(isPlaceholderArchive);
  const realTournaments = tournaments.filter((tournament) => !isPlaceholderArchive(tournament));
  const filtered = tournaments.filter((tournament) => {
    if (statusFilter === 'real') return !isPlaceholderArchive(tournament);
    if (statusFilter === 'placeholders') return isPlaceholderArchive(tournament);
    return statusFilter === 'all' || normalStatus(tournament) === statusFilter;
  });
  const statusCounts = tournaments.reduce((counts, tournament) => { const key = normalStatus(tournament); counts[key] = (counts[key] || 0) + 1; return counts; }, {});
  const selectedFilteredIds = filtered.map((item) => item.id).filter((id) => bulkSelectedIds.includes(id));
  const allFilteredSelected = filtered.length > 0 && selectedFilteredIds.length === filtered.length;
  function toggleOne(id) { setBulkSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]); }
  function toggleFiltered() { const filteredIds = filtered.map((item) => item.id); setBulkSelectedIds((ids) => allFilteredSelected ? ids.filter((id) => !filteredIds.includes(id)) : [...new Set([...ids, ...filteredIds])]); }
  return <div className="overview"><div className="overview-actions bulk-toolbar"><p className="muted">Showing real tournaments by default. Empty honour placeholders are hidden unless you choose the Placeholders filter.</p><div className="status-filter-row">{['real', 'all', 'draft', 'groups_approved', 'published', 'completed', 'archived', 'placeholders'].map((status) => <button key={status} type="button" className={statusFilter === status ? 'status-filter active' : 'status-filter'} onClick={() => setStatusFilter(status)}>{status === 'real' ? 'Real archives' : status === 'all' ? 'All' : status.replace('_', ' ')} <span>{status === 'real' ? realTournaments.length : status === 'all' ? tournaments.length : status === 'placeholders' ? placeholders.length : statusCounts[status] || 0}</span></button>)}</div><div className="button-row bulk-actions"><button type="button" className="secondary" onClick={toggleFiltered} disabled={!filtered.length}>{allFilteredSelected ? 'Clear visible' : 'Select visible'}</button><button type="button" className="secondary" onClick={() => setBulkSelectedIds([])} disabled={!bulkSelectedIds.length}>Clear all</button><button type="button" className="secondary" onClick={() => onUpdateTournaments(bulkSelectedIds, 'draft')} disabled={loading || !bulkSelectedIds.length}>Mark draft</button><button type="button" className="secondary" onClick={() => onUpdateTournaments(bulkSelectedIds, 'completed')} disabled={loading || !bulkSelectedIds.length}>Mark completed</button><button type="button" className="secondary" onClick={() => onUpdateTournaments(bulkSelectedIds, 'archived')} disabled={loading || !bulkSelectedIds.length}>Archive selected</button><button type="button" className="danger" onClick={() => onDeleteTournaments(bulkSelectedIds, 'selected')} disabled={loading || !bulkSelectedIds.length}>Delete selected ({bulkSelectedIds.length})</button></div></div><div className="overview-metrics"><article><span>Real tournaments</span><strong>{realTournaments.length}</strong></article><article><span>Hidden placeholders</span><strong>{placeholders.length}</strong></article><article><span>Selected</span><strong>{selectedTournament?.name || 'None'}</strong></article><article><span>Preview fixtures</span><strong>{preview?.fixtures?.length || 0}</strong></article></div><div className="tournament-grid">{filtered.map((tournament) => <article key={tournament.id} className={selectedTournament?.id === tournament.id ? 'tournament-card selected tournament-select-card' : 'tournament-card tournament-select-card'}><label className="tournament-check"><input type="checkbox" checked={bulkSelectedIds.includes(tournament.id)} onChange={() => toggleOne(tournament.id)} /><span className={`status-pill status-${normalStatus(tournament)}`}>{isPlaceholderArchive(tournament) ? 'placeholder' : normalStatus(tournament).replace('_', ' ')}</span></label><button type="button" className="tournament-select-button" onClick={() => setSelectedTournamentId(tournament.id)}><strong>{tournament.name}</strong><span>{tournament.actual_entries || 0}/{tournament.max_entries || '?'} entries</span><span>{tournament.group_count || '?'} groups · {tournament.knockout_teams || '?'} knockout teams</span><span>{tournament.game_worlds?.name || 'Top 100'} · {tournament.competition_types?.name || 'Youth Cup'}{tournament.season_number ? ' · S' + tournament.season_number : ''}</span><span>{isPlaceholderArchive(tournament) ? 'Hidden placeholder archive' : publicTournamentPath(tournament)}</span></button></article>)}</div></div>;
}
