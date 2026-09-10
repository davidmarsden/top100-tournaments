import { useEffect, useMemo, useState } from 'react';
import AdminPollBuilder from './AdminPollBuilder.jsx';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function formatDate(value) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function governanceLabel(value) {
  return ({ advisory: 'Advisory', rule_change: 'Rule change', appointment: 'Appointment', other: 'Other' })[value] || 'Poll';
}

export default function VotingPortal() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [account, setAccount] = useState(null);
  const [events, setEvents] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [options, setOptions] = useState([]);
  const [ballots, setBallots] = useState([]);
  const [responses, setResponses] = useState([]);
  const [answers, setAnswers] = useState({});
  const [isAdmin, setIsAdmin] = useState(false);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [results, setResults] = useState({});
  const [finalResults, setFinalResults] = useState({});

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setLoading(false); return undefined; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session || null); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (session?.user?.id) loadVoting();
    else { setLoading(false); setAccount(null); setEvents([]); }
  }, [session?.user?.id]);

  const questionsByEvent = useMemo(() => {
    const map = new Map();
    questions.forEach((question) => {
      const list = map.get(question.event_id) || [];
      list.push(question);
      map.set(question.event_id, list);
    });
    return map;
  }, [questions]);

  const optionsByQuestion = useMemo(() => {
    const map = new Map();
    options.forEach((option) => {
      const list = map.get(option.question_id) || [];
      list.push(option);
      map.set(option.question_id, list);
    });
    return map;
  }, [options]);

  async function sendMagicLink(event) {
    event.preventDefault();
    setLoading(true); setMessage('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/vote`, shouldCreateUser: true },
    });
    setMessage(error ? error.message : 'Check your email for your secure voting sign-in link.');
    setLoading(false);
  }

  async function loadVoting() {
    setLoading(true); setMessage('Loading votes…');
    const [accountResult, adminResult, eventResult] = await Promise.all([
      supabase.from('manager_portal_accounts').select('id, manager_id, active, managers(id, name, display_name)').eq('auth_user_id', session.user.id).eq('active', true).maybeSingle(),
      supabase.rpc('is_admin'),
      supabase.from('voting_events').select('*').order('created_at', { ascending: false }),
    ]);
    if (accountResult.error) { setMessage(accountResult.error.message); setLoading(false); return; }

    const managerAccount = accountResult.data || null;
    const adminAccess = Boolean(adminResult.data);
    setAccount(managerAccount);
    setIsAdmin(adminAccess);
    if (eventResult.error) { setMessage(eventResult.error.message); setLoading(false); return; }

    const eventRows = eventResult.data || [];
    setEvents(eventRows);
    const eventIds = eventRows.map((row) => row.id);
    if (!eventIds.length) { setQuestions([]); setOptions([]); setBallots([]); setResponses([]); setFinalResults({}); setLoading(false); setMessage('No votes available.'); return; }

    const ownBallotQuery = managerAccount
      ? supabase.from('voting_ballots').select('*').in('event_id', eventIds).eq('manager_id', managerAccount.manager_id)
      : Promise.resolve({ data: [], error: null });

    const finalResultQuery = supabase.from('voting_event_results').select('*').in('event_id', eventIds);

    const [questionResult, ballotResult, finalResultResult] = await Promise.all([
      supabase.from('voting_questions').select('*').in('event_id', eventIds).order('sort_order').order('id'),
      ownBallotQuery,
      finalResultQuery,
    ]);
    if (questionResult.error) { setMessage(questionResult.error.message); setLoading(false); return; }
    const questionRows = questionResult.data || [];
    setQuestions(questionRows);

    const finalMap = {};
    (finalResultResult.error ? [] : (finalResultResult.data || [])).forEach((row) => { finalMap[row.event_id] = row; });
    setFinalResults(finalMap);

    const questionIds = questionRows.map((row) => row.id);
    const ballotRows = ballotResult.error ? [] : (ballotResult.data || []);
    setBallots(ballotRows);

    const [optionResult, responseResult] = await Promise.all([
      questionIds.length ? supabase.from('voting_options').select('*').in('question_id', questionIds).order('sort_order').order('id') : Promise.resolve({ data: [], error: null }),
      ballotRows.length ? supabase.from('voting_responses').select('*').in('ballot_id', ballotRows.map((row) => row.id)) : Promise.resolve({ data: [], error: null }),
    ]);
    setOptions(optionResult.error ? [] : (optionResult.data || []));
    const responseRows = responseResult.error ? [] : (responseResult.data || []);
    setResponses(responseRows);
    const existing = {};
    responseRows.forEach((row) => { existing[row.question_id] = row.option_id; });
    setAnswers(existing);

    if (managerAccount) setMessage('Voting account verified.');
    else if (adminAccess) setMessage('Administrator access verified.');
    else setMessage('Your sign-in is valid, but you do not have an active manager account.');
    setLoading(false);
  }

  async function submitBallot(eventId) {
    if (!account) return setMessage('An active manager account is required to vote.');
    const eventQuestions = questionsByEvent.get(eventId) || [];
    const payload = eventQuestions
      .filter((question) => answers[question.id])
      .map((question) => ({ question_id: question.id, option_id: Number(answers[question.id]) }));
    setMessage('Saving your ballot…');
    const { error } = await supabase.rpc('submit_voting_ballot', { target_event_id: eventId, answers: payload });
    if (error) return setMessage(error.message);
    setMessage('Vote saved. You can change it until voting closes.');
    await loadVoting();
  }

  async function openEvent(eventId) {
    setMessage('Opening vote and snapshotting the electorate…');
    const { data, error } = await supabase.rpc('open_voting_event', { target_event_id: eventId });
    setMessage(error ? error.message : `Vote opened for ${data} eligible manager accounts.`);
    if (!error) await loadVoting();
  }

  async function closeEvent(eventId) {
    const { error } = await supabase.rpc('close_voting_event', { target_event_id: eventId });
    setMessage(error ? error.message : 'Vote closed. You can now finalise the result.');
    if (!error) await loadVoting();
  }

  async function finaliseEvent(vote) {
    setMessage(vote.event_type === 'awards' ? 'Finalising each Awards category…' : 'Finalising turnout, quorum and result…');
    const rpcName = vote.event_type === 'awards' ? 'finalise_awards_event' : 'finalise_voting_event';
    const { data, error } = await supabase.rpc(rpcName, { target_event_id: vote.id });
    if (error) return setMessage(error.message);
    setMessage(data?.decision_summary || 'Vote finalised.');
    await loadVoting();
  }

  async function releaseResults(eventId) {
    setMessage('Releasing results…');
    const { data, error } = await supabase.rpc('release_voting_results', { target_event_id: eventId });
    if (error) return setMessage(error.message);
    setMessage(`Results released${data ? ` at ${formatDate(data)}` : ''}.`);
    await loadVoting();
  }

  async function loadResults(eventId) {
    const { data, error } = await supabase.rpc('get_voting_results', { target_event_id: eventId });
    if (error) return setMessage(error.message);
    setResults((current) => ({ ...current, [eventId]: data || [] }));
  }

  async function logout() { await supabase.auth.signOut(); setMessage('Signed out.'); }

  if (!hasSupabaseConfig || !supabase) return <main className="manager-portal-shell"><section className="warning-card"><strong>Voting unavailable.</strong><span>Supabase is not connected.</span></section></main>;

  if (!session) return <main className="manager-portal-shell"><section className="manager-portal-hero"><p className="eyebrow">Top 100</p><h1>Manager Voting</h1><p>Secure one-manager-one-vote polling using your existing Top 100 manager account.</p></section><section className="card manager-login-card"><h2>Sign in securely</h2><p className="muted">Use the same email address as your Manager Portal account.</p><form onSubmit={sendMagicLink}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><button type="submit" disabled={loading}>{loading ? 'Sending…' : 'Email me a sign-in link'}</button></form>{message && <p className="status">{message}</p>}</section></main>;

  const canRenderEvents = Boolean(account || isAdmin);

  return <main className="manager-portal-shell">
    <section className="manager-portal-hero"><div><p className="eyebrow">Top 100</p><h1>Manager Voting</h1><p>{account ? `Signed in as ${account.managers?.display_name || account.managers?.name || 'manager'}.` : `Signed in as ${session.user.email}.`}</p></div><button type="button" className="secondary" onClick={logout}>Sign out</button></section>
    {message && <p className="status">{message}</p>}
    {loading && <section className="card"><h2>Loading…</h2></section>}
    {!loading && isAdmin && <AdminPollBuilder onCreated={loadVoting} setMessage={setMessage} />}
    {!loading && !account && !isAdmin && <section className="card"><h2>Manager account required</h2><p>Your email is authenticated, but it is not linked to an active Top 100 manager account. Use the Manager Portal to claim or restore your manager identity first.</p><a href="https://manager.smtop100.blog/">Go to Manager Portal</a></section>}
    {!loading && isAdmin && !account && <section className="card"><h2>Administrator mode</h2><p>You can create, open, close and finalise voting events, but you need an active manager account to cast a ballot.</p></section>}
    {!loading && canRenderEvents && events.length === 0 && <section className="card"><h2>No votes available</h2><p>There are no voting events available at the moment.</p></section>}
    {!loading && canRenderEvents && events.map((vote) => {
      const eventQuestions = questionsByEvent.get(vote.id) || [];
      const existingBallot = ballots.find((ballot) => ballot.event_id === vote.id);
      const resultRows = results[vote.id] || [];
      const finalResult = finalResults[vote.id];
      const now = new Date();
      const deadlinePassed = Boolean(vote.closes_at) && new Date(vote.closes_at) <= now;
      const canVote = Boolean(account) && vote.status === 'open' && (!vote.opens_at || new Date(vote.opens_at) <= now) && (!vote.closes_at || !deadlinePassed);
      const manualReleased = vote.results_visibility === 'manual_release' && Boolean(vote.results_released_at);
      const resultsAvailable = isAdmin || vote.results_visibility === 'live' || manualReleased || (vote.results_visibility === 'after_close' && (vote.status === 'closed' || deadlinePassed));
      const canFinalise = isAdmin && !finalResult && (vote.status === 'closed' || (vote.status === 'open' && deadlinePassed));
      const canRelease = isAdmin && vote.results_visibility === 'manual_release' && !vote.results_released_at && Boolean(finalResult) && (vote.status === 'closed' || deadlinePassed);
      return <section className="card" key={vote.id}>
        <p className="eyebrow">{vote.event_type === 'awards' ? 'Awards' : vote.event_type === 'test' ? 'System test' : governanceLabel(vote.governance_kind)} · {vote.status}</p>
        <h2>{vote.title}</h2>
        {vote.description && <p>{vote.description}</p>}
        <p className="muted">Opens: {formatDate(vote.opens_at)} · Closes: {formatDate(vote.closes_at)}</p>
        {vote.event_type === 'poll' && <p className="muted">Quorum: {vote.quorum_percent || 0}% · Decision: {vote.decision_rule}{vote.decision_rule !== 'plurality' ? ` at ${vote.threshold_percent}%` : ''} · Tie: {(vote.tie_policy || 'no_change').replaceAll('_', ' ')}</p>}
        {existingBallot && <p><strong>Your ballot is saved.</strong> {canVote ? 'You may change it before the deadline.' : ''}</p>}
        {eventQuestions.map((question) => <fieldset key={question.id} disabled={!canVote} style={{ border: 0, padding: 0, margin: '1.25rem 0' }}><legend><strong>{question.title}</strong>{question.required ? ' *' : ''}</legend>{question.description && <p className="muted">{question.description}</p>}{(optionsByQuestion.get(question.id) || []).map((option) => <label key={option.id} style={{ display: 'block', margin: '.5rem 0' }}><input type="radio" name={`question-${question.id}`} value={option.id} checked={String(answers[question.id] || '') === String(option.id)} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))} /> {option.label}</label>)}</fieldset>)}
        {canVote && <button type="button" onClick={() => submitBallot(vote.id)}>{existingBallot ? 'Update vote' : 'Submit vote'}</button>}
        {isAdmin && vote.status === 'draft' && <button type="button" className="secondary" onClick={() => openEvent(vote.id)}>Open vote</button>}
        {isAdmin && vote.status === 'open' && !deadlinePassed && <button type="button" className="secondary" onClick={() => closeEvent(vote.id)}>Close vote now</button>}
        {canFinalise && <button type="button" className="secondary" onClick={() => finaliseEvent(vote)}>{vote.event_type === 'awards' ? 'Finalise Awards categories' : 'Finalise result'}</button>}
        {canRelease && <button type="button" className="secondary" onClick={() => releaseResults(vote.id)}>Release results</button>}
        {resultsAvailable && <button type="button" className="secondary" onClick={() => loadResults(vote.id)}>Show vote totals</button>}
        {finalResult && <div style={{ marginTop: '1rem' }}><h3>Official result</h3><p><strong>{finalResult.decision_summary}</strong></p><p className="muted">Turnout: {finalResult.ballots_cast}/{finalResult.electorate_count} ({finalResult.turnout_percent}%) · Quorum {finalResult.quorum_met ? 'met' : 'not met'}</p>{vote.results_visibility === 'manual_release' && <p className="muted">Results: {vote.results_released_at ? `released ${formatDate(vote.results_released_at)}` : 'awaiting manual release'}</p>}</div>}
        {resultRows.length > 0 && <div style={{ marginTop: '1rem' }}>{resultRows.map((row) => <div key={`${row.question_id}-${row.option_id}`}>{row.question_title}: {row.option_label} — <strong>{row.votes}</strong></div>)}</div>}
      </section>;
    })}
  </main>;
}
