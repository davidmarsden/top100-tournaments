import { useEffect, useMemo, useState } from 'react';
import ChallongeImportManager from './ChallongeImportManager.jsx';
import EntrantsManager from './EntrantsManager.jsx';
import FixturesManager from './FixturesManager.jsx';
import GroupsApproval from './GroupsApproval.jsx';
import KnockoutManager from './KnockoutManager.jsx';
import ManagerForfeitRegister from './ManagerForfeitRegister.jsx';
import ProgressBar, { isStepDone } from './ProgressBar.jsx';
import PublicPageManager from './PublicPageManager.jsx';
import RegistrationManager from './RegistrationManager.jsx';
import ReportsExportsManager from './ReportsExportsManager.jsx';
import ResultsTestControls from './ResultsTestControls.jsx';
import TablesManager from './TablesManager.jsx';
import TournamentBuilder from './TournamentBuilder.jsx';
import TournamentCreateForm from './TournamentCreateForm.jsx';
import TournamentFormatManager from './TournamentFormatManager.jsx';
import TournamentOrganisersManager from './TournamentOrganisersManager.jsx';
import { useAdminAuth } from './AdminGate.jsx';
import { isPlaceholderArchive, normalStatus, useTournament } from '../context/TournamentProvider.jsx';
import { publicTournamentPath } from '../lib/tournamentSlugs';
import { deleteTournamentsOnServer } from '../lib/deleteTournaments.js';
import { supabase } from '../lib/supabaseClient';

const platformModules = ['Overview', 'Organisers', 'Registration', 'Format', 'Entrants', 'Groups', 'Fixtures', 'Result Approvals', 'Results', 'Tables', 'Forfeits', 'Knockout', 'Reports & Exports', 'Challonge', 'Public Page'];
const organiserModules = ['Overview', 'Registration', 'Format', 'Entrants', 'Groups', 'Fixtures', 'Results', 'Tables', 'Forfeits', 'Knockout', 'Reports & Exports', 'Public Page'];
const assistantModules = ['Overview', 'Fixtures', 'Results', 'Tables', 'Forfeits', 'Reports & Exports'];
const workflowSteps = ['Tournament', 'Registration', 'Format', 'Entrants', 'Groups', 'Fixtures', 'Results', 'Tables', 'Knockout', 'Publish', 'Archive'];

