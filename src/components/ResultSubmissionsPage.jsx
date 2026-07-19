import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

function managerName(manager) {
  return manager?.display_name || manager?.name || 'Manager';
}

function matchTeamName(match, side) {
  const entry = side === 'home' ? match?.home_entry : match?.away_entry;
  const placeholder = side === 'home' ? match?.home_placeholder : match?.away_placeholder;
  return entry?.teams?.name || placeholder || (side === 'home' ? 'Home' : 'Away');
}

function scoreFor(row, scores) {
  return scores[row.id] || {
    home: row.matches?.home_score ?? row.resolved_home_score ?? row.submitted_home_score,
    away: row.matches?.away_score ?? row.resolved_away_score ?? row.submitted_away_score,
  };
}

function rulingFor(row, rulings) {
  if (rulings[row.id]) return rulings[row.id];
  if (row.matches?.status === 'voided') return 'voided';
  if (row.matches?.status === 'forfeit') {
    const home = row.matches?.home_score ?? row.resolved_home_score;
    const away = row.matches?.away_score ?? row.resolved_away_score;
    return Number(home) > Number(away) ? 'home_forfeit_win' : 'away_forfeit_win';
  }
  return 'played';
}

function rulingLabel(ruling) {
  switch (ruling) {
    case 'home_forfeit_win': return 'Away team forfeited — home win';
    case 'away_forfeit_win': return 'Home team forfeited — away win';
    case 'voided': return 'Void match';
    default: return 'Played normally';
  }
}

function validateForfeitScore(ruling, home, away) {
  if (ruling === 'home_forfeit_win') {
    if (home <= away) return 'The home team must be shown as the winner when the away team forfeits.';
    if (home - away < 3) return 'A forfeit result must give the home team at least a three-goal advantage. Keep a better played score such as 5–0, or use at least 3–0.';
  }
  if (ruling === 'away_forfeit_win') {
    if (away <= home) return 'The away team must be shown as the winner when the home team forfeits.';
    if (away - home < 3) return 'A forfeit result must give the away team at least a three-goal advantage. Keep a better played score, or use at least 0–3.';
  }
  return null;
}

const OPEN_STATUSES = ['pending_confirmation', 'disputed', 'pending_admin_check', 'opponent_confirmed', 'appealed'];

