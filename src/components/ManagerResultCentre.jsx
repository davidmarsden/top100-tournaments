import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function ManagerResultCentre({ selectedEntry, fixtures, onResultChanged }) {
  const [submissions, setSubmissions] = useState([]);
  const [scores, setScores] = useState({});
  const [notes, setNotes] = useState({});
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const fixtureIds = useMemo(() => fixtures.map((fixture) => fixture.id), [fixtures]);
  const activeSubmissions = useMemo(
    () => submissions.filter((submission) => submission.status !== 'withdrawn'),
    [submissions],
  );
  const byMatch = useMemo(
    () => new Map(activeSubmissions.map((submission) => [submission.match_id, submission])),
    [activeSubmissions],
  );

  useEffect(() => { loadSubmissions(); }, [fixtureIds.join(',')]);

  async function loadSubmissions() {
    if (!fixtureIds.length) { setSubmissions([]); return; }
    const { data, error } = await supabase.from('manager_result_submissions').select('*').in('match_id', fixtureIds);
    if (error) setStatus('Could not load submitted results: ' + error.message);
    else setSubmissions(data || []);
  }

  async function submitResult(fixture) {
    const score = scores[fixture.id] || {};
    const mine = Number(score.mine), theirs = Number(score.theirs);
    if (!Number.isInteger(mine) || !Number.isInteger(theirs) || mine < 0 || theirs < 0) return setStatus('Enter both scores as whole numbers.');
    const isHome = fixture.home_entry_id === selectedEntry.id;
    const homeScore = isHome ? mine : theirs;
    const awayScore = isHome ? theirs : mine;
    if (!window.confirm(`Submit ${fixture.home_placeholder} ${homeScore}–${awayScore} ${fixture.away_placeholder}?`)) return;
    setLoading(true);
    const { error } = await supabase.rpc('submit_manager_result', { target_match_id: fixture.id, target_home_score: homeScore, target_away_score: awayScore });
    if (error) setStatus('Could not submit result: ' + error.message);
    else { setStatus('Result submitted to the opposing manager for confirmation.'); await loadSubmissions(); }
    setLoading(false);
  }

  async function respond(submission, response) {
    const note = notes[submission.id] || null;
    if (response === 'dispute' && !note) return setStatus('Add a short note explaining the disputed score.');
    setLoading(true);
    const { error } = await supabase.rpc('respond_to_manager_result', { target_submission_id: submission.id, response, note });
    if (error) setStatus('Could not record response: ' + error.message);
    else {
      setStatus(response === 'confirm' ? 'Result confirmed and added to the tournament.' : 'Result disputed and sent to the administrator.');
      await loadSubmissions();
      await onResultChanged?.();
    }
    setLoading(false);
  }

  if (!fixtures.length) return null;

  return <section className="card portal-panel result-centre">
    <div className="card-header"><p className="eyebrow">V3.2 result centre</p><h2>Submit and confirm results</h2><p className="muted">A submitted score becomes official only after the opposing manager confirms it, or an administrator resolves a dispute.</p></div>
    {status && <p className="status">{status}</p>}
    <div className="portal-fixtures">{fixtures.map((fixture) => {
      const submission = byMatch.get(fixture.id);
      const isHome = fixture.home_entry_id === selectedEntry.id;
      const opponent = isHome ? fixture.away_placeholder : fixture.home_placeholder;
      const mineSubmitted = submission ? (isHome ? submission.submitted_home_score : submission.submitted_away_score) : null;
      const theirsSubmitted = submission ? (isHome ? submission.submitted_away_score : submission.submitted_home_score) : null;
      const isOpponent = submission?.opponent_manager_id === selectedEntry.manager_id;

      return <article className="result-submission-card" key={fixture.id}>
        <div><strong>{isHome ? 'Home' : 'Away'} vs {opponent}</strong><span>{fixture.round} · {fixture.fixture_date || 'Date TBC'}</span></div>
        {!submission && <div className="result-score-form"><label>Your score<input type="number" min="0" value={scores[fixture.id]?.mine ?? ''} onChange={(event) => setScores((current) => ({ ...current, [fixture.id]: { ...current[fixture.id], mine: event.target.value } }))} /></label><label>{opponent}<input type="number" min="0" value={scores[fixture.id]?.theirs ?? ''} onChange={(event) => setScores((current) => ({ ...current, [fixture.id]: { ...current[fixture.id], theirs: event.target.value } }))} /></label><button type="button" onClick={() => submitResult(fixture)} disabled={loading}>Submit score</button></div>}
        {submission && <div className="result-submission-status"><strong>{mineSubmitted}–{theirsSubmitted}</strong><span className={`status-pill status-${submission.status}`}>{submission.status.replaceAll('_', ' ')}</span></div>}
        {submission?.status === 'pending_confirmation' && isOpponent && <div className="result-response"><label>Dispute note<input value={notes[submission.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [submission.id]: event.target.value }))} placeholder="Only needed if disputing" /></label><div className="button-row"><button type="button" onClick={() => respond(submission, 'confirm')} disabled={loading}>Confirm result</button><button type="button" className="danger" onClick={() => respond(submission, 'dispute')} disabled={loading}>Dispute</button></div></div>}
        {submission?.status === 'pending_confirmation' && !isOpponent && <p className="muted">Waiting for the opposing manager to confirm.</p>}
        {submission?.status === 'disputed' && <p className="muted">Disputed: {submission.opponent_response_note || 'Awaiting administrator review.'}</p>}
      </article>;
    })}</div>
  </section>;
}
