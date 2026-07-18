import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const workflowSteps = [
  'Tournament',
  'Entrants',
  'Groups',
  'Fixtures',
  'Results',
  'Tables',
  'Knockout',
  'Publish',
  'Archive',
];

function isCompletedStatus(status) {
  return status === 'played' || status === 'forfeit';
}

export function isStepDone(step, selectedTournament, preview, progressStats = {}) {
  const actualEntries = Number(selectedTournament?.actual_entries || 0);
  const status = selectedTournament?.status || '';
  const groupTotal = Number(progressStats.groupTotal || 0);
  const groupPlayed = Number(progressStats.groupPlayed || 0);
  const knockoutTotal = Number(progressStats.knockoutTotal || 0);
  const knockoutPlayed = Number(progressStats.knockoutPlayed || 0);

  if (step === 'Tournament') return Boolean(selectedTournament);
  if (step === 'Entrants') return actualEntries > 0;
  if (step === 'Groups') return Boolean(preview?.groups?.length) || actualEntries > 0;
  if (step === 'Fixtures') return Boolean(preview?.fixtures?.length) || groupTotal > 0;
  if (step === 'Results') return groupTotal > 0 && groupPlayed === groupTotal;
  if (step === 'Tables') return groupTotal > 0 && groupPlayed === groupTotal;
  if (step === 'Knockout') return knockoutTotal > 0 && knockoutPlayed === knockoutTotal;
  if (step === 'Publish') return ['published', 'archived', 'completed'].includes(status);
  if (step === 'Archive') return ['archived', 'completed'].includes(status);
  return false;
}

function currentStageLabel(selectedTournament, preview, progressStats = {}) {
  if (!selectedTournament) return 'Tournament setup';
  const groupTotal = Number(progressStats.groupTotal || 0);
  const groupPlayed = Number(progressStats.groupPlayed || 0);
  const knockoutTotal = Number(progressStats.knockoutTotal || 0);
  const knockoutPlayed = Number(progressStats.knockoutPlayed || 0);
  const status = selectedTournament.status || '';

  if (['published', 'archived', 'completed'].includes(status)) return status.charAt(0).toUpperCase() + status.slice(1);
  if (knockoutTotal > 0 && knockoutPlayed === knockoutTotal) return 'Tournament complete';
  if (knockoutTotal > 0) return 'Knockouts live';
  if (groupTotal > 0 && groupPlayed === groupTotal) return 'Group results complete';
  if (groupTotal > 0 || preview?.fixtures?.length) return 'Fixtures ready';
  if (preview?.groups?.length) return 'Approve groups';
  return 'Entrants and group draw';
}

function jumpToStep(step, onJump) {
  const mapping = {
    Tournament: 'Overview',
    Entrants: 'Entrants',
    Groups: 'Groups',
    Fixtures: 'Fixtures',
    Results: 'Results',
    Tables: 'Tables',
    Knockout: 'Knockout',
    Publish: 'Public Page',
    Archive: 'Public Page',
  };
  onJump(mapping[step] || 'Overview');
}

export default function ProgressBar({ selectedTournament, preview, progressStats, onJump }) {
  const [pendingResults, setPendingResults] = useState(0);
  const doneCount = workflowSteps.filter((step) => isStepDone(step, selectedTournament, preview, progressStats)).length;
  const progress = Math.round((doneCount / workflowSteps.length) * 100);

  useEffect(() => {
    let active = true;
    async function loadPendingResults() {
      const { count, error } = await supabase
        .from('manager_result_submissions')
        .select('id', { count: 'exact', head: true })
        .in('status', ['pending_confirmation', 'disputed', 'pending_admin_check', 'opponent_confirmed', 'appealed']);
      if (active && !error) setPendingResults(count || 0);
    }
    loadPendingResults();
    return () => { active = false; };
  }, []);

  return (
    <>
      <section className="progress-card">
        <div className="progress-header">
          <div>
            <p className="eyebrow">Tournament progress</p>
            <h2>{progress}% complete</h2>
          </div>
          <span className="stage-pill">{currentStageLabel(selectedTournament, preview, progressStats)}</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: progress + '%' }} />
        </div>
        <div className="progress-steps">
          {workflowSteps.map((step) => {
            const done = isStepDone(step, selectedTournament, preview, progressStats);
            return (
              <button key={step} type="button" className={done ? 'progress-step done' : 'progress-step'} onClick={() => jumpToStep(step, onJump)}>
                <span>{done ? 'Done' : 'Next'}</span>
                {step}
              </button>
            );
          })}
        </div>
      </section>

      <section className="card admin-attention-bar">
        <div>
          <p className="eyebrow">Admin inbox</p>
          <strong>{pendingResults ? `${pendingResults} provisional result${pendingResults === 1 ? '' : 's'} awaiting final checks or appeal review` : 'No provisional results awaiting attention'}</strong>
        </div>
        <div className="button-row">
          <a className="button" href="/admin/result-submissions">Review result checks{pendingResults ? ` (${pendingResults})` : ''}</a>
          <a className="button secondary" href="/admin/manager-accounts">Manager accounts</a>
        </div>
      </section>
    </>
  );
}
