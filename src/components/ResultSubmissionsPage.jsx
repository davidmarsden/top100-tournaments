import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

function managerName(manager) {
  return manager?.display_name || manager?.name || 'Manager';
}

function scoreFor(row, scores) {
  return scores[row.id] || {
    home: row.submitted_home_score,
    away: row.submitted_away_score,
  };
}

export default function ResultSubmissionsPage() {
  const [rows, setRows] = useState([]);
  const [scores, setScores] = useState({});
  const [notes, setNotes] = useState({});
  const [status, setStatus] = useState('Loading result submissions...');
  const [loadingId, setLoadingId] = useState(null);
  const [filter, setFilter] = useState('open');

  useEffect(() => { loadRows(); }, []);

  const openRows = useMemo(
    () => rows.filter((row) => ['pending_confirmation', 'disputed'].includes(row.status)),
    [rows],
  );
  const history = useMemo(
    () => rows.filter((row) => !['pending_confirmation', 'disputed'].includes(row.status)),
    [rows],
  );
  const visibleRows = filter === 'open' ? openRows : history;

  async function loadRows() {
    setStatus('Loading result submissions...');
    const { data, error } = await supabase
      .from('manager_result_submissions')
      .select('*, matches(id, home_placeholder, away_placeholder, round, fixture_date, status, tournaments(name)), submitter:managers!manager_result_submissions_submitted_by_manager_id_fkey(name, display_name), opponent:managers!manager_result_submissions_opponent_manager_id_fkey(name, display_name)')
      .order('created_at', { ascending: false });

    if (error) setStatus('Could not load submissions: ' + error.message);
    else {
      setRows(data || []);
      const pending = (data || []).filter((row) => ['pending_confirmation', 'disputed'].includes(row.status)).length;
      setStatus(pending ? `${pending} result${pending === 1 ? '' : 's'} awaiting attention.` : 'No manager results need attention.');
    }
  }

  async function approve(row, useSubmittedScore = false) {
    const value = useSubmittedScore
      ? { home: row.submitted_home_score, away: row.submitted_away_score }
      : scoreFor(row, scores);
    const home = Number(value.home);
    const away = Number(value.away);
    if (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0) {
      setStatus('Enter a valid home and away score.');
      return;
    }

    const homeTeam = row.matches?.home_placeholder || 'Home';
    const awayTeam = row.matches?.away_placeholder || 'Away';
    if (!window.confirm(`Approve ${homeTeam} ${home}–${away} ${awayTeam} as the official result?`)) return;

    setLoadingId(row.id);
    const { error } = await supabase.rpc('resolve_manager_result', {
      target_submission_id: row.id,
      target_home_score: home,
      target_away_score: away,
      note: notes[row.id] || (useSubmittedScore ? 'Approved as submitted.' : 'Approved by administrator.'),
    });
    if (error) setStatus('Approval failed: ' + error.message);
    else {
      setStatus('Official result saved. Tables and knockout records will use the approved score.');
      await loadRows();
    }
    setLoadingId(null);
  }

  async function reject(row) {
    const reason = (notes[row.id] || '').trim();
    if (!reason) {
      setStatus('Add a short reason before rejecting a result.');
      return;
    }
    if (!window.confirm('Reject this result submission without changing the official match?')) return;

    setLoadingId(row.id);
    const { error } = await supabase.rpc('reject_manager_result', {
      target_submission_id: row.id,
      note: reason,
    });
    if (error) setStatus('Rejection failed: ' + error.message);
    else {
      setStatus('Submission rejected. The fixture remains outstanding and can be submitted again.');
      await loadRows();
    }
    setLoadingId(null);
  }

  return <main className="app-shell">
    <section className="hero">
      <div className="hero-row">
        <div>
          <p className="eyebrow">Top 100 Tournament Manager</p>
          <h1>Result approvals</h1>
          <p>Approve manager-submitted scores, correct them where necessary, or reject invalid submissions.</p>
        </div>
        <div className="button-row">
          <a className="button secondary" href="/admin">Tournament admin</a>
          <a className="button secondary" href="/admin/manager-accounts">Manager accounts</a>
        </div>
      </div>
    </section>

    <section className="card module-card">
      <div className="card-header row">
        <div>
          <p className="eyebrow">Admin queue</p>
          <h2>{filter === 'open' ? `Awaiting attention (${openRows.length})` : `Approval history (${history.length})`}</h2>
        </div>
        <div className="button-row">
          <button type="button" className={filter === 'open' ? '' : 'secondary'} onClick={() => setFilter('open')}>Open</button>
          <button type="button" className={filter === 'history' ? '' : 'secondary'} onClick={() => setFilter('history')}>History</button>
          <button type="button" className="secondary" onClick={loadRows} disabled={loadingId !== null}>Refresh</button>
        </div>
      </div>
      <p className="status">{status}</p>

      {!visibleRows.length && <p className="muted">{filter === 'open' ? 'No manager results need attention.' : 'No completed submissions yet.'}</p>}

      <div className="entrant-list">
        {visibleRows.map((row) => {
          const value = scoreFor(row, scores);
          const isOpen = ['pending_confirmation', 'disputed'].includes(row.status);
          const disabled = loadingId === row.id;
          return <article className="entrant-row registration-row" key={row.id}>
            <div className="registration-details">
              <strong>{row.matches?.home_placeholder} {row.submitted_home_score}–{row.submitted_away_score} {row.matches?.away_placeholder}</strong>
              <span>{row.matches?.tournaments?.name || 'Tournament'} · {row.matches?.round || 'Fixture'} · {row.matches?.fixture_date || 'Date TBC'}</span>
              <span>Submitted by {managerName(row.submitter)} · Opponent: {managerName(row.opponent)}</span>
              <span className={`status-pill status-${row.status}`}>{row.status.replaceAll('_', ' ')}</span>
              {row.opponent_response_note && <span><strong>Opponent note:</strong> {row.opponent_response_note}</span>}
              {row.resolution_note && <span><strong>Admin note:</strong> {row.resolution_note}</span>}

              {isOpen && <div className="mini-grid">
                <label>Official home score
                  <input type="number" min="0" value={value.home} onChange={(event) => setScores((current) => ({ ...current, [row.id]: { ...value, home: event.target.value } }))} />
                </label>
                <label>Official away score
                  <input type="number" min="0" value={value.away} onChange={(event) => setScores((current) => ({ ...current, [row.id]: { ...value, away: event.target.value } }))} />
                </label>
                <label>Admin note / rejection reason
                  <input value={notes[row.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} placeholder="Optional for approval; required for rejection" />
                </label>
              </div>}
            </div>

            {isOpen && <div className="button-row">
              <button type="button" onClick={() => approve(row, true)} disabled={disabled}>Approve submitted score</button>
              <button type="button" className="secondary" onClick={() => approve(row, false)} disabled={disabled}>Save corrected score</button>
              <button type="button" className="danger" onClick={() => reject(row)} disabled={disabled}>Reject</button>
            </div>}
          </article>;
        })}
      </div>
    </section>
  </main>;
}
