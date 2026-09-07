import { useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

function defaultCloseValue() {
  const value = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  value.setMinutes(0, 0, 0);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

export default function AdminPollBuilder({ onCreated, setMessage }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [question, setQuestion] = useState('');
  const [optionsText, setOptionsText] = useState('Yes\nNo');
  const [closesAt, setClosesAt] = useState(defaultCloseValue());
  const [resultsVisibility, setResultsVisibility] = useState('after_close');
  const [governanceKind, setGovernanceKind] = useState('advisory');
  const [quorumPercent, setQuorumPercent] = useState('0');
  const [decisionRule, setDecisionRule] = useState('simple_majority');
  const [thresholdPercent, setThresholdPercent] = useState('50');
  const [tiePolicy, setTiePolicy] = useState('no_change');
  const [saving, setSaving] = useState(false);

  const optionLabels = useMemo(() => optionsText.split('\n').map((value) => value.trim()).filter(Boolean), [optionsText]);

  async function createPoll(event) {
    event.preventDefault();
    if (optionLabels.length < 2) return setMessage('Add at least two voting options.');
    setSaving(true);
    setMessage('Creating draft poll…');
    const { data, error } = await supabase.rpc('create_manager_poll', {
      poll_title: title.trim(),
      poll_description: description.trim(),
      question_title: question.trim(),
      option_labels: optionLabels,
      closes_at_value: new Date(closesAt).toISOString(),
      results_visibility_value: resultsVisibility,
      governance_kind_value: governanceKind,
      quorum_percent_value: Number(quorumPercent || 0),
      decision_rule_value: decisionRule,
      threshold_percent_value: Number(thresholdPercent || 50),
      tie_policy_value: tiePolicy,
    });
    setSaving(false);
    if (error) return setMessage(error.message);
    setMessage(`Draft poll created (#${data}). Review it below, then open it to snapshot the electorate.`);
    setTitle('');
    setDescription('');
    setQuestion('');
    setOptionsText('Yes\nNo');
    if (onCreated) await onCreated();
  }

  return <section className="card">
    <p className="eyebrow">Administrator</p>
    <h2>Create All-Manager Poll</h2>
    <p className="muted">Create the poll as a draft first. Opening it freezes the eligible electorate for the life of that vote.</p>
    <form onSubmit={createPoll}>
      <label>Poll title<input value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="Proposed change to transfer rule" /></label>
      <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Background managers should read before voting" /></label>
      <label>Question<input value={question} onChange={(event) => setQuestion(event.target.value)} required placeholder="Should this proposal be adopted?" /></label>
      <label>Options <span className="muted">(one per line)</span><textarea value={optionsText} onChange={(event) => setOptionsText(event.target.value)} rows={4} required /></label>
      <label>Voting closes<input type="datetime-local" value={closesAt} onChange={(event) => setClosesAt(event.target.value)} required /></label>
      <label>Poll type<select value={governanceKind} onChange={(event) => setGovernanceKind(event.target.value)}><option value="advisory">Advisory</option><option value="rule_change">Rule change</option><option value="appointment">Appointment</option><option value="other">Other</option></select></label>
      <label>Decision rule<select value={decisionRule} onChange={(event) => setDecisionRule(event.target.value)}><option value="plurality">Plurality — most votes wins</option><option value="simple_majority">Majority — threshold required</option><option value="supermajority">Supermajority — threshold required</option></select></label>
      {decisionRule !== 'plurality' && <label>Required winning share (%)<input type="number" min="1" max="100" step="0.01" value={thresholdPercent} onChange={(event) => setThresholdPercent(event.target.value)} required /></label>}
      <label>Quorum (%)<input type="number" min="0" max="100" step="0.01" value={quorumPercent} onChange={(event) => setQuorumPercent(event.target.value)} /></label>
      <label>Tie handling<select value={tiePolicy} onChange={(event) => setTiePolicy(event.target.value)}><option value="no_change">No change carried</option><option value="runoff">Runoff required</option><option value="admin_decision">Admin decision required</option></select></label>
      <label>Results<select value={resultsVisibility} onChange={(event) => setResultsVisibility(event.target.value)}><option value="after_close">After voting closes</option><option value="live">Live while voting</option><option value="hidden">Admin only</option></select></label>
      <button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create draft poll'}</button>
    </form>
  </section>;
}
