import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Top 100 officials: bottom-three reviews (rulebook 3.1) and vacancies (3.2).
// Scores come from the archive's appointment-scores function, which runs the same
// scoring as Stats & History on the Full History sheet and the live season. The
// result is stored with its inputs (appointment_rounds) and published with the
// decisions, the officials' votes and their reasons.

const SCORES_URL = 'https://archive.smtop100.blog/.netlify/functions/appointment-scores';
const OUTCOMES = {
  reappoint: 'Reappoint',
  secondChance: 'Second chance (last chance next season)',
  anotherClub: 'Not reappointed: another club',
  leave: 'Not reappointed: no club',
};
// Activity and discipline inputs. Most are filled from Top 100's records (Manager Lab sync and
// this site); the rest are the admin team's to fill in. Any of them can be corrected before
// scoring: the value used is saved and published with the scores. min/max are what the
// scoring can use; values outside them are clamped.
const INPUT_FIELDS = [
  { key: 'competitions', label: 'Top 100 competitions entered', source: 'records', min: 0, max: 20,
    help: 'This season and last. 2 points each, up to 4 (2 or more is full marks).' },
  { key: 'topManagerDeals', label: 'Transfers with Top 100 managers', source: 'records', min: 0, max: 50,
    help: 'Last 120 days. 0.4 points each, up to 4 (10 or more is full marks).' },
  { key: 'running', label: 'Helps run Top 100 (0–3)', source: 'records', min: 0, max: 3,
    help: '3 for admins (from records). Otherwise your judgement: 1–2 for regular helpers. Blank counts as 0.' },
  { key: 'community', label: 'Community and social (0–3)', source: 'admin', min: 0, max: 3,
    help: 'Your judgement: chat, polls, helping other managers. Blank leaves it out of the score.' },
  { key: 'gameWorlds', label: 'Soccer Manager game worlds', source: 'records', min: 1, max: 50,
    help: 'From their Soccer Manager profile, Top 100 included. Full marks (2) at 3 or fewer, 0.25 less for each extra.' },
  { key: 'forfeits', label: 'Forfeits this season', source: 'records', min: 0, max: 50,
    help: 'Top 100 competitions. 3 or more is a clear and obvious error.' },
  { key: 'sanctions', label: 'Sanctions this season', source: 'admin', min: 0, max: 5,
    help: 'Each costs 2.5 of the 5 discipline points; any sanction is a clear and obvious error.' },
  { key: 'loginGaps', label: 'Spells of 7+ days without logging in', source: 'admin', min: 0, max: 20,
    help: 'This season. 2 or more means inactive: never reappointed (rule 3.1).' },
];
const FIELD = Object.fromEntries(INPUT_FIELDS.map((field) => [field.key, field]));
// The functions that take the game world (the others act on one row by id).
const WORLD_FUNCTIONS = new Set(['load_appointment_reviews', 'save_appointment_round', 'publish_appointments', 'upsert_appointment_vacancy', 'announce_appointment_vacancies']);
const INLINE = { display: 'flex', alignItems: 'center', gap: 6 };
const BOX = { width: 'auto', margin: 0, flex: 'none' };
const ordinal = (n) => { const v = Number(n) % 100; return `${n}${v >= 11 && v <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th'}`; };
const when = (value) => (value ? new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
const numberOrNull = (value) => (value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value));
// An input as the scoring will use it: a number within the field's limits, or null when blank.
const fieldValue = (values, key) => {
  const value = numberOrNull(values?.[key]);
  const field = FIELD[key];
  return value === null || !field ? value : Math.min(field.max, Math.max(field.min, value));
};
const HERO_LINK = { color: '#fff', textDecoration: 'underline', fontWeight: 600 };
const STEP = { borderTop: '1px solid var(--line, #e2e8f0)', marginTop: 16, paddingTop: 12 };
const STEP_TITLE = { margin: '0 0 4px', fontSize: 16 };

