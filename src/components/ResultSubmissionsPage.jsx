import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function ResultSubmissionsPage() {
  const [rows, setRows] = useState([]);
  const [scores, setScores] = useState({});
  const [notes, setNotes] = useState({});
  const [status, setStatus] = useState('Loading result submissions...');
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadRows(); }, []);

  async function loadRows() {
    setLoading(true);
    const { data, error } = await supabase.from('manager_result_submissions').select('*, matches(id, home_placeholder, away_placeholder, round, fixture_date, tournaments(name)), submitter:managers!manager_result_submissions_submitted_by_manager_id_fkey(name, display_name), opponent:managers!manager_result_submissions_opponent_manager_id_fkey(name, display_name)').order('created_at', { ascending: false });
    if (error) setStatus('Could not load submissions: ' + error.message);
    else { setRows(data || []); setStatus(`${data?.length || 0} result submissions loaded.`); }
    setLoading(false);
  }

  async function resolve(row) {
    const value = scores[row.id] || { home: row.submitted_home_score, away: row.submitted_away_score };
    const home = Number(value.home), away = Number(value.away);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) return setStatus('Enter a valid home and away score.');
    if (!window.confirm(`Resolve as ${row.matches?.home_placeholder} ${home}–${away} ${row.matches?.away_placeholder}?`)) return;
    setLoading(true);
    const { error } = await supabase.rpc('resolve_manager_result', { target_submission_id: row.id, target_home_score: home, target_away_score: away, note: notes[row.id] || null });
    if (error) setStatus('Resolution failed: ' + error.message);
    else { setStatus('Official result saved.'); await loadRows(); }
    setLoading(false);
  }

  const openRows = rows.filter((row) => ['pending_confirmation', 'disputed'].includes(row.status));
  const history = rows.filter((row) => !['pending_confirmation', 'disputed'].includes(row.status));

  return <main className="app-shell">
    <section className="hero"><div className="hero-row"><div><p className="eyebrow">Top 100 Tournament Manager</p><h1>Result submissions</h1><p>Review pending manager scores and resolve disputed results.</p></div><div className="button-row"><a className="button secondary" href="/admin">Tournament admin</a><a className="button secondary" href="/admin/manager-accounts">Manager accounts</a></div></div></section>
    <section className="card module-card"><div className="card-header row"><div><p className="eyebrow">Admin queue</p><h2>Open submissions</h2></div><button type="button" className="secondary" onClick={loadRows} disabled={loading}>Refresh</button></div><p className="status">{status}</p>
      {!openRows.length ? <p className="muted">No manager results need attention.</p> : <div className="entrant-list">{openRows.map((row) => <article className="entrant-row registration-row" key={row.id}><div className="registration-details"><strong>{row.matches?.home_placeholder} {row.submitted_home_score}–{row.submitted_away_score} {row.matches?.away_placeholder}</strong><span>{row.matches?.tournaments?.name} · {row.matches?.round} · {row.status.replaceAll('_', ' ')}</span><span>Submitted by {row.submitter?.display_name || row.submitter?.name || 'Manager'}{row.opponent_response_note ? ` · ${row.opponent_response_note}` : ''}</span><div className="mini-grid"><label>Home score<input type="number" min="0" value={scores[row.id]?.home ?? row.submitted_home_score} onChange={(event) => setScores((current) => ({ ...current, [row.id]: { ...current[row.id], home: event.target.value } }))} /></label><label>Away score<input type="number" min="0" value={scores[row.id]?.away ?? row.submitted_away_score} onChange={(event) => setScores((current) => ({ ...current, [row.id]: { ...current[row.id], away: event.target.value } }))} /></label><label>Resolution note<input value={notes[row.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} /></label></div></div><button type="button" onClick={() => resolve(row)} disabled={loading}>Resolve result</button></article>)}</div>}
    </section>
    <section className="card module-card"><p className="eyebrow">History</p><h2>Confirmed and resolved</h2>{!history.length ? <p className="muted">No completed submissions yet.</p> : <div className="entrant-list">{history.map((row) => <article className="entrant-row" key={row.id}><div><strong>{row.matches?.home_placeholder} {row.resolved_home_score ?? row.submitted_home_score}–{row.resolved_away_score ?? row.submitted_away_score} {row.matches?.away_placeholder}</strong><span>{row.status} · {row.matches?.tournaments?.name}</span></div></article>)}</div>}</section>
  </main>;
}
