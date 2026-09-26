import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function PublicOpenPolls() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setLoading(false); return; }
    supabase.rpc('get_public_community_polls').then(({ data, error }) => {
      if (error) setMessage(error.message); else setRows(data || []);
      setLoading(false);
    });
  }, []);

  const events = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      if (!map.has(row.event_id)) map.set(row.event_id, { ...row, questions: new Map() });
      const event = map.get(row.event_id);
      if (!event.questions.has(row.question_id)) event.questions.set(row.question_id, { id: row.question_id, title: row.question_title, options: [] });
      event.questions.get(row.question_id).options.push({ id: row.option_id, label: row.option_label, votes: row.votes == null ? null : Number(row.votes) });
    });
    return [...map.values()];
  }, [rows]);

  return <main className="manager-portal-shell">
    <section className="manager-portal-hero"><div><p className="eyebrow">Top 100</p><h1>Community Polls</h1><p>See what Top 100 managers are voting on. Polls are public to read; voting is for verified manager accounts.</p></div></section>
    {loading && <section className="card"><h2>Loading polls…</h2></section>}
    {!loading && message && <section className="warning-card"><strong>Polls unavailable.</strong><span>{message}</span></section>}
    {!loading && !message && events.length === 0 && <section className="card"><h2>No open polls</h2><p>There are no Community Polls open for voting at the moment.</p><a className="button" href="/">See previous results</a></section>}
    {!loading && events.map((event) => <section className="card" key={event.event_id}>
      <p className="eyebrow">Open Community Poll</p><h2>{event.event_title}</h2>
      {event.event_description && <p>{event.event_description}</p>}
      <p className="muted">Voting closes: {formatDate(event.closes_at) || 'No closing date set'} · {event.ballots_cast}/{event.electorate_count} eligible managers have voted</p>
      {[...event.questions.values()].map((question) => <div key={question.id} style={{ marginTop: '1rem' }}><h3>{question.title}</h3>
        {event.results_visibility === 'live' ? <ul>{question.options.map((option) => <li key={option.id}>{option.label}: <strong>{option.votes}</strong></li>)}</ul> : <p className="muted">Results will be shown according to this poll's result settings.</p>}
      </div>)}
      <div className="button-row" style={{ marginTop: '1rem' }}><a className="button" href="/vote">Sign in and vote</a><a className="button secondary" href="https://manager.smtop100.blog/registrations">Create a manager account</a></div>
      <p className="muted">Already manage a Top 100 club but don't have an account yet? Create one to cast your vote.</p>
    </section>)}
    <section className="card"><h2>Previous polls</h2><p>Completed polls and their published results stay in the archive.</p><a className="button secondary" href="/">View poll results</a></section>
  </main>;
}