export default function AdminDashboard() {
  const [activeModule, setActiveModule] = useState('Overview');
  const { isGlobalAdmin, managedTournamentIds, organiserAssignments } = useAdminAuth();
  const { tournaments, selectedTournament, setSelectedTournamentId, preview, progressStats, canUseDatabase, loading, refreshTournamentData, buildPreview } = useTournament();
  const manageableTournaments = useMemo(() => isGlobalAdmin ? tournaments : tournaments.filter((item) => managedTournamentIds.includes(item.id)), [isGlobalAdmin, managedTournamentIds, tournaments]);
  const selectedIsManageable = Boolean(selectedTournament && (isGlobalAdmin || managedTournamentIds.includes(selectedTournament.id)));
  const scopedTournament = selectedIsManageable ? selectedTournament : manageableTournaments[0] || null;
  const scopedRole = isGlobalAdmin ? 'platform' : organiserAssignments.find((row) => row.tournament_id === scopedTournament?.id)?.role || 'assistant';
  const modules = isGlobalAdmin ? platformModules : scopedRole === 'organiser' ? organiserModules : assistantModules;

  useEffect(() => {
    if (!isGlobalAdmin && manageableTournaments.length && !selectedIsManageable) setSelectedTournamentId(manageableTournaments[0].id);
  }, [isGlobalAdmin, manageableTournaments, selectedIsManageable, setSelectedTournamentId]);

  useEffect(() => {
    if (!modules.includes(activeModule)) setActiveModule('Overview');
  }, [activeModule, modules]);

  async function logout() { await supabase.auth.signOut(); window.location.href = '/'; }
  function onDemoPreview() { setActiveModule('Groups'); }

  if (!isGlobalAdmin && !manageableTournaments.length) return <main className="app-shell"><section className="hero"><div className="hero-row"><div><p className="eyebrow">Top 100 Tournament Manager</p><h1>No tournament assigned</h1><p>Your account can sign in, but it does not currently have an active tournament assignment.</p></div><button type="button" className="secondary admin-logout" onClick={logout}>Log out</button></div></section></main>;

  const roleLabel = scopedRole === 'assistant' ? 'assistant' : 'organiser';

  return <main className="app-shell">
    <section className="hero"><div className="hero-row"><div><p className="eyebrow">Top 100 Tournament Manager</p><h1>{isGlobalAdmin ? 'Tournament control centre' : `${scopedTournament?.name || 'Tournament'} ${roleLabel}`}</h1><p>{isGlobalAdmin ? 'Create tournaments, manage registrations and entrants, generate groups and fixtures, enter results, build knockouts and publish a public tournament page.' : scopedRole === 'assistant' ? `Your assistant access is restricted to matchday operations for ${scopedTournament?.name || 'your assigned tournament'}: fixtures, results, tables, forfeits and reports. Tournament structure, entrants and publishing remain with the organiser.` : `Your organiser access is restricted to ${scopedTournament?.name || 'your assigned tournament'}. Other private tournaments and platform controls are hidden and protected by database permissions.`}</p></div><button type="button" className="secondary admin-logout" onClick={logout}>Log out</button></div></section>
    <ProgressBar selectedTournament={scopedTournament} preview={preview} progressStats={progressStats} onJump={(module) => modules.includes(module) && setActiveModule(module)} />
    {!canUseDatabase && <section className="warning-card"><strong>Supabase is not connected yet.</strong><span>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify environment variables.</span></section>}
    <section className="dashboard-layout">
      <aside className="sidebar card"><p className="eyebrow">Modules</p>{modules.map((module) => <button key={module} type="button" className={activeModule === module ? 'nav-pill active' : 'nav-pill'} onClick={() => setActiveModule(module)}>{module}</button>)}</aside>
      <section className="workspace">
        {isGlobalAdmin ? <section className="grid two-columns compact"><TournamentCreateForm onDemoPreview={onDemoPreview} /><WorkflowCard selectedTournament={scopedTournament} preview={preview} progressStats={progressStats} /></section> : <section className="grid two-columns compact"><section className="card"><div className="card-header"><p className="eyebrow">Access scope</p><h2>{scopedTournament?.name}</h2></div><p>{scopedRole === 'assistant' ? 'Assistant: matchday operations only. You can work with fixtures and results and view tables, forfeits and reports. Registration decisions, entrants, tournament format, groups, knockout and publishing are intentionally unavailable.' : 'Organiser: full operational control of this tournament. Tournament creation, manager accounts, Challonge imports and destructive cross-tournament controls remain with the platform administrator.'}</p><a className="button secondary" href="/manager">Manager Portal</a></section><WorkflowCard selectedTournament={scopedTournament} preview={preview} progressStats={progressStats} /></section>}
        {canUseDatabase && scopedTournament && scopedRole !== 'assistant' && <TournamentBuilder selectedTournament={scopedTournament} preview={preview} buildPreview={buildPreview} onNavigate={setActiveModule} onRefresh={refreshTournamentData} />}
        <section className="card module-card"><div className="card-header row"><div><p className="eyebrow">{activeModule}</p><h2>{moduleHeading(activeModule)}</h2></div>{!['Result Approvals', 'Reports & Exports'].includes(activeModule) && <button type="button" className="secondary" onClick={refreshTournamentData} disabled={loading || !canUseDatabase}>Refresh tournament data</button>}</div><ModuleContent activeModule={activeModule} tournaments={manageableTournaments} selectedTournament={scopedTournament} isGlobalAdmin={isGlobalAdmin} scopedRole={scopedRole} /></section>
      </section>
    </section>
  </main>;
}

function WorkflowCard({ selectedTournament, preview, progressStats }) {
  const formatReady = Boolean(Number(selectedTournament?.max_entries || 0) > 0 && Number(selectedTournament?.group_count || 0) > 0 && Number(selectedTournament?.teams_per_group || 0) > 0 && Number(selectedTournament?.knockout_teams || 0) > 0);
  return <section className="card"><div className="card-header"><p className="eyebrow">Workflow status</p><h2>{selectedTournament ? selectedTournament.name : 'No tournament selected'}</h2></div><ol className="steps">{workflowSteps.map((step, index) => { const done = step === 'Registration' ? Boolean(selectedTournament?.registration_status) : step === 'Format' ? formatReady : isStepDone(step, selectedTournament, preview, progressStats); return <li key={step} className={done ? 'done' : ''}><span>{done ? 'Done' : index + 1}</span>{step}</li>; })}</ol></section>;
}

