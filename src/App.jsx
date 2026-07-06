import { useEffect, useMemo, useState } from 'react';
import ChallongeImportManager from './components/ChallongeImportManager.jsx';
import EntrantsManager from './components/EntrantsManager.jsx';
import FixturesManager from './components/FixturesManager.jsx';
import GroupsApproval from './components/GroupsApproval.jsx';
import KnockoutManager from './components/KnockoutManager.jsx';
import ProgressBar, { isStepDone } from './components/ProgressBar.jsx';
import PublicPageManager from './components/PublicPageManager.jsx';
import PublicTournamentPage from './components/PublicTournamentPage.jsx';
import TablesManager from './components/TablesManager.jsx';
import { hasSupabaseConfig, supabase } from './lib/supabaseClient';

const modules = ['Overview', 'Entrants', 'Groups', 'Fixtures', 'Results', 'Tables', 'Knockout', 'Challonge', 'Public Page'];
const workflowSteps = ['Tournament', 'Entrants', 'Groups', 'Fixtures', 'Results', 'Tables', 'Knockout', 'Publish', 'Archive'];
const groupCodes = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const initialForm = { seasonCode: 'S28', competitionName: 'Youth Cup', tournamentName: 'S28 Youth Cup', maxEntries: 64, teamsPerGroup: 4, groupCount: 16, knockoutTeams: 32, secondaryBracketName: 'Shield' };
const demoEntrants = ['Genoa', 'Espanyol', 'Bayern Munich', 'Barcelona', 'CSKA', 'Hertha Berlin', 'Independiente', 'River Plate', 'Montpellier', 'West Brom', 'Club Brugge', 'Juventus', 'Leicester Youth', 'Levante', 'Dortmund', 'Hamburg', 'Stoke City', 'Sao Paulo', 'FC Porto', 'Sampdoria', 'Sporting', 'SC Internacional', 'Chelsea', 'Anderlecht', 'Celtic Factory', 'Dynamo Moskva', 'Besiktas', 'PSV', 'AC Milan', 'Crystal Palace', 'Fenerbahce', 'Monaco', 'Benfica', 'Cruzeiro', 'Liverpool', 'Athletic Club', 'Tottenham', 'Werder Bremen', 'Villarreal', 'Real Madrid', 'Udinese', 'Valencia', 'Wolfsburg', 'CR Flamengo', 'Leverkusen', 'Swansea', 'Newcastle United', 'Saint Etienne', 'Ajax', 'Roma', 'Lazio', 'Marseille', 'Fiorentina', 'Lyon', 'Sevilla', 'Porto B', 'Everton', 'Napoli', 'Atalanta', 'Boca Juniors', 'Palmeiras', 'Flamengo Youth', 'Galatasaray', 'Rangers'].map((teamName, index) => ({ id: index + 1, team_name: teamName, manager_name: 'Manager ' + (index + 1), seed: index + 1, rating: 100 - Math.floor(index / 4) }));

