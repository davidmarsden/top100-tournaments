import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function isCompleted(match) {
  return match.status === 'played' || match.status === 'forfeit';
}

export default function PublicPageManager({ selectedTournament, onTournamentUpdated }) {
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);

  const tournamentId = selectedTournament?.id;

  useEffect(() => {
    if (hasSupabaseConfig && supabase && tournamentId) loadSummary();
  }, [tournamentId]);

  const summary = useMemo(() => {
    const groupMatches = matches.filter((match) => match.stage === 'group');
    const knockoutMatches = matches.filter((match) => match.stage === 'knockout');
    return {
      groupTotal: groupMatches.length,
      groupPlayed: groupMatches.filter(isCompleted).length,
      knockoutTotal: knockoutMatches.length,
      knockoutPlayed: knockoutMatches.filter(isCompleted).length,
    };
  }, [matches]);

  async function loadSummary() {
    if (!tournamentId) return;
    setLoading(true);
    setStatus('Loading tournament summary...');
    const { data, error } = await supabase
      .from('matches')
      .select('id, stage, status')
      .eq('tournament_id', tournamentId);

    if (error) {
      setStatus('Could not load summary: ' + error.message);
      setMatches([]);
    } else {
      setMatches(data || []);
      setStatus('Summary loaded.');
    }
    setLoading(false);
  }

  async function updateTournamentStatus(nextStatus) {
    if (!tournamentId) return;
    setLoading(true);
    setStatus('Saving tournament status...');
    const { error } = await supabase
      .from('tournaments')
      .update({ status: nextStatus })
      .eq('id', tournamentId);

    if (error) setStatus('Status update failed: ' + error.message);
    else {
      setStatus('Tournament marked as ' + nextStatus + '.');
      await onTournamentUpdated?.();
      await loadSummary();
    }
    setLoading(false);
  }

  if (!selectedTournament) return <p className="muted">Create or select a tournament first.</p>;
  if (!hasSupabaseConfig || !supabase) return <p className="muted">Supabase is not connected yet.</p>;

  const publicPath = '/tournaments/' + selectedTournament.id;
  const tournamentComplete = summary.knockoutTotal > 0 && summary.knockoutPlayed === summary.knockoutTotal;

  return (
    <div className="public-page-manager">
      <section className="public-grid">
        <article className="public-card">
          <p className="eyebrow">Publishing controls</p>
          <h3>{selectedTournament.name}</h3>
          <p className="muted">Status: <strong>{selectedTournament.status || 'draft'}</strong></p>
          <div className="button-row">
            <button type="button" onClick={() => updateTournamentStatus('published')} disabled={loading}>Mark published</button>
            <button type="button" className="secondary" onClick={() => updateTournamentStatus('completed')} disabled={loading || !tournamentComplete}>Mark completed</button>
            <button type="button" className="secondary" onClick={() => updateTournamentStatus('archived')} disabled={loading}>Archive tournament</button>
          </div>
          {!tournamentComplete && <p className="muted">Complete all knockout fixtures before marking the tournament completed.</p>}
        </article>

        <article className="public-card">
          <p className="eyebrow">Public page preview</p>
          <h3>Archive URL</h3>
          <code>{publicPath}</code>
          <p className="muted">Next build step: turn this into a read-only tournament page with groups, results, brackets and winners.</p>
        </article>
      </section>

      <section className="public-card">
        <p className="eyebrow">Completion summary</p>
        <div className="overview-metrics compact-metrics">
          <article><span>Group results</span><strong>{summary.groupPlayed}/{summary.groupTotal}</strong></article>
          <article><span>Knockout results</span><strong>{summary.knockoutPlayed}/{summary.knockoutTotal}</strong></article>
          <article><span>Ready to complete</span><strong>{tournamentComplete ? 'Yes' : 'No'}</strong></article>
        </div>
        <p className="status">{status}</p>
        <button type="button" className="secondary" onClick={loadSummary} disabled={loading}>Reload summary</button>
      </section>
    </div>
  );
}