function moduleHeading(activeModule) {
  const headings = { Overview: 'Tournament dashboard', Organisers: 'Tournament organiser access', Registration: 'Registration window and approvals', Format: 'Set tournament shape after registration', Entrants: 'Select teams and managers', Groups: 'Approve generated groups', Fixtures: 'Generate and manage fixtures', 'Result Approvals': 'Approve manager-submitted results', Results: 'Enter, review and edit results', Tables: 'Live group tables', Forfeits: 'Manager forfeit register and eligibility', Knockout: 'Cup and Shield draw', 'Reports & Exports': 'Download data and generate matchday stories', Challonge: 'Import legacy Challonge tournaments', 'Public Page': 'Publish and public view' };
  return headings[activeModule] || activeModule;
}

function ModuleContent({ activeModule, tournaments, selectedTournament, isGlobalAdmin, scopedRole }) {
  const { setSelectedTournamentId, preview, setPreview, buildPreview, refreshTournamentData, bulkSelectedIds, setBulkSelectedIds, setStatus, updateTournamentIds, loading } = useTournament();

  async function deleteSelected(ids, label = 'selected') {
    if (!isGlobalAdmin || !ids.length) return;
    if (!window.confirm(`Delete ${ids.length} ${label} tournament(s) and all linked data? This cannot be undone.`)) return;
    setStatus(`Deleting ${ids.length} ${label} tournament(s)...`);
    try {
      await deleteTournamentsOnServer(ids);
      setBulkSelectedIds([]);
      setSelectedTournamentId((current) => ids.includes(current) ? null : current);
      await refreshTournamentData();
      setStatus(`Deleted ${ids.length} ${label} tournament(s).`);
    } catch (error) {
      setStatus('Delete failed: ' + error.message);
    }
  }

  if (activeModule === 'Overview') return <Overview tournaments={tournaments} selectedTournament={selectedTournament} setSelectedTournamentId={setSelectedTournamentId} preview={preview} bulkSelectedIds={bulkSelectedIds} setBulkSelectedIds={setBulkSelectedIds} onDeleteTournaments={deleteSelected} onUpdateTournaments={updateTournamentIds} loading={loading} isGlobalAdmin={isGlobalAdmin} scopedRole={scopedRole} />;
  if (activeModule === 'Organisers' && isGlobalAdmin) return <TournamentOrganisersManager selectedTournament={selectedTournament} />;
  if (activeModule === 'Registration' && scopedRole !== 'assistant') return <RegistrationManager selectedTournament={selectedTournament} onTournamentUpdated={refreshTournamentData} />;
  if (activeModule === 'Format' && scopedRole !== 'assistant') return <TournamentFormatManager selectedTournament={selectedTournament} onTournamentUpdated={refreshTournamentData} />;
  if (activeModule === 'Entrants' && scopedRole !== 'assistant') return <EntrantsManager selectedTournament={selectedTournament} onPreviewGenerated={buildPreview} />;
  if (activeModule === 'Groups' && scopedRole !== 'assistant') return <GroupsApproval selectedTournament={selectedTournament} preview={preview} setPreview={setPreview} onDataChanged={refreshTournamentData} />;
  if (activeModule === 'Fixtures') return <FixturesManager selectedTournament={selectedTournament} preview={preview} stage="group" onlyOutstanding onDataChanged={refreshTournamentData} />;
  if (activeModule === 'Result Approvals' && isGlobalAdmin) return <div className="overview-actions"><p>Manager-submitted scores are reviewed in the dedicated approval queue.</p><div className="button-row"><a className="button" href="/admin/result-submissions">Open result approval queue</a><a className="button secondary" href="/admin/manager-accounts">Manager accounts</a></div></div>;
  if (activeModule === 'Results') return <><ResultsTestControls selectedTournament={selectedTournament} onDataChanged={refreshTournamentData} /><FixturesManager selectedTournament={selectedTournament} preview={preview} stage="group" onDataChanged={refreshTournamentData} /></>;
  if (activeModule === 'Tables') return <TablesManager selectedTournament={selectedTournament} />;
  if (activeModule === 'Forfeits') return <ManagerForfeitRegister selectedTournament={selectedTournament} admin />;
  if (activeModule === 'Knockout' && scopedRole !== 'assistant') return <KnockoutManager selectedTournament={selectedTournament} onDataChanged={refreshTournamentData} />;
  if (activeModule === 'Reports & Exports') return <ReportsExportsManager selectedTournament={selectedTournament} />;
  if (activeModule === 'Challonge' && isGlobalAdmin) return <ChallongeImportManager onTournamentUpdated={refreshTournamentData} />;
  if (activeModule === 'Public Page' && scopedRole !== 'assistant') return <PublicPageManager selectedTournament={selectedTournament} onTournamentUpdated={refreshTournamentData} />;
  return <p className="muted">This module is not available for your role.</p>;
}