function publicTournamentIdFromPath() {
  const match = window.location.pathname.match(/^\/(?:tournaments|public)\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}
function normalStatus(tournament) { return String(tournament?.status || 'draft').toLowerCase(); }
function isArchived(tournament) { return normalStatus(tournament) === 'archived'; }
function sortTournaments(items) {
  const rank = { published: 0, groups_approved: 1, draft: 2, completed: 3, archived: 4 };
  return [...items].sort((a, b) => (rank[normalStatus(a)] ?? 2) - (rank[normalStatus(b)] ?? 2) || new Date(b.created_at || 0) - new Date(a.created_at || 0));
}
function generateGroups(entries, groupCount) {
  const groups = groupCodes.slice(0, groupCount).map((code, index) => ({ code, group_order: index + 1, entries: [] }));
  for (let start = 0; start < entries.length; start += groupCount) {
    const potNumber = Math.floor(start / groupCount) + 1;
    const pot = entries.slice(start, start + groupCount);
    const orderedPot = potNumber % 2 === 1 ? pot : [...pot].reverse();
    orderedPot.forEach((entry, index) => {
      const group = groups[index % groupCount];
      if (group) group.entries.push({ ...entry, group_code: group.code, pot: potNumber });
    });
  }
  return groups;
}
function roundRobinRounds(entries) {
  const teams = [...entries];
  if (teams.length % 2 === 1) teams.push({ bye: true });
  const rounds = [];
  const roundCount = teams.length - 1;
  const half = teams.length / 2;
  let rotation = [...teams];
  for (let roundIndex = 0; roundIndex < roundCount; roundIndex += 1) {
    const pairings = [];
    for (let index = 0; index < half; index += 1) {
      const first = rotation[index];
      const second = rotation[rotation.length - 1 - index];
      if (!first.bye && !second.bye) pairings.push(roundIndex % 2 === 0 ? [first, second] : [second, first]);
    }
    rounds.push(pairings);
    rotation = [rotation[0], rotation[rotation.length - 1], ...rotation.slice(1, -1)];
  }
  return rounds;
}
function generateFixtures(groups) {
  const fixtures = [];
  let matchOrder = 1;
  groups.forEach((group) => {
    const firstLegRounds = roundRobinRounds(group.entries);
    const allRounds = [...firstLegRounds, ...firstLegRounds.map((round) => round.map(([home, away]) => [away, home]))];
    allRounds.forEach((roundPairings, roundIndex) => {
      roundPairings.forEach(([home, away]) => fixtures.push({ group_code: group.code, round: 'MD' + (roundIndex + 1), leg: roundIndex < firstLegRounds.length ? 1 : 2, match_order: matchOrder++, home_entry_id: home.id, away_entry_id: away.id, home_placeholder: home.team_name, away_placeholder: away.team_name }));
    });
  });
  return fixtures;
}
function completed(match) { return match.status === 'played' || match.status === 'forfeit'; }

export default function App() {
  const publicTournamentId = publicTournamentIdFromPath();
  if (publicTournamentId) return <PublicTournamentPage tournamentId={publicTournamentId} />;

  const [form, setForm] = useState(initialForm);
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState(null);
  const [activeModule, setActiveModule] = useState('Overview');
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [bulkSelectedIds, setBulkSelectedIds] = useState([]);
  const [progressStats, setProgressStats] = useState({ groupTotal: 0, groupPlayed: 0, knockoutTotal: 0, knockoutPlayed: 0 });
  const canUseDatabase = hasSupabaseConfig && supabase;

  useEffect(() => { if (canUseDatabase) loadTournaments(); }, [canUseDatabase]);
  const selectedTournament = useMemo(() => tournaments.find((item) => item.id === selectedTournamentId) || tournaments.find((item) => !isArchived(item)) || tournaments[0] || null, [selectedTournamentId, tournaments]);
  useEffect(() => { if (canUseDatabase && selectedTournament?.id) loadProgressStats(selectedTournament.id); }, [canUseDatabase, selectedTournament?.id]);

  function updateField(field, value) { setForm((current) => ({ ...current, [field]: value })); }
  function buildPreview(entries) {
    const groupCount = Number(selectedTournament?.group_count || form.groupCount || Math.ceil(entries.length / Number(form.teamsPerGroup || 4)) || 16);
    const sorted = [...entries].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || String(a.team_name).localeCompare(String(b.team_name))).map((entry, index) => ({ ...entry, seed: index + 1 }));
    const groups = generateGroups(sorted, groupCount);
    const fixtures = generateFixtures(groups);
    setPreview({ groups, fixtures });
    setActiveModule('Groups');
    setStatus('Groups generated by average rating: ' + groups.length + ' groups and ' + fixtures.length + ' fixtures.');
  }
  function demoPreview() { buildPreview(demoEntrants.slice(0, Number(form.maxEntries || 64))); }

  async function loadTournaments() {
    setLoading(true);
    setStatus('Loading tournaments...');
    const { data, error } = await supabase.from('tournaments').select('id, name, status, max_entries, actual_entries, group_count, teams_per_group, knockout_teams, secondary_bracket_name, created_at').order('created_at', { ascending: false });
    if (error) setStatus('Could not load tournaments: ' + error.message);
    else {
      const ordered = sortTournaments(data || []);
      setTournaments(ordered);
      if (!selectedTournamentId && ordered[0]) setSelectedTournamentId(ordered[0].id);
      setBulkSelectedIds((ids) => ids.filter((id) => ordered.some((item) => item.id === id)));
      setStatus('Tournaments loaded');
    }
    setLoading(false);
  }
  async function loadProgressStats(tournamentId) {
    const { data, error } = await supabase.from('matches').select('id, stage, status').eq('tournament_id', tournamentId);
    if (error) return setProgressStats({ groupTotal: 0, groupPlayed: 0, knockoutTotal: 0, knockoutPlayed: 0 });
    const matches = data || [];
    const groupMatches = matches.filter((match) => match.stage === 'group');
    const knockoutMatches = matches.filter((match) => match.stage === 'knockout');
    setProgressStats({ groupTotal: groupMatches.length, groupPlayed: groupMatches.filter(completed).length, knockoutTotal: knockoutMatches.length, knockoutPlayed: knockoutMatches.filter(completed).length });
  }
  async function refreshTournamentData() {
    await loadTournaments();
    const tournamentId = selectedTournament?.id || selectedTournamentId;
    if (tournamentId) await loadProgressStats(tournamentId);
  }
  async function deleteRows(table, tournamentIds) {
    if (!tournamentIds.length) return;
    const { error } = await supabase.from(table).delete().in('tournament_id', tournamentIds);
    if (error) throw error;
  }
  async function deleteTournamentIds(ids, label = 'selected') {
    if (!canUseDatabase || !ids.length) return;
    if (!window.confirm(`Delete ${ids.length} ${label} tournament(s) and their fixtures, groups, entries and honours? This cannot be undone.`)) return;
    setLoading(true);
    setStatus(`Deleting ${label} tournaments...`);
    try {
      await deleteRows('achievements', ids);
      await deleteRows('honours', ids);
      await deleteRows('tournament_round_dates', ids);
      const { data: matchRows, error: matchFindError } = await supabase.from('matches').select('id').in('tournament_id', ids);
      if (matchFindError) throw matchFindError;
      const matchIds = (matchRows || []).map((match) => match.id);
      if (matchIds.length) {
        const { error: forfeitError } = await supabase.from('forfeits').delete().in('match_id', matchIds);
        if (forfeitError) throw forfeitError;
      }
      await deleteRows('matches', ids);
      await deleteRows('groups', ids);
      await deleteRows('tournament_entries', ids);
      await deleteRows('tournament_rounds', ids);
      await deleteRows('tournament_stages', ids);
      const { error: tournamentError } = await supabase.from('tournaments').delete().in('id', ids);
      if (tournamentError) throw tournamentError;
      setSelectedTournamentId((current) => ids.includes(current) ? null : current);
      setBulkSelectedIds([]);
      setPreview(null);
      await loadTournaments();
      setStatus(`Deleted ${ids.length} tournament(s).`);
    } catch (error) {
      setStatus('Delete failed: ' + error.message);
    }
    setLoading(false);
  }
  async function updateTournamentIds(ids, nextStatus) {
    if (!canUseDatabase || !ids.length) return;
    setLoading(true);
    setStatus(`Marking ${ids.length} tournament(s) as ${nextStatus}...`);
    const { error } = await supabase.from('tournaments').update({ status: nextStatus }).in('id', ids);
    if (error) setStatus('Status update failed: ' + error.message);
    else { await loadTournaments(); setStatus(`Marked ${ids.length} tournament(s) as ${nextStatus}.`); }
    setLoading(false);
  }
  async function findOrCreate(table, match, row) {
    const { data: existing, error: findError } = await supabase.from(table).select('id').match(match).maybeSingle();
    if (findError) throw findError;
    if (existing) return existing.id;
    const { data, error } = await supabase.from(table).insert(row).select('id').single();
    if (error) throw error;
    return data.id;
  }
  async function createTournament(event) {
    event.preventDefault();
    if (!canUseDatabase) return setStatus('Add your Supabase environment variables in Netlify before saving.');
    setLoading(true);
    setStatus('Creating tournament...');
    try {
      const seasonNumber = Number(String(form.seasonCode).replace(/[^0-9]/g, '')) || null;
      const seasonId = await findOrCreate('seasons', { code: form.seasonCode }, { code: form.seasonCode, number: seasonNumber });
      const competitionId = await findOrCreate('competitions', { name: form.competitionName }, { name: form.competitionName, competition_type: 'youth' });
      const { data, error } = await supabase.from('tournaments').insert({ season_id: seasonId, competition_id: competitionId, name: form.tournamentName, status: 'draft', format: 'groups_then_knockout', source: 'app', max_entries: Number(form.maxEntries), actual_entries: 0, group_count: Number(form.groupCount), teams_per_group: Number(form.teamsPerGroup), knockout_teams: Number(form.knockoutTeams), secondary_bracket_name: form.secondaryBracketName || null, rules_notes: 'Created from Top 100 tournament app dashboard' }).select('id').single();
      if (error) throw error;
      setSelectedTournamentId(data.id);
      setActiveModule('Overview');
      setStatus(form.tournamentName + ' created successfully.');
      await loadTournaments();
    } catch (error) { setStatus('Create failed: ' + error.message); }
    setLoading(false);
  }

  return <main className="app-shell"><section className="hero"><p className="eyebrow">Top 100 Tournament Manager</p><h1>Tournament control centre</h1><p>Create tournaments, choose entrants, generate groups and fixtures, enter results, build knockouts and publish a public tournament page.</p></section><ProgressBar selectedTournament={selectedTournament} preview={preview} progressStats={progressStats} onJump={setActiveModule} />{!canUseDatabase && <section className="warning-card"><strong>Supabase is not connected yet.</strong><span>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify environment variables.</span></section>}<section className="dashboard-layout"><aside className="sidebar card"><p className="eyebrow">Modules</p>{modules.map((module) => <button key={module} type="button" className={activeModule === module ? 'nav-pill active' : 'nav-pill'} onClick={() => setActiveModule(module)}>{module}</button>)}</aside><section className="workspace"><section className="grid two-columns compact"><form className="card" onSubmit={createTournament}><div className="card-header"><p className="eyebrow">Tournament settings</p><h2>Create or configure tournament</h2></div><div className="mini-grid"><label>Season<input value={form.seasonCode} onChange={(event) => updateField('seasonCode', event.target.value)} /></label><label>Competition<input value={form.competitionName} onChange={(event) => updateField('competitionName', event.target.value)} /></label></div><label>Tournament name<input value={form.tournamentName} onChange={(event) => updateField('tournamentName', event.target.value)} /></label><div className="mini-grid"><label>Max entries<input type="number" value={form.maxEntries} onChange={(event) => updateField('maxEntries', event.target.value)} /></label><label>Groups<input type="number" value={form.groupCount} onChange={(event) => updateField('groupCount', event.target.value)} /></label><label>Teams/group<input type="number" value={form.teamsPerGroup} onChange={(event) => updateField('teamsPerGroup', event.target.value)} /></label><label>Knockout teams<input type="number" value={form.knockoutTeams} onChange={(event) => updateField('knockoutTeams', event.target.value)} /></label></div><label>Secondary bracket<input value={form.secondaryBracketName} onChange={(event) => updateField('secondaryBracketName', event.target.value)} /></label><div className="button-row"><button type="submit" disabled={loading}>{loading ? 'Working...' : 'Create tournament'}</button><button type="button" className="secondary" onClick={demoPreview}>Demo preview</button></div><p className="status">{status}</p></form><section className="card"><div className="card-header"><p className="eyebrow">Workflow status</p><h2>{selectedTournament ? selectedTournament.name : 'No tournament selected'}</h2></div><ol className="steps">{workflowSteps.map((step, index) => { const done = isStepDone(step, selectedTournament, preview, progressStats); return <li key={step} className={done ? 'done' : ''}><span>{done ? 'Done' : index + 1}</span>{step}</li>; })}</ol></section></section><section className="card module-card"><div className="card-header row"><div><p className="eyebrow">{activeModule}</p><h2>{moduleHeading(activeModule)}</h2></div><button type="button" className="secondary" onClick={refreshTournamentData} disabled={loading || !canUseDatabase}>Refresh tournament data</button></div><ModuleContent activeModule={activeModule} tournaments={tournaments} selectedTournament={selectedTournament} setSelectedTournamentId={setSelectedTournamentId} preview={preview} setPreview={setPreview} onPreviewGenerated={buildPreview} onTournamentUpdated={refreshTournamentData} bulkSelectedIds={bulkSelectedIds} setBulkSelectedIds={setBulkSelectedIds} onDeleteTournaments={deleteTournamentIds} onUpdateTournaments={updateTournamentIds} loading={loading} /></section></section></section></main>;
}
function moduleHeading(activeModule) { const headings = { Overview: 'Tournament dashboard', Entrants: 'Select teams and managers', Groups: 'Approve generated groups', Fixtures: 'Generate and manage fixtures', Results: 'Results archive and editing', Tables: 'Live group tables', Knockout: 'Cup and Shield draw', Challonge: 'Import legacy Challonge tournaments', 'Public Page': 'Publish and public view' }; return headings[activeModule] || activeModule; }
function ModuleContent({ activeModule, tournaments, selectedTournament, setSelectedTournamentId, preview, setPreview, onPreviewGenerated, onTournamentUpdated, bulkSelectedIds, setBulkSelectedIds, onDeleteTournaments, onUpdateTournaments, loading }) {
  if (activeModule === 'Overview') return <Overview tournaments={tournaments} selectedTournament={selectedTournament} setSelectedTournamentId={setSelectedTournamentId} preview={preview} bulkSelectedIds={bulkSelectedIds} setBulkSelectedIds={setBulkSelectedIds} onDeleteTournaments={onDeleteTournaments} onUpdateTournaments={onUpdateTournaments} loading={loading} />;
  if (activeModule === 'Entrants') return <EntrantsManager selectedTournament={selectedTournament} onPreviewGenerated={onPreviewGenerated} />;
  if (activeModule === 'Groups') return <GroupsApproval selectedTournament={selectedTournament} preview={preview} setPreview={setPreview} />;
  if (activeModule === 'Fixtures') return <FixturesManager selectedTournament={selectedTournament} preview={preview} stage="group" onlyOutstanding onDataChanged={onTournamentUpdated} />;
  if (activeModule === 'Results') return <FixturesManager selectedTournament={selectedTournament} preview={preview} stage="group" onlyCompleted onDataChanged={onTournamentUpdated} />;
  if (activeModule === 'Tables') return <TablesManager selectedTournament={selectedTournament} />;
  if (activeModule === 'Knockout') return <KnockoutManager selectedTournament={selectedTournament} onDataChanged={onTournamentUpdated} />;
  if (activeModule === 'Challonge') return <ChallongeImportManager onTournamentUpdated={onTournamentUpdated} />;
  if (activeModule === 'Public Page') return <PublicPageManager selectedTournament={selectedTournament} onTournamentUpdated={onTournamentUpdated} />;
  return <p className="muted">Module coming next.</p>;
}
function Overview({ tournaments, selectedTournament, setSelectedTournamentId, preview, bulkSelectedIds, setBulkSelectedIds, onDeleteTournaments, onUpdateTournaments, loading }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const filtered = tournaments.filter((tournament) => statusFilter === 'all' || normalStatus(tournament) === statusFilter);
  const statusCounts = tournaments.reduce((counts, tournament) => { const key = normalStatus(tournament); counts[key] = (counts[key] || 0) + 1; return counts; }, {});
  const selectedFilteredIds = filtered.map((item) => item.id).filter((id) => bulkSelectedIds.includes(id));
  const allFilteredSelected = filtered.length > 0 && selectedFilteredIds.length === filtered.length;
  function toggleOne(id) { setBulkSelectedIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]); }
  function toggleFiltered() { const filteredIds = filtered.map((item) => item.id); setBulkSelectedIds((ids) => allFilteredSelected ? ids.filter((id) => !filteredIds.includes(id)) : [...new Set([...ids, ...filteredIds])]); }
  return <div className="overview"><div className="overview-actions bulk-toolbar"><p className="muted">Filter by status, select one or more tournaments, then mark them draft/completed/archived or delete them.</p><div className="status-filter-row">{['all', 'draft', 'groups_approved', 'published', 'completed', 'archived'].map((status) => <button key={status} type="button" className={statusFilter === status ? 'status-filter active' : 'status-filter'} onClick={() => setStatusFilter(status)}>{status === 'all' ? 'All' : status.replace('_', ' ')} <span>{status === 'all' ? tournaments.length : statusCounts[status] || 0}</span></button>)}</div><div className="button-row bulk-actions"><button type="button" className="secondary" onClick={toggleFiltered} disabled={!filtered.length}>{allFilteredSelected ? 'Clear visible' : 'Select visible'}</button><button type="button" className="secondary" onClick={() => setBulkSelectedIds([])} disabled={!bulkSelectedIds.length}>Clear all</button><button type="button" className="secondary" onClick={() => onUpdateTournaments(bulkSelectedIds, 'draft')} disabled={loading || !bulkSelectedIds.length}>Mark draft</button><button type="button" className="secondary" onClick={() => onUpdateTournaments(bulkSelectedIds, 'completed')} disabled={loading || !bulkSelectedIds.length}>Mark completed</button><button type="button" className="secondary" onClick={() => onUpdateTournaments(bulkSelectedIds, 'archived')} disabled={loading || !bulkSelectedIds.length}>Archive selected</button><button type="button" className="danger" onClick={() => onDeleteTournaments(bulkSelectedIds, 'selected')} disabled={loading || !bulkSelectedIds.length}>Delete selected ({bulkSelectedIds.length})</button></div></div><div className="overview-metrics"><article><span>Loaded tournaments</span><strong>{tournaments.length}</strong></article><article><span>Selected</span><strong>{selectedTournament?.name || 'None'}</strong></article><article><span>Preview groups</span><strong>{preview?.groups?.length || 0}</strong></article><article><span>Preview fixtures</span><strong>{preview?.fixtures?.length || 0}</strong></article></div><div className="tournament-grid">{filtered.map((tournament) => <article key={tournament.id} className={selectedTournament?.id === tournament.id ? 'tournament-card selected tournament-select-card' : 'tournament-card tournament-select-card'}><label className="tournament-check"><input type="checkbox" checked={bulkSelectedIds.includes(tournament.id)} onChange={() => toggleOne(tournament.id)} /><span className={`status-pill status-${normalStatus(tournament)}`}>{normalStatus(tournament).replace('_', ' ')}</span></label><button type="button" className="tournament-select-button" onClick={() => setSelectedTournamentId(tournament.id)}><strong>{tournament.name}</strong><span>{tournament.actual_entries || 0}/{tournament.max_entries || '?'} entries</span><span>{tournament.group_count || '?'} groups · {tournament.knockout_teams || '?'} knockout teams</span></button></article>)}</div></div>;
}
