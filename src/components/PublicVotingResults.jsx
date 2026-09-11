import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function formatDate(value) {
  if (!value) return null;
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function PublicVotingResults() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setLoading(false); return; }
    supabase.rpc('get_public_voting_results').then(({ data, error }) => {
      if (error) setMessage(error.message);
      else setRows(data || []);
      setLoading(false);
    });
  }, []);

  const events = useMemo(() => {
    const map = new Map();
    rows.forEach((row) => {
      if (!map.has(row.event_id)) {
        map.set(row.event_id, {
          ...row,
          questions: new Map(),
        });
      }
      const event = map.get(row.event_id);
      if (!event.questions.has(row.question_id)) {
        event.questions.set(row.question_id, {
          id: row.question_id,
          title: row.question_title,
          options: [],
        });
      }
      event.questions.get(row.question_id).options.push({
        id: row.option_id,
        label: row.option_label,
        votes: Number(row.votes || 0),
      });
    });
    return [...map.values()];
  }, [rows]);

  return <main className="manager-portal-shell">
    <section className="manager-portal-hero">
      <div>
        <p className="eyebrow">Top 100</p>
        <h1>Community Poll Results</h1>
        <p>Published results from Top 100 Community Polls. No sign-in required.</p>
      </div>
      <a className="button" href="/vote">Vote in Community Polls</a>
    </section>

    {loading && <section className="card"><h2>Loading results…</h2></section>}
    {!loading && message && <section className="warning-card"><strong>Results unavailable.</strong><span>{message}</span></section>}
    {!loading && !message && events.length === 0 && <section className="card"><h2>No published results yet</h2><p>Results will appear here after a Community Poll has closed and its official result is available.</p></section>}

    {!loading && events.map((event) => <section className="card" key={event.event_id}>
      <p className="eyebrow">{event.event_type === 'awards' ? 'Manager Awards' : 'Community Poll'}</p>
      <h2>{event.event_title}</h2>
      {event.event_description && <p>{event.event_description}</p>}
      <p className="muted">Closed: {formatDate(event.closes_at) || '—'} · Turnout: {event.ballots_cast}/{event.electorate_count} ({event.turnout_percent}%)</p>
      {event.decision_summary && <p><strong>{event.decision_summary}</strong></p>}
      {[...event.questions.values()].map((question) => <div key={question.id} style={{ marginTop: '1rem' }}>
        <h3>{question.title}</h3>
        <ul>
          {question.options.map((option) => <li key={option.id}>{option.label}: <strong>{option.votes}</strong></li>)}
        </ul>
      </div>)}
    </section>)}
  </main>;
}