function Overview({ tournaments, selectedTournament, setSelectedTournamentId, preview, bulkSelectedIds, setBulkSelectedIds, onDeleteTournaments, onUpdateTournaments, loading, isGlobalAdmin, scopedRole }) {
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
  function toggleOne(id) { if (isGlobalAdmin) setBulkSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]); }
  function toggleFiltered() { if (!isGlobalAdmin) return; const filteredIds = filtered.map((item) => item.id); setBulkSelectedIds((ids) => allFilteredSelected ? ids.filter((id) => !filteredIds.includes(id)) : [...new Set([...ids, ...filteredIds])]); }

  return <div className="overview">{isGlobalAdmin && <div className="overview-actions bulk-toolbar"><p className="muted">Showing real tournaments by default. Empty honour placeholders are hidden unless you choose the Placeholders filter.</p><div className="status-filter-row">{['real', 'all', 'draft', 'groups_approved', 'published', 'completed', 'archived', 'placeholders'].map((status) => <button key={status} type="button" className={statusFilter === status ? 'status-filter active' : 'status-filter'} onClick={() => setStatusFilter(status)}>{status === 'real' ? 'Real archives' : status === 'all' ? 'All' : status === 'placeholders' ? 'Placeholders' : status.replace('_', ' ')} <span>{status === 'real' ? realTournaments.length : status === 'all' ? tournaments.length : status === 'placeholders' ? placeholders.length : statusCounts[status] || 0}</span></button>)}</div><div className="button-row bulk-actions"><button type="button" className="secondary" onClick={toggleFiltered} disabled={!filtered.length}>{allFilteredSelected ? 'Clear visible' : 'Select visible'}</button><button type="button" className="secondary" onClick={() => setBulkSelectedIds([])} disabled={!bulkSelectedIds.length}>Clear all</button><button type="button" className="secondary" onClick={() => onUpdateTournaments(bulkSelectedIds, 'draft')} disabled={loading || !bulkSelectedIds.length}>Mark draft</button><button type="button" className="secondary" onClick={() => onUpdateTournaments(bulkSelectedIds, 'completed')} disabled={loading || !bulkSelectedIds.length}>Mark completed</button><button type="button" className="secondary" onClick={() => onUpdateTournaments(bulkSelectedIds, 'archived')} disabled={loading || !bulkSelectedIds.length}>Archive selected</button><button type="button" className="danger" onClick={() => onDeleteTournaments(bulkSelectedIds, 'selected')} disabled={loading || !bulkSelectedIds.length}>Delete selected ({bulkSelectedIds.length})</button></div></div>}{!isGlobalAdmin && <div className="overview-actions"><p className="muted">Only tournaments assigned to your {scopedRole} account are shown here. Destructive cross-tournament controls are intentionally unavailable.</p></div>}<div className="overview-metrics"><article><span>{isGlobalAdmin ? 'Real tournaments' : 'Assigned tournaments'}</span><strong>{realTournaments.length}</strong></article>{isGlobalAdmin && <article><span>Hidden placeholders</span><strong>{placeholders.length}</strong></article>}<article><span>Selected</span><strong>{selectedTournament?.name || 'None'}</strong></article><article><span>Preview fixtures</span><strong>{preview?.fixtures?.length || 0}</strong></article></div><div className="tournament-grid">{filtered.map((tournament) => <article key={tournament.id} className={selectedTournament?.id === tournament.id ? 'tournament-card selected tournament-select-card' : 'tournament-card tournament-select-card'}>{isGlobalAdmin && <label className="tournament-check"><input type="checkbox" checked={bulkSelectedIds.includes(tournament.id)} onChange={() => toggleOne(tournament.id)} /><span className={`status-pill status-${normalStatus(tournament)}`}>{isPlaceholderArchive(tournament) ? 'placeholder' : normalStatus(tournament).replace('_', ' ')}</span></label>}<button type="button" className="tournament-select-button" onClick={() => setSelectedTournamentId(tournament.id)}><strong>{tournament.name}</strong><span>{tournament.actual_entries || 0}/{tournament.max_entries || 'TBC'} entries</span><span>{tournament.group_count || 'TBC'} groups · {tournament.knockout_teams || 'TBC'} knockout teams</span><span>{tournament.game_worlds?.name || 'Top 100'} · {tournament.competition_types?.name || 'Tournament'}{tournament.season_number ? ' · S' + tournament.season_number : ''}</span><span>{isPlaceholderArchive(tournament) ? 'Hidden placeholder archive' : publicTournamentPath(tournament)}</span></button></article>)}</div></div>;
}
