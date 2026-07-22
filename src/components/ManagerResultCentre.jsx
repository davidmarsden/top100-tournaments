import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const OPEN_STATUSES = ['pending_admin_check', 'opponent_confirmed', 'appealed'];
const TERMINAL_MATCH_STATUSES = ['played', 'forfeit', 'voided'];

function entryTeamName(entry, fallback = 'TBC') {
  return entry?.teams?.name || fallback || 'TBC';
}

function opponentName(fixture, selectedEntryId) {
  const isHome = fixture.home_entry_id === selectedEntryId;
  return isHome
    ? entryTeamName(fixture.away_entry, fixture.away_placeholder)
    : entryTeamName(fixture.home_entry, fixture.home_placeholder);
}

export default function ManagerResultCentre({ selectedEntry, fixtures, onResultChanged }) {
  const [submissions, setSubmissions] = useState([]);
  const [scores, setScores] = useState({});
  const [notes, setNotes] = useState({});
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const activeSubmissions = useMemo(
    () => submissions.filter((submission) => submission.status !== 'withdrawn'),
    [submissions],
  );
  const byMatch = useMemo(
    () => new Map(activeSubmissions.map((submission) => [submission.match_id, submission])),
    [activeSubmissions],
  );
  const visibleFixtures = useMemo(() => {
    const rows = new Map(fixtures.map((fixture) => [fixture.id, fixture]));
    activeSubmissions.forEach((submission) => {
      if (submission.matches?.tournament_id === selectedEntry.tournament_id) {
        rows.set(submission.match_id, submission.matches);
      }
    });
    return [...rows.values()].sort((a, b) => String(a.fixture_date || '9999').localeCompare(String(b.fixture_date || '9999')) || Number(a.match_order || 0) - Number(b.match_order || 0));
  }, [fixtures, activeSubmissions, selectedEntry.tournament_id]);

  useEffect(() => { loadSubmissions(); }, [selectedEntry.manager_id, selectedEntry.tournament_id]);

  async function loadSubmissions() {
    const { data, error } = await supabase
      .from('manager_result_submissions')
      .select('*, matches(id, tournament_id, round, fixture_date, match_order, status, home_entry_id, away_entry_id, home_placeholder, away_placeholder, home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(name)))')
      .or(`submitted_by_manager_id.eq.${selectedEntry.manager_id},opponent_manager_id.eq.${selectedEntry.manager_id}`)
      .in('status', [...OPEN_STATUSES, 'final']);
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
    const homeName = entryTeamName(fixture.home_entry, fixture.home_placeholder);
    const awayName = entryTeamName(fixture.away_entry, fixture.away_placeholder);
    if (!window.confirm(`Publish ${homeName} ${homeScore}–${awayScore} ${awayName} provisionally?`)) return;
    setLoading(true);
    const { error } = await supabase.rpc('submit_manager_result', { target_match_id: fixture.id, target_home_score: homeScore, target_away_score: awayScore });
    if (error) setStatus('Could not submit result: ' + error.message);
    else {
      setStatus('Result published provisionally. The table is updated, with admin final checks and an opponent appeal still available.');
      await loadSubmissions();
      await onResultChanged?.();
    }
    setLoading(false);
  }

  async function respond(submission, response) {
    const note = notes[submission.id] || null;
    if (response === 'appeal' && !note?.trim()) return setStatus('Add a short reason for the appeal.');
    setLoading(true);
    const { error } = await supabase.rpc('respond_to_manager_result', { target_submission_id: submission.id, response, note });
    if (error) setStatus('Could not record response: ' + error.message);
    else {
      setStatus(response === 'confirm' ? 'Result acknowledged. It remains pending the administrator’s final check.' : 'Appeal submitted for urgent administrator review.');
      await loadSubmissions();
    }
    setLoading(false);
  }

  if (!visibleFixtures.length) return null;

  return <section className="card portal-panel result-centre">
    <div className="card-header"><p className="eyebrow">Result centre</p><h2>Submit results and raise appeals</h2><p className="muted">A submitted score is published immediately and updates the tournament provisionally. The opposing manager may appeal, and an administrator completes the final check.</p></div>
    {status && <p className="status">{status}</p>}
    <div className="portal-fixtures">{visibleFixtures.map((fixture) => {
      const submission = byMatch.get(fixture.id);
      const isHome = fixture.home_entry_id === selectedEntry.id;
      const opponent = opponentName(fixture, selectedEntry.id);
      const mineSubmitted = submission ? (isHome ? submission.submitted_home_score : submission.submitted_away_score) : null;
      const theirsSubmitted = submission ? (isHome ? submission.submitted_away_score : submission.submitted_home_score) : null;
      const isOpponent = submission?.opponent_manager_id === selectedEntry.manager_id;
      const canRespond = isOpponent && OPEN_STATUSES.includes(submission?.status);
      const canSubmit = !submission && !TERMINAL_MATCH_STATUSES.includes(fixture.status);

      return <article className="result-submission-card" key={fixture.id}>
        <div><strong>{isHome ? 'Home' : 'Away'} vs {opponent}</strong><span>{fixture.round} · {fixture.fixture_date || 'Date TBC'}</span></div>
        {canSubmit && <div className="result-score-form"><label>Your score<input type="number" min="0" value={scores[fixture.id]?.mine ?? ''} onChange={(event) => setScores((current) => ({ ...current, [fixture.id]: { ...current[fixture.id], mine: event.target.value } }))} /></label><label>{opponent}<input type="number" min="0" value={scores[fixture.id]?.theirs ?? ''} onChange={(event) => setScores((current) => ({ ...current, [fixture.id]: { ...current[fixture.id], theirs: event.target.value } }))} /></label><button type="button" onClick={() => submitResult(fixture)} disabled={loading}>Publish result</button></div>}
        {submission && <div className="result-submission-status"><strong>{mineSubmitted}–{theirsSubmitted}</strong><span className={`status-pill status-${submission.status}`}>{submission.status.replaceAll('_', ' ')}</span></div>}
        {canRespond && <div className="result-response"><label>Appeal reason<input value={notes[submission.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [submission.id]: event.target.value }))} placeholder="Required only if appealing" /></label><div className="button-row"><button type="button" onClick={() => respond(submission, 'confirm')} disabled={loading}>Acknowledge result</button><button type="button" className="danger" onClick={() => respond(submission, 'appeal')} disabled={loading}>Report incorrect result</button></div></div>}
        {submission?.status === 'pending_admin_check' && !isOpponent && <p className="muted">Published provisionally and awaiting the administrator’s final check.</p>}
        {submission?.status === 'opponent_confirmed' && <p className="muted">Opponent acknowledged. Awaiting the administrator’s final check.</p>}
        {submission?.status === 'appealed' && <p className="muted">Appealed: {submission.opponent_response_note || 'Awaiting administrator review.'}</p>}
        {submission?.status === 'final' && <p className="muted">Finalised by the administrator. It can still be amended later if disciplinary or eligibility issues emerge.</p>}
      </article>;
    })}</div>
  </section>;
}