// The scoring inputs as a table: what each one is, what Top 100's records say, and the
// value that will be used (editable, within its limits).
function InputsEditor({ values, records = {}, onChange, fields = INPUT_FIELDS, disabled }) {
  const recorded = (key) => (records[key] === null || records[key] === undefined || records[key] === '' ? null : records[key]);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ fontSize: 13, width: '100%' }}>
        <thead><tr><th style={{ textAlign: 'left' }}>Input</th><th>From records</th><th>Used for scoring</th></tr></thead>
        <tbody>
          {fields.map((field) => {
            const record = recorded(field.key);
            const value = values[field.key] ?? '';
            const edited = field.source === 'records' && record !== null && String(value) !== String(record);
            const outOfRange = value !== '' && numberOrNull(value) !== null && (Number(value) < field.min || Number(value) > field.max);
            return (
              <tr key={field.key}>
                <td style={{ textAlign: 'left', verticalAlign: 'top' }}>
                  <strong>{field.label}</strong>
                  <div className="muted">{field.help}</div>
                </td>
                <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  {field.source === 'admin' ? <span className="muted">Admin team fills in</span> : record ?? <span className="muted">Not recorded</span>}
                </td>
                <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                  <input type="number" min={field.min} max={field.max} step="1" style={{ width: 80 }} disabled={disabled}
                    aria-label={field.label} value={value} onChange={(event) => onChange({ ...values, [field.key]: event.target.value })} />
                  {edited && !disabled && (
                    <div className="muted">
                      Changed from {record}{' '}
                      <button type="button" className="secondary" style={{ padding: '2px 8px' }} onClick={() => onChange({ ...values, [field.key]: record })}>Reset</button>
                    </div>
                  )}
                  {outOfRange && <div className="status">Counts as {fieldValue(values, field.key)} ({field.min}–{field.max}).</div>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const tallyOf = (votes) => votes.reduce((tally, vote) => ({ ...tally, [vote.choice]: (tally[vote.choice] || 0) + 1 }), {});

// Step: every admin votes, with a reason. Votes and reasons are published with the decision.
function Votes({ votes, choices, onVote, disabled }) {
  const mine = votes.find((vote) => vote.mine);
  const [choice, setChoice] = useState(mine?.choice || '');
  const [reason, setReason] = useState(mine?.reason || '');
  return (
    <div>
      {votes.length ? (
        <ul>{votes.map((vote) => <li key={vote.id}><strong>{vote.voter_name || 'Official'}</strong>: {choices[vote.choice] || vote.choice}. {vote.reason}</li>)}</ul>
      ) : <p className="muted">No votes yet.</p>}
      {!disabled && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 13 }}>Your vote
            <select value={choice} onChange={(event) => setChoice(event.target.value)} style={{ display: 'block' }}>
              <option value="">Choose…</option>
              {Object.entries(choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label style={{ flex: 1, minWidth: 200, fontSize: 13 }}>Your reason (published)
            <input value={reason} onChange={(event) => setReason(event.target.value)} style={{ display: 'block', width: '100%' }} />
          </label>
          <button type="button" disabled={!choice || !reason.trim()} onClick={() => onVote(choice, reason)}>{mine ? 'Change my vote' : 'Cast my vote'}</button>
        </div>
      )}
    </div>
  );
}

// Step: the team's decision, recorded once the votes are in. It is saved, not published:
// "Publish decided…" at the top publishes every decided one and tells the managers.
function Decision({ current, reason: currentReason, choices, votes, onDecide, published, majorityFor = [], requireVotes = true, defaultChoice = '', defaultReason = '' }) {
  const tally = tallyOf(votes);
  const leading = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const [choice, setChoice] = useState(current || leading || defaultChoice);
  const [reason, setReason] = useState(currentReason || defaultReason);
  const waiting = requireVotes && !votes.length;
  if (published) return <p><strong>Published: {choices[current] || 'no appointment'}.</strong> {currentReason}</p>;
  const hasMajority = (value) => (tally[value] || 0) * 2 > votes.length;
  const blocked = waiting
    ? 'Record the decision once the admin team has voted.'
    : majorityFor.includes(choice) && !hasMajority(choice)
      ? `${choices[choice]} needs a majority of the votes (${tally[choice] || 0} of ${votes.length} so far).`
      : '';
  return (
    <div>
      {votes.length > 0 && (
        <p className="muted">Votes so far: {Object.entries(tally).map(([value, count]) => `${choices[value] || value} ${count}`).join(' · ')}.</p>
      )}
      {current && <p><strong>Decided: {choices[current]}</strong>{currentReason ? `. ${currentReason}` : ''} <span className="muted">(not published yet)</span></p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 13 }}>Team decision
          <select value={choice} disabled={waiting} onChange={(event) => setChoice(event.target.value)} style={{ display: 'block' }}>
            <option value="">Choose…</option>
            {Object.entries(choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 200, fontSize: 13 }}>The team's reason (published)
          <input value={reason} disabled={waiting} onChange={(event) => setReason(event.target.value)} style={{ display: 'block', width: '100%' }} />
        </label>
        <button type="button" disabled={!choice || Boolean(blocked)} onClick={() => onDecide(choice, reason)}>{current ? 'Change decision' : 'Record decision'}</button>
      </div>
      {blocked && <p className="muted">{blocked}</p>}
    </div>
  );
}

async function score(config) {
  const response = await fetch(SCORES_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Scoring failed (${response.status})`);
  return body;
}

// ── Bottom-three reviews ───────────────────────────────────────────────────────

function ReviewFacts({ review, onSave }) {
  const [facts, setFacts] = useState({ standing: review.standing || '', misconduct: review.misconduct || '', inactive: review.inactive || '' });
  const disabled = Boolean(review.published_at);
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', fontSize: 13 }}>
      <label style={INLINE}><input type="checkbox" style={BOX} disabled={disabled} checked={review.took_over_mid_season} onChange={(event) => onSave({ tookOverMidSeason: event.target.checked })} /> Took over mid-season</label>
      <label style={INLINE}><input type="checkbox" style={BOX} disabled={disabled} checked={review.last_chance} onChange={(event) => onSave({ lastChance: event.target.checked })} /> On a last chance</label>
      {['standing', 'misconduct', 'inactive'].map((key) => (
        <label key={key}>
          {key === 'standing' ? 'Standing reappointment' : key === 'misconduct' ? 'Misconduct' : 'Inactive'}
          <input disabled={disabled} value={facts[key]} placeholder={key === 'standing' ? 'e.g. founder at Genoa' : ''} style={{ display: 'block' }}
            onChange={(event) => setFacts({ ...facts, [key]: event.target.value })}
            onBlur={() => facts[key] !== (review[key] || '') && onSave({ [key]: facts[key] })} />
        </label>
      ))}
    </div>
  );
}

// Routine reviews: in Divisions 3–5, and for managers who took over mid-season, the manager is
// reappointed unless they ask to move or take a break, so the admin team doesn't score or vote.
// The rule's hard bars (not Gold, misconduct, inactivity) still need a decision.
const ROUTINE_FROM_DIVISION = 3;
const isRoutine = (review) => review.took_over_mid_season || review.division >= ROUTINE_FROM_DIVISION;
const routineLabel = (review) => (review.took_over_mid_season ? 'took over mid-season' : `Division ${review.division}`);
// Why a routine review can't simply be reappointed, or '' when it can.
const routineBlock = (review, records = {}) => {
  if (records.gold === false) return 'not a Gold member';
  if (review.misconduct) return 'misconduct recorded';
  if (review.inactive) return 'inactivity recorded';
  if (review.wish === 'move') return 'asks to move to another club';
  if (review.wish === 'break') return 'asks to take a break';
  return '';
};

// The scoring request for the reviews that need scoring, from the inputs on the page.
const reviewScoringConfig = (data, reviews, inputs, newcomers) => ({
  mode: 'review',
  currentSeason: data.season,
  managers: reviews.map((review) => {
    const values = inputs[`r${review.id}`] || {};
    const base = data.inputs[String(review.manager_id)] || {};
    return {
      key: String(review.id), name: review.manager_name, club: review.club_name, display: review.manager_name,
      tookOverMidSeason: review.took_over_mid_season, gold: base.gold, loginGaps: fieldValue(values, 'loginGaps'),
      inactive: review.inactive || undefined, misconduct: review.misconduct || undefined, standing: review.standing || undefined,
      lastChance: review.last_chance ? 'recorded at an earlier review' : undefined, wish: review.wish || undefined,
    };
  }),
  supply: { newcomers: newcomers.split(',').map((name) => name.trim()).filter(Boolean), leavers: [] },
  discipline: Object.fromEntries(reviews.map((review) => [String(review.id), { sanctions: fieldValue(inputs[`r${review.id}`], 'sanctions') || 0 }])),
  activity: Object.fromEntries(reviews.map((review) => {
    const values = inputs[`r${review.id}`] || {};
    return [String(review.id), Object.fromEntries(['competitions', 'topManagerDeals', 'running', 'community', 'gameWorlds', 'forfeits']
      .map((key) => [key, fieldValue(values, key)]).filter(([, value]) => value !== null))];
  })),
});

function ReviewsTab({ data, inputs, setInputs, call, setMessage, reload }) {
  const round = data.rounds.review;
  const [newcomers, setNewcomers] = useState((round?.inputs?.supply?.newcomers || []).join(', '));
  const saved = useMemo(() => Object.fromEntries((round?.result?.reviews || []).map((review) => [review.key, review])), [round]);
  const toScore = data.reviews.filter((review) => review.manager_name && !isRoutine(review));
  // Automatic scores from Top 100's records, worked out when the page opens and not saved, so
  // the list shows a score straight away. Score reviews saves the admin team's (with any
  // corrected inputs), and those replace the automatic ones.
  const [auto, setAuto] = useState({});
  const [autoFailed, setAutoFailed] = useState(false);
  // Rescore when anything the scoring reads changes: the clubs, or a review's facts.
  const toScoreKey = JSON.stringify(data.reviews.map((review) => [review.id, review.took_over_mid_season, review.last_chance,
    review.standing, review.misconduct, review.inactive, review.wish, review.division]));
  useEffect(() => {
    if (!toScore.length) return undefined;
    let active = true;
    score(reviewScoringConfig(data, toScore, initialInputs(data), ''))
      .then((result) => { if (active) setAuto(Object.fromEntries((result.reviews || []).map((review) => [review.key, review]))); })
      .catch(() => { if (active) setAutoFailed(true); });
    return () => { active = false; };
  }, [toScoreKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const results = { ...auto, ...saved };
  const isAuto = (id) => !saved[String(id)] && Boolean(auto[String(id)]);
  const routineReady = data.reviews.filter((review) => review.manager_id && isRoutine(review) && !review.decision && !review.published_at
    && !routineBlock(review, data.inputs[String(review.manager_id)]));
  const reappointRoutine = async () => {
    if (!window.confirm(`Record "Reappoint" for ${routineReady.length} routine review(s)? Nothing is published until you publish the decided reviews.`)) return;
    setMessage('Saving…');
    for (const review of routineReady) {
      const { error } = await supabase.rpc('decide_appointment_review', {
        p_id: review.id, p_decision: 'reappoint', p_reason: `Reappointed: ${routineLabel(review)}, and no request to move or take a break.`,
      });
      if (error) { setMessage(error.message); await reload(); return; }
    }
    await reload();
    setMessage(`${routineReady.length} routine review(s) decided: reappoint (not yet published).`);
  };
  const balance = round?.result?.balance;
  const votesFor = (id) => data.votes.filter((vote) => vote.subject_kind === 'review' && vote.subject_id === id);
  // With every club that can still finish in the bottom three loaded, there are many cards:
  // division tabs filter the summary and the cards, and the summary links to each card.
  const [division, setDivision] = useState('all');
  const divisions = [...new Set(data.reviews.map((review) => review.division))].sort((a, b) => a - b);
  // Cards outside the chosen division are hidden, not unmounted, so unsaved votes and reasons survive.
  const shown = (review) => division === 'all' || review.division === division;

  const runScoring = async () => {
    const config = reviewScoringConfig(data, toScore, inputs, newcomers);
    setMessage('Scoring…');
    try {
      const result = await score(config);
      await call('save_appointment_round', { p_kind: 'review', p_inputs: { ...config, edited: own(inputs, 'r') }, p_result: result, p_season: data.season }, 'Scored.');
    } catch (error) {
      setMessage(error.message);
    }
  };

  return (
    <>
      <section className="card">
        <h2>S{data.season} bottom-three reviews</h2>
        <p className="muted">
          Start three games before the end of the season. <strong>Load the clubs</strong> brings in every club that can
          still finish in the bottom three, not just the current bottom three, and reloading later refreshes positions
          and drops clubs that have finished clear (unless already decided). Then, for each club:
        </p>
        <ol className="muted">
          <li>Add the facts the scores can't know: mid-season takeovers (ticked automatically where Top 100's records show one), standing reappointments, earlier last chances, misconduct, inactivity.</li>
          <li>Check the scoring inputs. Most come from Top 100's records; fill in the ones marked for the admin team, and correct any that are wrong.</li>
          <li><strong>Score reviews</strong> (all clubs at once) for each manager's review score and a suggested outcome.</li>
          <li>Every admin votes, with a reason.</li>
          <li>Record the team's decision once the votes are in. A second chance needs a majority.</li>
        </ol>
        <p className="muted">
          <strong>Routine reviews</strong> (Divisions {ROUTINE_FROM_DIVISION}–5, and managers who took over mid-season) skip
          steps 2–4: the manager is reappointed unless they ask to move or take a break, or a hard bar applies (not Gold,
          misconduct, inactivity). <strong>Reappoint routine reviews</strong> records those decisions in one go.
        </p>
        <p className="muted">Decisions stay private until <strong>Publish decided reviews</strong>, which publishes them with the scores, votes and reasons and tells each manager.</p>
        <div className="button-row">
          <button type="button" onClick={() => call('load_appointment_reviews', { p_season: data.season }, 'Bottom three loaded.')}>{data.reviews.length ? 'Refresh the clubs' : 'Load the clubs'}</button>
          <label>Newcomers waiting <input value={newcomers} onChange={(event) => setNewcomers(event.target.value)} placeholder="Names, comma separated" /></label>
          <button type="button" disabled={!toScore.length || Boolean(round?.published_at)} onClick={runScoring}>Score reviews ({toScore.length})</button>
          <button type="button" disabled={!routineReady.length} onClick={reappointRoutine}>Reappoint routine reviews ({routineReady.length})</button>
          <button type="button" className="secondary" disabled={!data.reviews.some((review) => review.decision && !review.published_at)}
            onClick={() => window.confirm('Publish every decided review and tell each manager?') && call('publish_appointments', { p_kind: 'review', p_season: data.season }, 'Published.')}>
            Publish decided reviews
          </button>
        </div>
        {round && <p className="muted">Last scored {when(round.scored_at)}{round.published_at ? `, published ${when(round.published_at)}` : ''}.</p>}
        {balance && (
          <p>
            After the review: {balance.openClubs} club(s) need a manager{balance.bigClubs?.length ? ` (D1–D2: ${balance.bigClubs.join(', ')})` : ''},
            {' '}{balance.newcomers} newcomer(s) waiting, {balance.managersAfter} managers next season.
            {balance.undecided?.length ? ` Second chance to decide: ${balance.undecided.join(', ')}.` : ''}
          </p>
        )}
      </section>
      {data.reviews.length > 0 && (
        <section className="card" id="review-summary">
          <div className="button-row" style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface, #fff)', padding: '8px 0' }}>
            <button type="button" className={division === 'all' ? '' : 'secondary'} onClick={() => setDivision('all')}>All ({data.reviews.length})</button>
            {divisions.map((value) => (
              <button type="button" key={value} className={division === value ? '' : 'secondary'} onClick={() => setDivision(value)}>
                D{value} ({data.reviews.filter((review) => review.division === value).length})
              </button>
            ))}
          </div>
          {divisions.filter((value) => division === 'all' || value === division).map((value) => (
            <div key={value} style={{ overflowX: 'auto' }}>
              <h3 id={`division-${value}`}>Division {value}</h3>
              <table style={{ fontSize: 13, width: '100%' }}>
                <thead><tr><th>Pos</th><th style={{ textAlign: 'left' }}>Club</th><th style={{ textAlign: 'left' }}>Manager</th><th>Pts</th><th>Bottom three</th><th>Mid-season</th><th>Wants</th><th>Review</th><th>Score</th><th>Votes</th><th>Decision</th></tr></thead>
                <tbody>
                  {data.reviews.filter((review) => review.division === value).map((review) => {
                    const result = results[String(review.id)];
                    return (
                      <tr key={review.id}>
                        <td>{ordinal(review.position)}</td>
                        <td style={{ textAlign: 'left' }}><a href={`#review-${review.id}`}>{review.club_name}</a></td>
                        <td style={{ textAlign: 'left' }}>{review.manager_name || '–'}</td>
                        <td>{review.points ?? '–'}</td>
                        <td>{review.certain === false ? 'Could' : review.certain === true ? <strong>Certain</strong> : '–'}</td>
                        <td>
                          <input type="checkbox" style={BOX} disabled={Boolean(review.published_at)} checked={review.took_over_mid_season}
                            aria-label={`${review.club_name}: took over mid-season`}
                            onChange={(event) => call('update_appointment_review', { p_id: review.id, p_fields: { tookOverMidSeason: event.target.checked } }, 'Saved.')} />
                        </td>
                        <td>{review.wish || '–'}</td>
                        <td>{isRoutine(review)
                          ? (routineBlock(review, data.inputs[String(review.manager_id)]) ? <strong>Decide: {routineBlock(review, data.inputs[String(review.manager_id)])}</strong> : 'Routine')
                          : 'Full'}</td>
                        <td>{isRoutine(review) ? '–' : result ? <>{result.total}{isAuto(review.id) ? <span className="muted"> auto</span> : ''}{result.vote ? ' (vote)' : ''}</> : autoFailed ? '–' : '…'}</td>
                        <td>{votesFor(review.id).length || '–'}</td>
                        <td>{review.published_at ? `${OUTCOMES[review.decision]} (published)` : review.decision ? OUTCOMES[review.decision] : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      )}
      {data.reviews.map((review) => {
        const result = results[String(review.id)];
        const key = `r${review.id}`;
        return (
          <section className="card" key={review.id} id={`review-${review.id}`} hidden={!shown(review)} style={{ scrollMarginTop: 16, display: shown(review) ? undefined : 'none' }}>
            <p style={{ margin: 0, textAlign: 'right' }}><a href="#review-summary">Back to the list</a></p>
            <h3>D{review.division} {ordinal(review.position)} · {review.club_name} · {review.manager_name || 'no manager'}</h3>
            <p className="muted">
              {review.points ?? '–'} points
              {review.games_left ? ` · ${review.games_left} game${review.games_left === 1 ? '' : 's'} left · ` : ' · '}
              {review.certain === false ? <strong>could still finish in the bottom three</strong>
                : review.certain === true ? <strong>finishes in the bottom three</strong> : `${ordinal(review.position)} when loaded`}
            </p>

            <div style={STEP}>
              <h4 style={STEP_TITLE}>1 · The manager and the facts</h4>
              <p>{review.wish ? <>The manager wants to <strong>{review.wish}</strong>{review.wish_note ? `: “${review.wish_note}”` : '.'}</> : <span className="muted">The manager hasn't said what they want yet.</span>}</p>
              <ReviewFacts review={review} onSave={(fields) => call('update_appointment_review', { p_id: review.id, p_fields: fields }, 'Saved.')} />
            </div>

            {isRoutine(review) ? (
              <div style={{ ...STEP, background: 'var(--surface-muted, #f1f5f9)', padding: 12, borderRadius: 12 }}>
                <h4 style={STEP_TITLE}>Routine review: {routineLabel(review)}</h4>
                {routineBlock(review, data.inputs[String(review.manager_id)])
                  ? <p><strong>Needs a decision: {routineBlock(review, data.inputs[String(review.manager_id)])}.</strong> No scoring or votes needed unless the team wants them.</p>
                  : <p className="muted" style={{ marginTop: 0 }}>Reappointed unless the manager asks to move or take a break. No scoring or votes needed: record it here, or use Reappoint routine reviews at the top for all of them.</p>}
                <Decision current={review.decision} reason={review.decision_reason} choices={OUTCOMES} votes={votesFor(review.id)} requireVotes={false}
                  defaultChoice={review.wish === 'move' ? 'anotherClub' : review.wish === 'break' ? 'leave' : 'reappoint'}
                  defaultReason={`${routineLabel(review)[0].toUpperCase()}${routineLabel(review).slice(1)}.`}
                  published={Boolean(review.published_at)}
                  onDecide={(decision, reason) => call('decide_appointment_review', { p_id: review.id, p_decision: decision, p_reason: reason }, 'Decision saved (not yet published).')} />
              </div>
            ) : (<>
            <div style={STEP}>
              <h4 style={STEP_TITLE}>2 · Scoring inputs</h4>
              <InputsEditor values={inputs[key] || {}} records={data.inputs[String(review.manager_id)] || {}} disabled={Boolean(review.published_at)}
                onChange={(values) => setInputs({ ...inputs, [key]: values })} />
            </div>

            <div style={STEP}>
              <h4 style={STEP_TITLE}>3 · Review score</h4>
              {result ? (
                <>
                  {isAuto(review.id) && <p className="muted" style={{ marginTop: 0 }}>Automatic, from Top 100's records. Score reviews saves the admin team's score with any corrected inputs.</p>}
                  <p>
                    <strong>{result.total}</strong> out of 100 (result {result.breakdown.result} · record {result.breakdown.record} · activity {result.breakdown.activity} · conduct {result.breakdown.conduct}).
                    Suggested: <strong>{OUTCOMES[result.outcome]}</strong>{result.vote ? ' · close: the admin team should vote' : ''}.
                  </p>
                  <p className="muted">{result.reason}</p>
                </>
              ) : <p className="muted">{autoFailed ? 'The automatic score could not be worked out: use Score reviews at the top.' : 'Working out the automatic score…'}</p>}
            </div>

            <div style={STEP}>
              <h4 style={STEP_TITLE}>4 · Votes</h4>
              <p className="muted" style={{ marginTop: 0 }}>Every admin votes, with a reason. Votes and reasons are published with the decision.</p>
              <Votes votes={votesFor(review.id)} choices={OUTCOMES} disabled={Boolean(review.published_at)}
                onVote={(choice, reason) => call('cast_appointment_vote', { p_subject_kind: 'review', p_subject_id: review.id, p_choice: choice, p_reason: reason }, 'Vote recorded.')} />
            </div>

            <div style={{ ...STEP, background: 'var(--surface-muted, #f1f5f9)', padding: 12, borderRadius: 12 }}>
              <h4 style={STEP_TITLE}>5 · Team decision</h4>
              <p className="muted" style={{ marginTop: 0 }}>Once the votes are in, one admin records what the team decided. It isn't published until you publish the decided reviews.</p>
              <Decision current={review.decision} reason={review.decision_reason} choices={OUTCOMES} votes={votesFor(review.id)} majorityFor={['secondChance']}
                published={Boolean(review.published_at)}
                onDecide={(decision, reason) => call('decide_appointment_review', { p_id: review.id, p_decision: decision, p_reason: reason }, 'Decision saved (not yet published).')} />
            </div>
            </>)}
          </section>
        );
      })}
    </>
  );
}

// ── Vacancies ──────────────────────────────────────────────────────────────────

function NewVacancy({ clubs, onCreate }) {
  const [club, setClub] = useState('');
  const [division, setDivision] = useState('');
  const [context, setContext] = useState('');
  const [closes, setCloses] = useState('');
  const pick = (name) => {
    setClub(name);
    const row = clubs.find((item) => item.club === name);
    if (row && !division) setDivision(String(row.division));
  };
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
      <label>Club
        <select value={club} onChange={(event) => pick(event.target.value)} style={{ display: 'block' }}>
          <option value="">Choose…</option>
          {clubs.map((row) => <option key={row.club} value={row.club}>{row.club} (D{row.division} {ordinal(row.position)}, {row.manager || 'no manager'})</option>)}
        </select>
      </label>
      <label>Division next season<input type="number" min="1" max="5" value={division} onChange={(event) => setDivision(event.target.value)} style={{ display: 'block', width: 70 }} /></label>
      <label>Applications close<input type="datetime-local" value={closes} onChange={(event) => setCloses(event.target.value)} style={{ display: 'block' }} /></label>
      <label style={{ flex: 1, minWidth: 220 }}>Context (published)<input value={context} onChange={(event) => setContext(event.target.value)} style={{ display: 'block', width: '100%' }} /></label>
      <button type="button" disabled={!club || !division} onClick={() => onCreate({ club, division: Number(division), context, closes: closes ? new Date(closes).toISOString() : null })}>Add vacancy</button>
    </div>
  );
}

function VacanciesTab({ data, inputs, setInputs, call, setMessage }) {
  const round = data.rounds.vacancies;
  const vacancies = data.vacancies.filter((vacancy) => vacancy.status !== 'withdrawn');
  const applications = data.applications.filter((application) => application.status === 'active');
  const clubName = (id) => data.vacancies.find((vacancy) => vacancy.id === id)?.club_name || `#${id}`;
  const applicantName = Object.fromEntries(applications.map((application) => [String(application.manager_id), application.managerName]));
  const result = round?.result;

  const runScoring = async () => {
    const keyOf = (application) => String(application.manager_id);
    const config = {
      mode: 'vacancies',
      currentSeason: data.season,
      vacancies: vacancies.map((vacancy) => ({ club: vacancy.club_name, division: vacancy.division })),
      applicants: applications.map((application) => ({ key: keyOf(application), name: application.managerName, club: application.club, display: application.managerName })),
      preferences: Object.fromEntries(applications.map((application) => [keyOf(application), application.preferences.map(clubName)])),
      discipline: Object.fromEntries(applications.map((application) => {
        const base = data.inputs[keyOf(application)] || {};
        return [keyOf(application), { gold: base.gold, openSanction: base.openSanction, sanctions: fieldValue(inputs[`a${application.manager_id}`], 'sanctions') || 0 }];
      })),
      activity: Object.fromEntries(applications.map((application) => {
        const values = inputs[`a${application.manager_id}`] || {};
        return [keyOf(application), Object.fromEntries(['competitions', 'topManagerDeals', 'running', 'community', 'gameWorlds']
          .map((key) => [key, fieldValue(values, key)]).filter(([, value]) => value !== null))];
      })),
    };
    setMessage('Scoring…');
    try {
      const scored = await score(config);
      await call('save_appointment_round', { p_kind: 'vacancies', p_inputs: { ...config, edited: own(inputs, 'a') }, p_result: scored, p_season: data.season }, 'Scored.');
    } catch (error) {
      setMessage(error.message);
    }
  };

  return (
    <>
      <section className="card">
        <h2>S{data.season + 1} vacancies</h2>
        <NewVacancy clubs={data.clubs} onCreate={({ club, division, context, closes }) =>
          call('upsert_appointment_vacancy', { p_club_name: club, p_division: division, p_context: context, p_closes_at: closes, p_season: data.season }, 'Vacancy added.')} />
        <ul>
          {data.vacancies.map((vacancy) => (
            <li key={vacancy.id}>
              <strong>{vacancy.club_name}</strong> (D{vacancy.division}) · {vacancy.status}{vacancy.closes_at ? ` · closes ${when(vacancy.closes_at)}` : ''}
              {vacancy.context ? ` · ${vacancy.context}` : ''}{' '}
              {!vacancy.published_at && vacancy.status === 'open' && <button type="button" className="secondary" onClick={() => call('set_appointment_vacancy_status', { p_id: vacancy.id, p_status: 'closed' }, 'Closed.')}>Close</button>}
              {!vacancy.published_at && vacancy.status === 'closed' && !vacancy.decided_at && <button type="button" className="secondary" onClick={() => call('set_appointment_vacancy_status', { p_id: vacancy.id, p_status: 'open' }, 'Reopened.')}>Reopen</button>}
              {!vacancy.published_at && vacancy.status !== 'withdrawn' && !vacancy.decided_at && <> <button type="button" className="secondary" onClick={() => call('set_appointment_vacancy_status', { p_id: vacancy.id, p_status: 'withdrawn' }, 'Withdrawn.')}>Withdraw</button></>}
            </li>
          ))}
        </ul>
        <div className="button-row">
          <button type="button" disabled={!vacancies.some((vacancy) => vacancy.status === 'open')}
            onClick={() => window.confirm('Notify every manager that these vacancies are open?') && call('announce_appointment_vacancies', { p_season: data.season }, 'Managers notified.')}>
            Announce to managers
          </button>
          <button type="button" disabled={!applications.length || !vacancies.length || Boolean(round?.published_at)} onClick={runScoring}>Score applicants</button>
          <button type="button" className="secondary" disabled={!data.vacancies.some((vacancy) => vacancy.decided_at && !vacancy.published_at)}
            onClick={() => window.confirm('Publish every decided vacancy, with the scores, and tell the managers appointed?') && call('publish_appointments', { p_kind: 'vacancies', p_season: data.season }, 'Published.')}>
            Publish decided vacancies
          </button>
        </div>
        {round && <p className="muted">Last scored {when(round.scored_at)}{round.published_at ? `, published ${when(round.published_at)}` : ''}.</p>}
      </section>

      <section className="card">
        <h2>Applications ({applications.length})</h2>
        {applications.map((application) => (
          <div key={application.id} style={{ marginBottom: 12 }}>
            <strong>{application.managerName}</strong> ({application.club}, D{application.clubDivision} {ordinal(application.clubPosition)}): {application.preferences.map(clubName).join(' → ')}
            {application.note && <div className="muted">“{application.note}”</div>}
            {data.inputs[String(application.manager_id)]?.gold === false && <div className="status">Not a Gold member.</div>}
            <details>
              <summary>Scoring inputs (from Top 100's records; check and fill in before scoring)</summary>
              <InputsEditor fields={INPUT_FIELDS.filter(({ key }) => !['forfeits', 'loginGaps'].includes(key))} values={inputs[`a${application.manager_id}`] || {}}
                records={data.inputs[String(application.manager_id)] || {}}
                onChange={(values) => setInputs({ ...inputs, [`a${application.manager_id}`]: values })} />
            </details>
          </div>
        ))}
      </section>

      {result && (
        <section className="card">
          <h2>Suggested appointments</h2>
          <p className="muted">Each round, every applicant points at their most-preferred open club they are eligible for, and the highest score among those is appointed.</p>
          <ol>{result.allocation.appointments.map((item) => <li key={item.club}>{item.club}: {applicantName[item.manager] || item.manager} ({item.score}){item.vacates ? `, leaving ${item.vacates}` : ''}</li>)}</ol>
          {result.allocation.unfilled.length > 0 && <p>Unfilled: {result.allocation.unfilled.join(', ')}.</p>}
        </section>
      )}

      {vacancies.map((vacancy) => {
        const ranking = (result?.applicants || [])
          .map((applicant) => ({ applicant, scored: applicant.byVacancy?.[vacancy.club_name] }))
          .filter(({ applicant, scored }) => scored && applications.find((application) => String(application.manager_id) === applicant.key)?.preferences.includes(vacancy.id))
          .sort((a, b) => b.scored.total - a.scored.total);
        const choices = Object.fromEntries(applications.filter((application) => application.preferences.includes(vacancy.id)).map((application) => [String(application.manager_id), application.managerName]));
        // Vacancy votes are stored by applicant name; the decision is by manager id.
        const voteChoices = Object.fromEntries(Object.values(choices).map((name) => [name, name]));
        const idByName = Object.fromEntries(Object.entries(choices).map(([id, name]) => [name, id]));
        const vacancyVotes = data.votes.filter((vote) => vote.subject_kind === 'vacancy' && vote.subject_id === vacancy.id);
        return (
          <section className="card" key={vacancy.id}>
            <h3>{vacancy.club_name} (D{vacancy.division})</h3>
            {ranking.length ? (
              <table>
                <thead><tr><th>Applicant</th><th>Score</th><th>Current · recent · honours · level · stability · activity</th><th>Eligible</th></tr></thead>
                <tbody>{ranking.map(({ applicant, scored }) => (
                  <tr key={applicant.key}>
                    <td>{applicant.display}</td><td><strong>{scored.total}</strong></td>
                    <td>{['current', 'recent', 'honours', 'level', 'stability', 'activity'].map((part) => scored.breakdown[part]).join(' · ')}</td>
                    <td>{scored.eligibility.eligible ? 'Yes' : scored.eligibility.reasons.join(' ')}</td>
                  </tr>
                ))}</tbody>
              </table>
            ) : <p className="muted">{result ? 'No applicants scored for this club.' : 'Not scored yet.'}</p>}
            <div style={STEP}>
              <h4 style={STEP_TITLE}>Votes</h4>
              <p className="muted" style={{ marginTop: 0 }}>Every admin votes for an applicant, with a reason. Votes and reasons are published with the appointment.</p>
              <Votes votes={vacancyVotes} disabled={Boolean(vacancy.published_at)} choices={voteChoices}
                onVote={(choice, reason) => call('cast_appointment_vote', { p_subject_kind: 'vacancy', p_subject_id: vacancy.id, p_choice: choice, p_reason: reason }, 'Vote recorded.')} />
            </div>
            <div style={{ ...STEP, background: 'var(--surface-muted, #f1f5f9)', padding: 12, borderRadius: 12 }}>
              <h4 style={STEP_TITLE}>Team decision</h4>
              <p className="muted" style={{ marginTop: 0 }}>Once the votes are in, one admin records who the team appoints. It isn't published until you publish the decided vacancies.</p>
              <Decision current={vacancy.appointed_manager_id ? String(vacancy.appointed_manager_id) : ''} reason={vacancy.decision_reason} published={Boolean(vacancy.published_at)}
                votes={vacancyVotes.map((vote) => ({ ...vote, choice: idByName[vote.choice] || vote.choice }))}
                choices={{ ...choices, ...(vacancy.appointed_manager_id ? { [String(vacancy.appointed_manager_id)]: vacancy.appointedManager } : {}) }}
                onDecide={(manager, reason) => call('decide_appointment_vacancy', { p_id: vacancy.id, p_manager_id: Number(manager), p_reason: reason }, 'Decision saved (not yet published).')} />
            </div>
          </section>
        );
      })}
    </>
  );
}

// Each round keeps only its own inputs: r<review id> for reviews, a<manager id> for applicants.
const own = (inputs, prefix) => Object.fromEntries(Object.entries(inputs).filter(([key]) => key.startsWith(prefix)));

// Scoring inputs: what was used last time, otherwise Top 100's records.
const initialInputs = (data) => {
  const saved = { ...own(data.rounds.review?.inputs?.edited || {}, 'r'), ...own(data.rounds.vacancies?.inputs?.edited || {}, 'a') };
  const fill = (key, managerId) => {
    const base = data.inputs[String(managerId)] || {};
    return saved[key] || Object.fromEntries(INPUT_FIELDS.map(({ key: field }) => [field, base[field] ?? '']));
  };
  return {
    ...Object.fromEntries(data.reviews.filter((review) => review.manager_id).map((review) => [`r${review.id}`, fill(`r${review.id}`, review.manager_id)])),
    ...Object.fromEntries(data.applications.map((application) => [`a${application.manager_id}`, fill(`a${application.manager_id}`, application.manager_id)])),
  };
};

export default function AdminAppointmentsPage() {
  const [data, setData] = useState(null);
  const [inputs, setInputs] = useState({});
  const [tab, setTab] = useState('reviews');
  const [message, setMessage] = useState('Loading…');

  const load = useCallback(async () => {
    const { data: overview, error } = await supabase.rpc('appointment_admin_overview', { p_world_slug: 'top-100' });
    if (error) { setMessage(error.message); return; }
    setData(overview);
    setInputs((current) => ({ ...initialInputs(overview), ...current }));
    setMessage('');
  }, []);

  useEffect(() => { load(); }, [load]);

  const call = async (name, args, done) => {
    setMessage('Saving…');
    const { error } = await supabase.rpc(name, WORLD_FUNCTIONS.has(name) ? { ...args, p_world_slug: 'top-100' } : args);
    if (error) { setMessage(error.message); return; }
    await load();
    setMessage(done);
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Top 100 · Admin team</p>
        <h1>Appointments</h1>
        <p>
          Bottom-three reviews (rule 3.1) and vacancies (rule 3.2). Managers state their wishes and apply in{' '}
          <a href="https://manager.smtop100.blog/appointments" style={HERO_LINK}>Manager Portal</a>; published decisions appear at{' '}
          <a href="/appointments" style={HERO_LINK}>tournaments.smtop100.blog/appointments</a>.
        </p>
        <div className="button-row">
          <button type="button" className={tab === 'reviews' ? '' : 'secondary'} onClick={() => setTab('reviews')}>Reviews</button>
          <button type="button" className={tab === 'vacancies' ? '' : 'secondary'} onClick={() => setTab('vacancies')}>Vacancies</button>
        </div>
      </section>
      {message && <p role="status">{message}</p>}
      {data && tab === 'reviews' && <ReviewsTab data={data} inputs={inputs} setInputs={setInputs} call={call} setMessage={setMessage} reload={load} />}
      {data && tab === 'vacancies' && <VacanciesTab data={data} inputs={inputs} setInputs={setInputs} call={call} setMessage={setMessage} />}
    </main>
  );
}
