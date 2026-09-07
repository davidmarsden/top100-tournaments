import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function formatDate(value) {
  if (!value) return 'Not set';
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
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
    setAccount(accountResult.data || null);
    setIsAdmin(Boolean(adminResult.data));
    if (eventResult.error) { setMessage(eventResult.error.message); setLoading(false); return; }

    const eventRows = eventResult.data || [];
    setEvents(eventRows);
    const eventIds = eventRows.map((row) => row.id);
    if (!eventIds.length) { setQuestions([]); setOptions([]); setBallots([]); setResponses([]); setLoading(false); setMessage('No votes available.'); return; }

    const [questionResult, ballotResult] = await Promise.all([
      supabase.from('voting_questions').select('*').in('event_id', eventIds).order('sort_order').order('id'),
      supabase.from('voting_ballots').select('*').in('event_id', eventIds),
    ]);
    if (questionResult.error) { setMessage(questionResult.error.message); setLoading(false); return; }
    const questionRows = questionResult.data || [];
    setQuestions(questionRows);

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
    setMessage(accountResult.data ? 'Voting account verified.' : 'Your sign-in is valid, but you do not have an active manager account.');
    setLoading(false);
  }

  async function submitBallot(eventId) {
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
    setMessage(error ? error.message : 'Vote closed.');
    if (!error) await loadVoting();
  }

  async function loadResults(eventId) {
    const { data, error } = await supabase.rpc('get_voting_results', { target_event_id: eventId });
    if (error) return setMessage(error.message);
    setResults((current) => ({ ...current, [eventId]: data || [] }));
  }

  async function logout() { await supabase.auth.signOut(); setMessage('Signed out.'); }

  if (!hasSupabaseConfig || !supabase) return <main className="manager-portal-shell"><section className="warning-card"><strong>Voting unavailable.</strong><span>Supabase is not connected.</span></section></main>;

  if (!session) return <main className="manager-portal-shell"><section className="manager-portal-hero"><p className="eyebrow">Top 100</p><h1>Manager Voting</h1><p>Secure one-manager-one-vote polling using your existing Top 100 manager account.</p></section><section className="card manager-login-card"><h2>Sign in securely</h2><p className="muted">Use the same email address as your Manager Portal account.</p><form onSubmit={sendMagicLink}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><button type="submit" disabled={loading}>{loading ? 'Sending…' : 'Email me a sign-in link'}</button></form>{message && <p className="status">{message}</p>}</section></main>;

  return <main className="manager-portal-shell">
    <section className="manager-portal-hero"><div><p className="eyebrow">Top 100</p><h1>Manager Voting</h1><p>{account ? `Signed in as ${account.managers?.display_name || account.managers?.name || 'manager'}.` : `Signed in as ${session.user.email}.`}</p></div><button type="button" className="secondary" onClick={logout}>Sign out</button></section>
    {message && <p className="status">{message}</p>}
    {loading && <section className="card"><h2>Loading…</h2></section>}
    {!loading && !account && <section className="card"><h2>Manager account required</h2><p>Your email is authenticated, but it is not linked to an active Top 100 manager account. Use the Manager Portal to claim or restore your manager identity first.</p><a href="/manager">Go to Manager Portal</a></section>}
    {!loading && account && events.length === 0 && <section className="card"><h2>No votes available</h2><p>There are no voting events in your electorate at the moment.</p></section>}
    {!loading && account && events.map((vote) => {
      const eventQuestions = questionsByEvent.get(vote.id) || [];
      const existingBallot = ballots.find((ballot) => ballot.event_id === vote.id);
      const resultRows = results[vote.id] || [];
      const canVote = vote.status === 'open' && (!vote.opens_at || new Date(vote.opens_at) <= new Date()) && (!vote.closes_at || new Date(vote.closes_at) > new Date());
      return <section className="card" key={vote.id}>
        <p className="eyebrow">{vote.event_type === 'awards' ? 'Awards' : vote.event_type === 'test' ? 'System test' : 'Manager poll'} · {vote.status}</p>
        <h2>{vote.title}</h2>
        {vote.description && <p>{vote.description}</p>}
        <p className="muted">Opens: {formatDate(vote.opens_at)} · Closes: {formatDate(vote.closes_at)}</p>
        {existingBallot && <p><strong>Your ballot is saved.</strong> {canVote ? 'You may change it before the deadline.' : ''}</p>}
        {eventQuestions.map((question) => <fieldset key={question.id} disabled={!canVote} style={{ border: 0, padding: 0, margin: '1.25rem 0' }}><legend><strong>{question.title}</strong>{question.required ? ' *' : ''}</legend>{question.description && <p className="muted">{question.description}</p>}{(optionsByQuestion.get(question.id) || []).map((option) => <label key={option.id} style={{ display: 'block', margin: '.5rem 0' }}><input type="radio" name={`question-${question.id}`} value={option.id} checked={String(answers[question.id] || '') === String(option.id)} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option.id }))} /> {option.label}</label>)}</fieldset>)}
        {canVote && <button type="button" onClick={() => submitBallot(vote.id)}>{existingBallot ? 'Update vote' : 'Submit vote'}</button>}
        {isAdmin && vote.status === 'draft' && <button type="button" className="secondary" onClick={() => openEvent(vote.id)}>Open test vote</button>}
        {isAdmin && vote.status === 'open' && <button type="button" className="secondary" onClick={() => closeEvent(vote.id)}>Close vote now</button>}
        {(isAdmin || vote.results_visibility === 'live' || vote.status === 'closed') && <button type="button" className="secondary" onClick={() => loadResults(vote.id)}>Show results</button>}
        {resultRows.length > 0 && <div style={{ marginTop: '1rem' }}>{eventQuestions.map((question) => <div key={question.id}><h3>{question.title}</h3><ul>{resultRows.filter((row) => row.question_id === question.id).map((row) => <li key={row.option_id}>{row.option_label}: <strong>{row.votes}</strong></li>)}</ul></div>)}</div>}
      </section>;
    })}
  </main>;
}