export default function ResultSubmissionsPage() {
  const [rows, setRows] = useState([]);
  const [scores, setScores] = useState({});
  const [notes, setNotes] = useState({});
  const [rulings, setRulings] = useState({});
  const [status, setStatus] = useState('Loading result submissions...');
  const [loadingId, setLoadingId] = useState(null);
  const [filter, setFilter] = useState('open');

  useEffect(() => { loadRows(); }, []);

  const openRows = useMemo(() => rows.filter((row) => OPEN_STATUSES.includes(row.status)), [rows]);
  const history = useMemo(() => rows.filter((row) => !OPEN_STATUSES.includes(row.status)), [rows]);
  const visibleRows = filter === 'open' ? openRows : history;

  async function loadRows() {
    setStatus('Loading result submissions...');
    const { data, error } = await supabase
      .from('manager_result_submissions')
      .select('*, matches(id, home_placeholder, away_placeholder, home_score, away_score, round, fixture_date, status, tournaments(name), home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(id, name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(id, name))), submitter:managers!manager_result_submissions_submitted_by_manager_id_fkey(name, display_name), opponent:managers!manager_result_submissions_opponent_manager_id_fkey(name, display_name)')
      .order('created_at', { ascending: false });

    if (error) setStatus('Could not load submissions: ' + error.message);
    else {
      setRows(data || []);
      const pending = (data || []).filter((row) => OPEN_STATUSES.includes(row.status)).length;
      setStatus(pending ? `${pending} provisional result${pending === 1 ? '' : 's'} awaiting a final check.` : 'No provisional results need attention.');
    }
  }

  async function approve(row) {
    const ruling = rulingFor(row, rulings);
    const value = scoreFor(row, scores);
    const home = ruling === 'voided' ? null : Number(value.home);
    const away = ruling === 'voided' ? null : Number(value.away);

    if (ruling !== 'voided' && (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0)) {
      return setStatus('Enter a valid home and away score.');
    }
    const forfeitError = validateForfeitScore(ruling, home, away);
    if (forfeitError) return setStatus(forfeitError);

    const homeTeam = matchTeamName(row.matches, 'home');
    const awayTeam = matchTeamName(row.matches, 'away');
    const scoreLine = ruling === 'voided' ? `${homeTeam} vs ${awayTeam}` : `${homeTeam} ${home}–${away} ${awayTeam}`;
    const confirmation = `Approve the official result as:\n\n${scoreLine}\nRuling: ${rulingLabel(ruling)}?`;
    if (!window.confirm(confirmation)) return;

    const defaultNote = ruling === 'played'
      ? 'Final check completed.'
      : ruling === 'voided'
        ? 'Match voided during final check.'
        : `${rulingLabel(ruling)} confirmed during final check.`;
    const note = (notes[row.id] || '').trim() || defaultNote;

    setLoadingId(row.id);
    let error;
    if (ruling === 'played') {
      ({ error } = await supabase.rpc('resolve_manager_result', {
        target_submission_id: row.id,
        target_home_score: home,
        target_away_score: away,
        note,
      }));
    } else {
      ({ error } = await supabase.rpc('admin_amend_match_result', {
        target_match_id: row.match_id,
        target_home_score: home,
        target_away_score: away,
        target_status: ruling === 'voided' ? 'voided' : 'forfeit',
        note,
      }));
    }
    if (error) setStatus('Final check failed: ' + error.message);
    else {
      setStatus(`Official result approved as ${rulingLabel(ruling).toLowerCase()}. It remains amendable by an administrator.`);
      await loadRows();
    }
    setLoadingId(null);
  }

  async function amend(row) {
    const ruling = rulingFor(row, rulings);
    const value = scoreFor(row, scores);
    const reason = (notes[row.id] || '').trim();
    if (!reason) return setStatus('Add a reason for the retrospective amendment.');
    const home = ruling === 'voided' ? null : Number(value.home);
    const away = ruling === 'voided' ? null : Number(value.away);
    if (ruling !== 'voided' && (!Number.isInteger(home) || !Number.isInteger(away) || home < 0 || away < 0)) return setStatus('Enter valid scores for the amended result.');
    const forfeitError = validateForfeitScore(ruling, home, away);
    if (forfeitError) return setStatus(forfeitError);
    const homeTeam = matchTeamName(row.matches, 'home');
    const awayTeam = matchTeamName(row.matches, 'away');
    const scoreLine = ruling === 'voided' ? `${homeTeam} vs ${awayTeam}` : `${homeTeam} ${home}–${away} ${awayTeam}`;
    if (!window.confirm(`Apply “${rulingLabel(ruling)}” as:\n\n${scoreLine}?`)) return;

    setLoadingId(row.id);
    const { error } = await supabase.rpc('admin_amend_match_result', {
      target_match_id: row.match_id,
      target_home_score: home,
      target_away_score: away,
      target_status: ruling === 'voided' ? 'voided' : ruling === 'played' ? 'played' : 'forfeit',
      note: reason,
    });
    if (error) setStatus('Amendment failed: ' + error.message);
    else {
      setStatus('Official result amended and recorded in the permanent revision audit. Tables and knockout data now use the new ruling.');
      await loadRows();
    }
    setLoadingId(null);
  }

  async function reject(row) {
    const reason = (notes[row.id] || '').trim();
    if (!reason) return setStatus('Add a short reason before rejecting a result.');
    if (!window.confirm('Reject this provisional result and return the fixture to outstanding?')) return;

    setLoadingId(row.id);
    const { error } = await supabase.rpc('reject_manager_result', { target_submission_id: row.id, note: reason });
    if (error) setStatus('Rejection failed: ' + error.message);
    else {
      setStatus('Submission rejected. The fixture is available for a replacement submission.');
      await loadRows();
    }
    setLoadingId(null);
  }

  return <main className="app-shell">
    <section className="hero"><div className="hero-row"><div><p className="eyebrow">Top 100 Tournament Manager</p><h1>Result checks and revisions</h1><p>Manager results are published provisionally. Complete final checks, resolve appeals, and amend any result later when disciplinary or eligibility issues emerge.</p></div><div className="button-row"><a className="button secondary" href="/admin">Tournament admin</a><a className="button secondary" href="/admin/manager-accounts">Manager accounts</a></div></div></section>

    <section className="card module-card">
      <div className="card-header row"><div><p className="eyebrow">Admin queue</p><h2>{filter === 'open' ? `Final checks and appeals (${openRows.length})` : `Finalised results (${history.length})`}</h2></div><div className="button-row"><button type="button" className={filter === 'open' ? '' : 'secondary'} onClick={() => setFilter('open')}>Needs checking</button><button type="button" className={filter === 'history' ? '' : 'secondary'} onClick={() => setFilter('history')}>Finalised</button><button type="button" className="secondary" onClick={loadRows} disabled={loadingId !== null}>Refresh</button></div></div>
      <p className="status">{status}</p>
      {!visibleRows.length && <p className="muted">{filter === 'open' ? 'No provisional results need attention.' : 'No finalised manager submissions yet.'}</p>}

      <div className="entrant-list">{visibleRows.map((row) => {
        const value = scoreFor(row, scores);
        const isOpen = OPEN_STATUSES.includes(row.status);
        const disabled = loadingId === row.id;
        const ruling = rulingFor(row, rulings);
        const displayedHomeScore = row.matches?.home_score ?? row.resolved_home_score ?? row.submitted_home_score;
        const displayedAwayScore = row.matches?.away_score ?? row.resolved_away_score ?? row.submitted_away_score;
        const homeTeam = matchTeamName(row.matches, 'home');
        const awayTeam = matchTeamName(row.matches, 'away');

        return <article className="entrant-row registration-row" key={row.id}>
          <div className="registration-details">
            <strong>{homeTeam} {displayedHomeScore ?? '–'}–{displayedAwayScore ?? '–'} {awayTeam}</strong>
            <span>{row.matches?.tournaments?.name || 'Tournament'} · {row.matches?.round || 'Fixture'} · {row.matches?.fixture_date || 'Date TBC'}</span>
            <span>Submitted by {managerName(row.submitter)} · Opponent: {managerName(row.opponent)}</span>
            <span className={`status-pill status-${row.status}`}>{row.status.replaceAll('_', ' ')}</span>
            {row.status === 'appealed' && <span><strong>Appeal:</strong> {row.opponent_response_note}</span>}
            {row.opponent_response_note && row.status !== 'appealed' && <span><strong>Opponent note:</strong> {row.opponent_response_note}</span>}
            {row.resolution_note && <span><strong>Admin note:</strong> {row.resolution_note}</span>}

            <div className="mini-grid">
              <label>Official home score<input type="number" min="0" disabled={ruling === 'voided'} value={ruling === 'voided' ? '' : value.home ?? ''} onChange={(event) => setScores((current) => ({ ...current, [row.id]: { ...value, home: event.target.value } }))} /></label>
              <label>Official away score<input type="number" min="0" disabled={ruling === 'voided'} value={ruling === 'voided' ? '' : value.away ?? ''} onChange={(event) => setScores((current) => ({ ...current, [row.id]: { ...value, away: event.target.value } }))} /></label>
              <label>Official ruling<select value={ruling} onChange={(event) => setRulings((current) => ({ ...current, [row.id]: event.target.value }))}><option value="played">Played normally</option><option value="home_forfeit_win">Away team forfeited — home win</option><option value="away_forfeit_win">Home team forfeited — away win</option><option value="voided">Void match</option></select></label>
              <label>{isOpen ? 'Final-check note / rejection reason' : 'Reason for amendment'}<input value={notes[row.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))} placeholder={isOpen ? 'Optional for approval; required for rejection' : 'Required — e.g. ineligible player'} /></label>
            </div>
            {isOpen && <p className="muted">Edit the score and select the ruling together. If the non-forfeiting team already won by three or more goals, keep that better scoreline — for example, record a played 5–0 as 5–0 with “Away team forfeited — home win”.</p>}
          </div>

          {isOpen ? <div className="button-row"><button type="button" onClick={() => approve(row)} disabled={disabled}>Approve official result</button><button type="button" className="danger" onClick={() => reject(row)} disabled={disabled}>Reject submission</button></div> : <div className="button-row"><button type="button" className="secondary" onClick={() => amend(row)} disabled={disabled}>Amend official result</button></div>}
        </article>;
      })}</div>
    </section>
  </main>;
}
