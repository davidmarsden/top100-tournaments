import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

function defaultCloseValue() {
  const value = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  value.setMinutes(0, 0, 0);
  const local = new Date(value.getTime() - value.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function localDateTimeValue(value) {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

function minimumDeadlineValue() {
  const date = new Date(Date.now() + 60 * 1000);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60 * 1000);
  return local.toISOString().slice(0, 16);
}

export default function AdminPollBuilder({ onCreated, setMessage, refreshKey = 0 }) {
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
  const [editablePolls, setEditablePolls] = useState([]);
  const [deadlinePollId, setDeadlinePollId] = useState('');
  const [deadlineValue, setDeadlineValue] = useState('');
  const [savingDeadline, setSavingDeadline] = useState(false);

  const optionLabels = useMemo(() => optionsText.split('\n').map((value) => value.trim()).filter(Boolean), [optionsText]);

  async function loadEditablePolls() {
    const { data, error } = await supabase
      .from('voting_events')
      .select('id, title, status, closes_at')
      .eq('event_type', 'poll')
      .in('status', ['draft', 'open'])
      .order('created_at', { ascending: false });
    if (error) return setMessage(error.message);
    const now = Date.now();
    const rows = (data || []).filter((poll) => poll.status === 'draft' || !poll.closes_at || new Date(poll.closes_at).getTime() > now);
    setEditablePolls(rows);
    setDeadlinePollId((current) => current && rows.some((poll) => String(poll.id) === String(current)) ? current : (rows[0] ? String(rows[0].id) : ''));
  }

  useEffect(() => { loadEditablePolls(); }, [refreshKey]);

  useEffect(() => {
    const poll = editablePolls.find((item) => String(item.id) === String(deadlinePollId));
    setDeadlineValue(localDateTimeValue(poll?.closes_at));
  }, [deadlinePollId, editablePolls]);

  async function createPoll(event) {
    event.preventDefault();
    if (optionLabels.length < 2) return setMessage('Add at least two voting options.');
    setSaving(true);
    setMessage('Creating draft poll…');
    const { data, error } = await supabase.rpc('create_manager_poll', {
      poll_title: title.trim(), poll_description: description.trim(), question_title: question.trim(), option_labels: optionLabels,
      closes_at_value: new Date(closesAt).toISOString(), results_visibility_value: resultsVisibility, governance_kind_value: governanceKind,
      quorum_percent_value: Number(quorumPercent || 0), decision_rule_value: decisionRule,
      threshold_percent_value: Number(thresholdPercent || 50), tie_policy_value: tiePolicy,
    });
    setSaving(false);
    if (error) return setMessage(error.message);
    setMessage(`Draft poll created (#${data}). Review it below, then open it to snapshot the electorate.`);
    setTitle(''); setDescription(''); setQuestion(''); setOptionsText('Yes\nNo');
    await loadEditablePolls();
    if (onCreated) await onCreated();
  }

  async function updateDeadline(event) {
    event.preventDefault();
    if (!deadlinePollId || !deadlineValue) return setMessage('Choose a poll and closing date.');
    const replacementDeadline = new Date(deadlineValue);
    if (replacementDeadline.getTime() <= Date.now()) return setMessage('Poll closing date must be in the future.');
    setSavingDeadline(true);
    setMessage('Updating poll closing date…');
    const { error } = await supabase.rpc('update_voting_event_deadline', {
      target_event_id: Number(deadlinePollId),
      new_closes_at: replacementDeadline.toISOString(),
    });
    setSavingDeadline(false);
    if (error) return setMessage(error.message);
    setMessage('Poll closing date updated. Existing electorate and ballots are unchanged.');
    await loadEditablePolls();
    if (onCreated) await onCreated();
  }

  return <>
    <section className="card">
      <p className="eyebrow">Administrator</p>
      <h2>Edit poll closing date</h2>
      <p className="muted">Change the deadline for a draft or still-open Community Poll. Once a voting deadline has passed, it cannot be reopened by moving the deadline.</p>
      {editablePolls.length ? <form onSubmit={updateDeadline}>
        <label>Poll<select value={deadlinePollId} onChange={(event) => setDeadlinePollId(event.target.value)}>{editablePolls.map((poll) => <option key={poll.id} value={poll.id}>{poll.title} — {poll.status}</option>)}</select></label>
        <label>Voting closes<input type="datetime-local" min={minimumDeadlineValue()} value={deadlineValue} onChange={(event) => setDeadlineValue(event.target.value)} required /></label>
        <button type="submit" disabled={savingDeadline}>{savingDeadline ? 'Saving…' : 'Update closing date'}</button>
      </form> : <p className="muted">There are no draft or open Community Polls with an editable deadline.</p>}
    </section>

    <section className="card">
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
        <label>Quorum (%) <span className="muted">— minimum percentage of eligible managers who must vote for the poll to be valid</span><input type="number" min="0" max="100" step="0.01" value={quorumPercent} onChange={(event) => setQuorumPercent(event.target.value)} /><span className="muted">For example, a 50% quorum means at least half of eligible managers must vote.</span></label>
        <label>Tie handling<select value={tiePolicy} onChange={(event) => setTiePolicy(event.target.value)}><option value="no_change">No change carried</option><option value="runoff">Runoff required</option><option value="admin_decision">Admin decision required</option></select></label>
        <label>Results<select value={resultsVisibility} onChange={(event) => setResultsVisibility(event.target.value)}><option value="after_close">After voting closes</option><option value="manual_release">Hidden until an admin releases them</option><option value="live">Live while voting</option><option value="hidden">Admin only</option></select></label>
        <button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create draft poll'}</button>
      </form>
    </section>
  </>;
}
