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

function managerRulingLabel(value) {
  if (value === 'opponent_forfeit') return 'Opponent forfeited';
  if (value === 'self_forfeit') return 'My team forfeited';
  return 'Played normally';
}

export default function ManagerResultCentre({ selectedEntry, fixtures, onResultChanged }) {
  const [submissions, setSubmissions] = useState([]);
  const [scores, setScores] = useState({});
  const [rulings, setRulings] = useState({});
  const [forfeitReasons, setForfeitReasons] = useState({});
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

  function changeRuling(fixture, value) {
    setRulings((current) => ({ ...current, [fixture.id]: value }));
    if (value === 'opponent_forfeit') {
      setScores((current) => ({ ...current, [fixture.id]: { mine: 3, theirs: 0 } }));
    } else if (value === 'self_forfeit') {
      setScores((current) => ({ ...current, [fixture.id]: { mine: 0, theirs: 3 } }));
    }
  }

  async function submitResult(fixture) {
    const score = scores[fixture.id] || {};
    const mine = Number(score.mine), theirs = Number(score.theirs);
    if (!Number.isInteger(mine) || !Number.isInteger(theirs) || mine < 0 || theirs < 0) return setStatus('Enter both scores as whole numbers.');

    const managerRuling = rulings[fixture.id] || 'played';
    const reason = (forfeitReasons[fixture.id] || '').trim();
    if (managerRuling !== 'played' && !reason) return setStatus('Add a short reason when reporting a forfeit.');
    if (managerRuling === 'opponent_forfeit' && (mine <= theirs || mine - theirs < 3)) return setStatus('An opponent forfeit must give your team at least a three-goal advantage. Keep a better played scoreline, or use 3–0.');
    if (managerRuling === 'self_forfeit' && (theirs <= mine || theirs - mine < 3)) return setStatus('A self-reported forfeit must give your opponent at least a three-goal advantage. Keep a better played scoreline, or use 0–3.');

    const isHome = fixture.home_entry_id === selectedEntry.id;
    const homeScore = isHome ? mine : theirs;
    const awayScore = isHome ? theirs : mine;
    const homeName = entryTeamName(fixture.home_entry, fixture.home_placeholder);
    const awayName = entryTeamName(fixture.away_entry, fixture.away_placeholder);
    const targetRuling = managerRuling === 'played'
      ? 'played'
      : managerRuling === 'opponent_forfeit'
        ? (isHome ? 'home_forfeit_win' : 'away_forfeit_win')
        : (isHome ? 'away_forfeit_win' : 'home_forfeit_win');
    const rulingText = managerRulingLabel(managerRuling);
    if (!window.confirm(`Publish ${homeName} ${homeScore}–${awayScore} ${awayName} provisionally?\n\nRuling: ${rulingText}${reason ? `\nReason: ${reason}` : ''}`)) return;

    setLoading(true);
    const { error } = await supabase.rpc('submit_manager_result_with_ruling', {
      target_match_id: fixture.id,
      target_home_score: homeScore,
      target_away_score: awayScore,
      target_ruling: targetRuling,
      target_reason: reason || null,
    });
    if (error) setStatus('Could not submit result: ' + error.message);
    else {
      setStatus(managerRuling === 'played'
        ? 'Result published provisionally. The table is updated, with admin final checks and an opponent appeal still available.'
        : 'Forfeit reported provisionally. The result is visible now but remains subject to the administrator’s final check and an opponent appeal.');
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
    <div className="card-header"><p className="eyebrow">Result centre</p><h2>Submit results, report forfeits and raise appeals</h2><p className="muted">A submitted score or forfeit is published provisionally. The opposing manager may appeal, and an administrator completes the final check before any forfeit affects prize-draw eligibility.</p></div>
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
      const managerRuling = rulings[fixture.id] || 'played';

      return <article className="result-submission-card" key={fixture.id}>
        <div><strong>{isHome ? 'Home' : 'Away'} vs {opponent}</strong><span>{fixture.round} · {fixture.fixture_date || 'Date TBC'}</span></div>
        {canSubmit && <div className="result-score-form">
          <label>Result type<select value={managerRuling} onChange={(event) => changeRuling(fixture, event.target.value)}><option value="played">Played normally</option><option value="opponent_forfeit">Opponent forfeited</option><option value="self_forfeit">My team forfeited</option></select></label>
          <label>Your score<input type="number" min="0" value={scores[fixture.id]?.mine ?? ''} onChange={(event) => setScores((current) => ({ ...current, [fixture.id]: { ...current[fixture.id], mine: event.target.value } }))} /></label>
          <label>{opponent}<input type="number" min="0" value={scores[fixture.id]?.theirs ?? ''} onChange={(event) => setScores((current) => ({ ...current, [fixture.id]: { ...current[fixture.id], theirs: event.target.value } }))} /></label>
          {managerRuling !== 'played' && <label>Forfeit reason<input value={forfeitReasons[fixture.id] || ''} onChange={(event) => setForfeitReasons((current) => ({ ...current, [fixture.id]: event.target.value }))} placeholder="e.g. fixture not organised, ineligible player, concession" /></label>}
          {managerRuling !== 'played' && <p className="muted">The standard forfeit score is 3–0. If a better scoreline was actually achieved, you may keep it provided the non-forfeiting team leads by at least three goals.</p>}
          <button type="button" onClick={() => submitResult(fixture)} disabled={loading}>{managerRuling === 'played' ? 'Publish result' : 'Report forfeit'}</button>
        </div>}
        {submission && <div className="result-submission-status"><strong>{mineSubmitted}–{theirsSubmitted}</strong><span className={`status-pill status-${submission.status}`}>{submission.status.replaceAll('_', ' ')}</span>{submission.submission_ruling && submission.submission_ruling !== 'played' && <span className="status-pill status-forfeit">Forfeit reported</span>}</div>}
        {submission?.forfeit_reason && <p className="muted"><strong>Forfeit reason:</strong> {submission.forfeit_reason}</p>}
        {canRespond && <div className="result-response"><label>Appeal reason<input value={notes[submission.id] || ''} onChange={(event) => setNotes((current) => ({ ...current, [submission.id]: event.target.value }))} placeholder="Required only if appealing" /></label><div className="button-row"><button type="button" onClick={() => respond(submission, 'confirm')} disabled={loading}>Acknowledge result</button><button type="button" className="danger" onClick={() => respond(submission, 'appeal')} disabled={loading}>Report incorrect result</button></div></div>}
        {submission?.status === 'pending_admin_check' && !isOpponent && <p className="muted">Published provisionally and awaiting the administrator’s final check.</p>}
        {submission?.status === 'opponent_confirmed' && <p className="muted">Opponent acknowledged. Awaiting the administrator’s final check.</p>}
        {submission?.status === 'appealed' && <p className="muted">Appealed: {submission.opponent_response_note || 'Awaiting administrator review.'}</p>}
        {submission?.status === 'final' && <p className="muted">Finalised by the administrator. It can still be amended later if disciplinary or eligibility issues emerge.</p>}
      </article>;
    })}</div>
  </section>;
}
