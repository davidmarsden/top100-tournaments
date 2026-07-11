import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const steps = [
  ['registration', 'Registration'],
  ['entrants', 'Entrants'],
  ['groups', 'Groups'],
  ['fixtures', 'Fixtures'],
  ['results', 'Results'],
  ['knockout', 'Knockout'],
  ['publish', 'Publish'],
  ['complete', 'Complete'],
];

function isPlayed(match) {
  return match.status === 'played' || match.status === 'forfeit';
}

export default function TournamentBuilder({ selectedTournament, preview, buildPreview, onNavigate, onRefresh }) {
  const [summary, setSummary] = useState(null);
  const [status, setStatus] = useState('Loading builder status...');
  const [loading, setLoading] = useState(false);
  const tournamentId = selectedTournament?.id;

  useEffect(() => {
    if (tournamentId) loadSummary();
  }, [tournamentId]);

  const currentStep = useMemo(() => {
    if (!summary) return 'registration';
    if (summary.entries === 0) return 'registration';
    if (summary.entries < summary.maxEntries) return 'entrants';
    if (summary.groups === 0) return 'groups';
    if (summary.groupMatches === 0) return 'fixtures';
    if (summary.groupPlayed < summary.groupMatches) return 'results';
    if (summary.knockoutMatches === 0) return 'knockout';
    if (summary.knockoutPlayed < summary.knockoutMatches) return 'results';
    if (!selectedTournament?.is_public) return 'publish';
    if (!['completed', 'archived'].includes(String(selectedTournament?.status || '').toLowerCase())) return 'complete';
    return 'complete';
  }, [summary, selectedTournament]);

  async function loadSummary() {
    if (!tournamentId) return;
    setLoading(true);
    const [entriesResult, groupsResult, matchesResult, registrationsResult] = await Promise.all([
      supabase.from('tournament_entries').select('id', { count: 'exact', head: true }).eq('tournament_id', tournamentId),
      supabase.from('groups').select('id', { count: 'exact', head: true }).eq('tournament_id', tournamentId),
      supabase.from('matches').select('id, stage, status').eq('tournament_id', tournamentId),
      supabase.from('tournament_registrations').select('id, status, promoted_entry_id').eq('tournament_id', tournamentId),
    ]);
    const error = entriesResult.error || groupsResult.error || matchesResult.error || registrationsResult.error;
    if (error) {
      setStatus('Could not load builder status: ' + error.message);
      setLoading(false);
      return;
    }
    const matches = matchesResult.data || [];
    const groupMatches = matches.filter((match) => match.stage === 'group');
    const knockoutMatches = matches.filter((match) => match.stage === 'knockout');
    const registrations = registrationsResult.data || [];
    setSummary({
      entries: entriesResult.count || 0,
      maxEntries: Number(selectedTournament.max_entries || 0),
      groups: groupsResult.count || 0,
      groupMatches: groupMatches.length,
      groupPlayed: groupMatches.filter(isPlayed).length,
      knockoutMatches: knockoutMatches.length,
      knockoutPlayed: knockoutMatches.filter(isPlayed).length,
      pendingRegistrations: registrations.filter((row) => row.status === 'pending').length,
      approvedUnpromoted: registrations.filter((row) => row.status === 'approved' && !row.promoted_entry_id).length,
    });
    setStatus('Builder status updated.');
    setLoading(false);
  }

  async function generateGroupPreview() {
    setLoading(true);
    setStatus('Loading entrants and generating seeded groups...');
    const { data, error } = await supabase.from('tournament_entries')
      .select('id, seed, rating, teams(name), managers(name, display_name)')
      .eq('tournament_id', tournamentId)
      .order('rating', { ascending: false });
    if (error) {
      setStatus('Could not load entrants: ' + error.message);
      setLoading(false);
      return;
    }
    const entrants = (data || []).map((entry) => ({
      id: entry.id,
      team_name: entry.teams?.name || 'Unknown team',
      manager_name: entry.managers?.display_name || entry.managers?.name || 'TBC',
      seed: entry.seed,
      rating: entry.rating,
    }));
    buildPreview(entrants);
    setStatus(`Generated a preview for ${entrants.length} entrants.`);
    setLoading(false);
    onNavigate('Groups');
  }

  async function markCompleted() {
    if (!window.confirm(`Mark ${selectedTournament.name} completed? This will switch it to archive presentation automatically.`)) return;
    setLoading(true);
    const { error } = await supabase.from('tournaments').update({
      status: 'completed',
      archived_at: new Date().toISOString(),
      archive_quality: 'complete',
      is_public: true,
    }).eq('id', tournamentId);
    if (error) setStatus('Could not complete tournament: ' + error.message);
    else {
      setStatus('Tournament completed and archive view activated.');
      await onRefresh?.();
      await loadSummary();
    }
    setLoading(false);
  }

  function actionFor(step) {
    if (step === 'registration') return { label: 'Manage registrations', action: () => onNavigate('Registration') };
    if (step === 'entrants') return { label: 'Review entrants', action: () => onNavigate('Entrants') };
    if (step === 'groups') return preview?.groups?.length
      ? { label: 'Review generated groups', action: () => onNavigate('Groups') }
      : { label: 'Generate groups', action: generateGroupPreview };
    if (step === 'fixtures') return { label: 'Open fixtures', action: () => onNavigate('Fixtures') };
    if (step === 'results') return { label: 'Enter results', action: () => onNavigate('Results') };
    if (step === 'knockout') return { label: 'Generate knockout', action: () => onNavigate('Knockout') };
    if (step === 'publish') return { label: 'Open public page settings', action: () => onNavigate('Public Page') };
    return { label: 'Complete and archive', action: markCompleted };
  }

  function stepState(key) {
    if (!summary) return 'waiting';
    const order = steps.map(([step]) => step);
    const currentIndex = order.indexOf(currentStep);
    const index = order.indexOf(key);
    if (index < currentIndex) return 'done';
    if (index === currentIndex) return 'current';
    return 'waiting';
  }

  if (!selectedTournament) return <p className="muted">Select a tournament first.</p>;
  const nextAction = actionFor(currentStep);

  return <div className="tournament-builder">
    <section className="entrant-panel builder-hero">
      <p className="eyebrow">Guided tournament builder</p>
      <h3>{selectedTournament.name}</h3>
      <p className="muted">The builder reads the saved tournament data and takes you to the next unfinished stage.</p>
      {summary && <div className="overview-metrics compact-metrics">
        <article><span>Entrants</span><strong>{summary.entries}/{summary.maxEntries}</strong></article>
        <article><span>Groups</span><strong>{summary.groups}</strong></article>
        <article><span>Group results</span><strong>{summary.groupPlayed}/{summary.groupMatches}</strong></article>
        <article><span>Knockout results</span><strong>{summary.knockoutPlayed}/{summary.knockoutMatches}</strong></article>
      </div>}
      <div className="button-row">
        <button type="button" onClick={nextAction.action} disabled={loading}>{loading ? 'Working...' : `Next: ${nextAction.label}`}</button>
        <button type="button" className="secondary" onClick={loadSummary} disabled={loading}>Refresh builder</button>
      </div>
      <p className="status">{status}</p>
    </section>

    <section className="builder-steps">
      {steps.map(([key, label], index) => {
        const state = stepState(key);
        const action = actionFor(key);
        return <article className={`builder-step ${state}`} key={key}>
          <span>{state === 'done' ? '✓' : index + 1}</span>
          <div><strong>{label}</strong><small>{state === 'done' ? 'Complete' : state === 'current' ? 'Next step' : 'Waiting'}</small></div>
          {state === 'current' && <button type="button" className="secondary" onClick={action.action} disabled={loading}>{action.label}</button>}
        </article>;
      })}
    </section>
  </div>;
}
