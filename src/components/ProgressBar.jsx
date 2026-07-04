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

export function isStepDone(step, selectedTournament, preview) {
  const actualEntries = Number(selectedTournament?.actual_entries || 0);
  if (step === 'Tournament') return Boolean(selectedTournament);
  if (step === 'Entrants') return actualEntries > 0;
  if (step === 'Groups') return Boolean(preview?.groups?.length);
  if (step === 'Fixtures') return Boolean(preview?.fixtures?.length);
  return false;
}

function currentStageLabel(selectedTournament, preview) {
  if (!selectedTournament) return 'Tournament setup';
  if (!preview?.groups?.length) return 'Entrants and group draw';
  if (!preview?.fixtures?.length) return 'Approve groups';
  return 'Fixtures ready';
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

export default function ProgressBar({ selectedTournament, preview, onJump }) {
  const doneCount = workflowSteps.filter((step) => isStepDone(step, selectedTournament, preview)).length;
  const progress = Math.round((doneCount / workflowSteps.length) * 100);

  return (
    <section className="progress-card">
      <div className="progress-header">
        <div>
          <p className="eyebrow">Tournament progress</p>
          <h2>{progress}% complete</h2>
        </div>
        <span className="stage-pill">{currentStageLabel(selectedTournament, preview)}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: progress + '%' }} />
      </div>
      <div className="progress-steps">
        {workflowSteps.map((step) => {
          const done = isStepDone(step, selectedTournament, preview);
          return (
            <button
              key={step}
              type="button"
              className={done ? 'progress-step done' : 'progress-step'}
              onClick={() => jumpToStep(step, onJump)}
            >
              <span>{done ? 'Done' : 'Next'}</span>
              {step}
            </button>
          );
        })}
      </div>
    </section>
  );
}
