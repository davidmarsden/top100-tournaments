import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AdminWaitingListTab from './AdminWaitingListTab';
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
  { key: 'votingPercent', label: 'Awards and polls voted in (%)', source: 'records', min: 0, max: 100,
    help: 'Last 12 months, of the votes they could take part in that have closed. Up to 2 points: 100% is full marks, not voting counts against. No votes yet leaves it out (half marks).' },
  { key: 'community', label: 'Community and social (0–3)', source: 'admin', min: 0, max: 3,
    help: 'Your judgement: chat, helping other managers. Each admin scores separately and the team average is used, counting for up to 2 points; no scores at all leaves it out (half marks).' },
  { key: 'gameWorlds', label: 'Soccer Manager game worlds', source: 'records', min: 1, max: 50,
    help: 'From their Soccer Manager profile, Top 100 included. Full marks (1) at 3 or fewer, 0.125 less for each extra.' },
  { key: 'forfeits', label: 'Forfeits this season', source: 'records', min: 0, max: 50,
    help: 'Top 100 competitions such as the Youth Cup. In a review, 3 or more is a clear and obvious error; an applicant loses 2.5 from stability and conduct for each.' },
  { key: 'sanctions', label: 'Sanctions this season', source: 'admin', min: 0, max: 5,
    help: 'Each costs 2.5 of the 5 discipline points; any sanction is a clear and obvious error. Each admin enters it separately and the team average is used.' },
  { key: 'loginGaps', label: 'Spells of 7+ days without logging in', source: 'admin', min: 0, max: 20,
    help: 'This season. 2 or more means inactive: never reappointed (rule 3.1).' },
];
const FIELD = Object.fromEntries(INPUT_FIELDS.map((field) => [field.key, field]));
// Assessed by each official separately (appointment_assessments); scoring uses the team average.
const ASSESSED = new Set(['community', 'sanctions']);
const teamValue = (data, managerId, key) => numberOrNull(data.assessments?.[String(managerId)]?.[key]);
// The functions that take the game world (the others act on one row by id).
const WORLD_FUNCTIONS = new Set(['load_appointment_reviews', 'save_appointment_round', 'publish_appointments', 'upsert_appointment_vacancy', 'announce_appointment_vacancies', 'set_appointment_assessment']);
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
const COMPARISON = 'comparison:';
const NUM = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const SCORE_PARTS = [['current', 'Current'], ['recent', 'Recent'], ['honours', 'Honours'], ['level', 'Level'], ['stability', 'Stability'], ['activity', 'Activity']];
// What each score column measures and how it is worked out (the archive's appointmentScoring.js).
// A finish score is half the place within the division and half the place among all 100 clubs.
const SCORE_HELP = {
  current: ['Current (out of 20)', "This season's league position so far: 12 × finish score, plus up to 8 for beating the pre-season prediction (4, plus 0.4 for each place better than predicted, less for each place worse). An outgoing manager who has left is credited with the club's season so far."],
  recent: ['Recent (out of 15)', 'The last two completed seasons: 9 × finish score (60% last season, 40% the season before), plus up to 6 for beating predictions (3, plus 0.3 for each place better on average).'],
  honours: ['Honours (out of 15)', 'Completed seasons: 6 for each Division 1 title, 3 for each other title and 2 for each promotion, up to 15.'],
  level: ['Level (out of 10)', "Record at the vacancy's division or higher: 1.5 for each season there (up to 6), plus 2 for each top-half finish there (up to 4)."],
  stability: ['Stability (out of 20)', 'Up to 5 for consecutive seasons at their current club; 10, less 3 for each bottom-three finish in the last five seasons (not counting clubs taken over mid-season); and 5 for conduct, less 2.5 for each sanction this season (the team average). Then 2.5 off for each forfeit in a Top 100 competition this season, such as the Youth Cup, down to 0.'],
  activity: ['Activity (out of 20)', 'Top 100 competitions entered (2 each, up to 4); transfers with Top 100 managers in the last 120 days (0.4 each, up to 4); squad building, places climbed in the squad-strength ranking during their current spell (0–4); helps run Top 100 (0–3); community and social (0–3, the average of the admin team’s scores); and focus, 2 for 3 or fewer Soccer Manager game worlds, 0.25 less for each extra. Any input left blank gets half marks.'],
};
const STEP_TITLE = { margin: '0 0 4px', fontSize: 16 };
// Voting and the team decision look different on purpose, so an admin casting their own vote
// can't mistake the decision box for it: votes are blue and individual, the decision amber and final.
const VOTE_STEP = { marginTop: 16, padding: 12, borderRadius: 12, border: '2px solid #60a5fa', background: 'rgba(96, 165, 250, 0.10)' };
const DECISION_STEP = { marginTop: 24, padding: 12, borderRadius: 12, border: '2px solid #f59e0b', background: 'rgba(245, 158, 11, 0.12)' };
const TAG = { display: 'inline-block', fontSize: 11, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', padding: '2px 8px', borderRadius: 999, marginLeft: 8, verticalAlign: 'middle' };
const VOTE_TAG = { ...TAG, background: '#dbeafe', color: '#1e3a8a' };
const DECISION_TAG = { ...TAG, background: '#fde68a', color: '#78350f' };

// The scoring inputs as a table: what each one is, what Top 100's records say, and the
// value that will be used (editable, within its limits).
// assessment: the team's community and sanctions assessments of this manager ({ community, communityCount,
// sanctions, sanctionsCount, mine }); onAssess saves the signed-in official's own.
function InputsEditor({ values, records = {}, onChange, fields = INPUT_FIELDS, disabled, assessment, onAssess }) {
  const recorded = (key) => (records[key] === null || records[key] === undefined || records[key] === '' ? null : records[key]);
  const [mine, setMine] = useState(() => ({ community: assessment?.mine?.community ?? '', sanctions: assessment?.mine?.sanctions ?? '' }));
  const saveMine = () => {
    const saved = assessment?.mine || {};
    if (['community', 'sanctions'].every((key) => String(saved[key] ?? '') === String(mine[key] ?? ''))) return;
    onAssess({ community: fieldValue(mine, 'community'), sanctions: fieldValue(mine, 'sanctions') });
  };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ fontSize: 13, width: '100%' }}>
        <thead><tr><th style={{ textAlign: 'left' }}>Input</th><th>From records</th><th>Used for scoring</th></tr></thead>
        <tbody>
          {fields.map((field) => {
            if (onAssess && ASSESSED.has(field.key)) {
              const average = numberOrNull(assessment?.[field.key]);
              const count = assessment?.[`${field.key}Count`] || 0;
              return (
                <tr key={field.key}>
                  <td style={{ textAlign: 'left', verticalAlign: 'top' }}>
                    <strong>{field.label}</strong>
                    <div className="muted">{field.help}</div>
                  </td>
                  <td style={{ verticalAlign: 'top' }}>
                    {count ? <>Team average <strong>{average}</strong><div className="muted">{count} admin{count === 1 ? '' : 's'}</div></> : <span className="muted">No admin has scored this yet</span>}
                  </td>
                  <td style={{ verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                    <input type="number" min={field.min} max={field.max} step="0.5" style={{ width: 80 }} disabled={disabled}
                      aria-label={`${field.label}: your score`} value={mine[field.key]}
                      onChange={(event) => setMine({ ...mine, [field.key]: event.target.value })} onBlur={saveMine} />
                    <div className="muted">Your score (saved when you leave the box)</div>
                  </td>
                </tr>
              );
            }
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
                  {field.key === 'votingPercent' && records.votesEligible ? <div className="muted">{records.votesCast} of {records.votesEligible}</div> : null}
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
// warningFor(choice, voter): an optional caution about a vote (e.g. a vacancy applicant the same
// official backs at another club, or one the suggested appointments place elsewhere).
const WARNING = { color: '#b45309', fontSize: 13 };
function Votes({ votes, choices, onVote, onWithdraw, disabled: closed, warningFor, notice }) {
  // notice: why there is nothing to vote on (e.g. the scores decide it); shown in place of the form.
  const disabled = closed || Boolean(notice);
  const mine = votes.find((vote) => vote.mine);
  const [choice, setChoice] = useState(mine?.choice || '');
  const [reason, setReason] = useState(mine?.reason || '');
  // The ballot can narrow after the first render (scores arriving, a decision at another club):
  // drop a selection that is no longer offered.
  const offered = Object.keys(choices).join('|');
  useEffect(() => {
    if (choice && !(choice in choices)) setChoice('');
  }, [offered]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      {votes.length ? (
        <ul>{votes.map((vote) => {
          const warning = warningFor?.(vote.choice, vote.voter);
          return (
            <li key={vote.id}><strong>{vote.voter_name || 'Official'}</strong>: {choices[vote.choice] || vote.choice}. {vote.reason}
              {warning && <div style={WARNING}>⚠ {warning}</div>}
            </li>
          );
        })}</ul>
      ) : <p className="muted">No votes yet.</p>}
      {!closed && notice && <p style={{ margin: '6px 0 0' }}><strong>{notice}</strong></p>}
      {/* With the ballot closed by the scores, an admin can still take back a vote cast earlier,
          so it isn't published with the appointment. */}
      {!closed && notice && mine && onWithdraw && (
        <button type="button" className="secondary" style={{ marginTop: 6 }}
          onClick={() => window.confirm('Withdraw your vote? It will be removed, and won\'t be published.') && onWithdraw()}>
          Withdraw my vote
        </button>
      )}
      {!disabled && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 13 }}>Your own vote
            <select value={choice} onChange={(event) => setChoice(event.target.value)} style={{ display: 'block' }}>
              <option value="">Choose…</option>
              {Object.entries(choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label style={{ flex: 1, minWidth: 200, fontSize: 13 }}>Your reason (published)
            <input value={reason} onChange={(event) => setReason(event.target.value)} style={{ display: 'block', width: '100%' }} />
          </label>
          <button type="button" disabled={!choice || !(choice in choices) || !reason.trim()} onClick={() => {
            const warning = choice && choice !== mine?.choice ? warningFor?.(choice, mine?.voter ?? null) : '';
            if (!warning || window.confirm(`${warning}\n\nCast this vote anyway?`)) onVote(choice, reason);
          }}>{mine ? 'Change my vote' : 'Cast my vote'}</button>
          {mine && onWithdraw && (
            <button type="button" className="secondary"
              onClick={() => { if (window.confirm('Withdraw your vote? It will be removed, and won\'t be published.')) { setChoice(''); setReason(''); onWithdraw(); } }}>
              Withdraw my vote
            </button>
          )}
        </div>
      )}
      {!disabled && choice && choice !== mine?.choice && warningFor?.(choice, mine?.voter ?? null) && (
        <p style={{ ...WARNING, margin: '6px 0 0' }}>⚠ {warningFor(choice, mine?.voter ?? null)}</p>
      )}
      {!disabled && (
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
          Casting your vote doesn't decide anything. The team's final decision is recorded separately, below, once everyone has voted.
        </p>
      )}
    </div>
  );
}

// Step: the team's decision, recorded once the votes are in. It is saved, not published:
// "Publish decided…" at the top publishes every decided one and tells the managers.
function Decision({ current, reason: currentReason, choices, votes, onDecide, onClear, subject, published, majorityFor = [], requireVotes = true, defaultChoice = '', defaultReason = '' }) {
  const tally = tallyOf(votes);
  const leading = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
  const [choice, setChoice] = useState(current || leading || defaultChoice);
  const [reason, setReason] = useState(currentReason || defaultReason);
  // The choices can change after the first render (automatic scores arriving, or a decision at
  // another club changing who is free): drop a choice that's no longer offered, and take up the
  // default the scores give when nothing has been chosen.
  const offered = Object.keys(choices).join('|');
  useEffect(() => {
    if (choice && !(choice in choices)) setChoice(defaultChoice in choices ? defaultChoice : '');
    else if (!choice && !current && defaultChoice in choices) setChoice(defaultChoice);
    if (!reason && !currentReason && defaultReason) setReason(defaultReason);
  }, [offered, defaultChoice, defaultReason]); // eslint-disable-line react-hooks/exhaustive-deps
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
      {current && (
        <p>
          <strong>Team decision recorded: {choices[current]}</strong>{currentReason ? `. ${currentReason}` : ''} <span className="muted">(not published yet)</span>
          {onClear && (
            <>
              {' '}
              <button type="button" className="secondary"
                onClick={() => window.confirm(`Clear the team decision for ${subject} (${choices[current]})? Votes are kept.`) && onClear()}>
                Clear decision
              </button>
            </>
          )}
        </p>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: 13 }}>Final team decision
          <select value={choice} disabled={waiting} onChange={(event) => setChoice(event.target.value)} style={{ display: 'block' }}>
            <option value="">Choose…</option>
            {Object.entries(choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label style={{ flex: 1, minWidth: 200, fontSize: 13 }}>The team's reason (published)
          <input value={reason} disabled={waiting} onChange={(event) => setReason(event.target.value)} style={{ display: 'block', width: '100%' }} />
        </label>
        <button type="button" disabled={!choice || !(choice in choices) || Boolean(blocked)}
          onClick={() => window.confirm(`Record the TEAM's final decision for ${subject}: ${choices[choice]}?\n\nThis is not your own vote: it's what the whole admin team has agreed. To vote, use "Your vote" above.`) && onDecide(choice, reason)}>
          {current ? "Change the team's decision" : "Record the team's decision"}
        </button>
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
// usually reappointed unless they ask to move or take a break, so the admin team doesn't score or
// vote. The team can make an exception (full_review) and review any club fully. The rule's hard
// bars (not Gold, misconduct, inactivity) always need a decision, and so does Gold that may have
// run out (goldUnclear below): without Gold the manager can't be reappointed.
const ROUTINE_FROM_DIVISION = 3;
const routineByDefault = (review) => review.took_over_mid_season || review.division >= ROUTINE_FROM_DIVISION;
const isRoutine = (review) => routineByDefault(review) && !review.full_review;
const routineLabel = (review) => (review.took_over_mid_season ? 'took over mid-season' : `Division ${review.division}`);
// Why a routine review can't simply be reappointed, or '' when it can.
const routineBlock = (review, records = {}) => {
  if (records.gold === false) return 'not a Gold member';
  if (records.goldUnclearSince) return 'Gold unclear: reappointed only if the manager renews Gold';
  if (review.misconduct) return 'misconduct recorded';
  if (review.inactive) return 'inactivity recorded';
  if (review.wish === 'move') return 'asks to move to another club';
  if (review.wish === 'break') return 'asks to take a break';
  return '';
};
// Soccer Manager's profile shows 0 days of Gold left both once Gold has run out and during the
// up to 2 days' grace it allows for renewals, while the Manager List keeps the Gold badge. Until
// one or the other changes, an administrator checks; it doesn't count against the manager.
const goldUnclear = (records = {}) => (records.goldUnclearSince
  ? `Gold unclear – check: no days left on the profile since ${new Date(records.goldUnclearSince).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, though the Manager List still shows the badge`
  : '');

// A manager's mid-season spell this season (rules 3.1 and 3.2). From their Soccer Manager profile
// history or entered by the admin team, it's what "this season" is scored on; suggested by the
// sync alone (a club's assignment first seen during the season), it waits for confirmation.
const confirmedSpell = (data, managerId) => {
  const spell = data.inputs[String(managerId)]?.spell;
  return spell?.confirmed ? spell : null;
};
const spellsFor = (data, entries) => Object.fromEntries(entries
  .map(([key, managerId]) => [key, confirmedSpell(data, managerId)]).filter(([, spell]) => spell));
const shortDay = (value) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

function SpellLine({ spell, managerId, name, season, call }) {
  const save = (startedOn, games, points) => call('set_manager_spell',
    { p_manager_id: managerId, p_started_on: startedOn, p_games: games, p_points: points, p_season: season },
    startedOn ? 'Takeover saved. Score again to use it.' : 'Takeover removed. Score again to use the whole season.');
  const edit = (current) => {
    const date = window.prompt(`When did ${name} take over this season? (YYYY-MM-DD)`, current?.startedOn || '');
    if (date === null) return;
    if (!date.trim()) { save(null, null, null); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) { window.alert('Use the format YYYY-MM-DD, for example 2026-08-21.'); return; }
    const record = window.prompt('Their games and points in charge, if Top 100\'s records are wrong (for example "22, 41"). Leave blank to use the records.',
      current?.corrected ? `${current.games}, ${current.points}` : '');
    if (record === null) return;
    const [games, points] = record.split(/[,\s]+/).filter(Boolean).map(Number);
    if (record.trim() && !(Number.isInteger(games) && Number.isInteger(points))) { window.alert('Give the games and points as two whole numbers, for example "22, 41".'); return; }
    save(date.trim(), record.trim() ? games : null, record.trim() ? points : null);
  };
  const record = spell && spell.games !== undefined ? `${spell.games} game${spell.games === 1 ? '' : 's'}, ${spell.points} point${spell.points === 1 ? '' : 's'}` : 'no record found';
  if (spell?.confirmed) {
    return (
      <div className="status">
        Took over {spell.club} on {shortDay(spell.startedOn)}{spell.source === 'profile' ? ' (from their Soccer Manager profile)' : ' (entered by the admin team)'}: {record}{spell.corrected ? ', as corrected by the admin team' : ''}.
        {spell.complete === false ? ' The club\'s earlier games aren\'t all on record, so check this.' : ''}
        {' '}"This season" is scored on these games{spell.games < 10 ? ' (half marks under 10 games)' : ''}.{' '}
        <button type="button" className="secondary" onClick={() => edit(spell)}>Change</button>
      </div>
    );
  }
  if (spell && spell.games > 0) {
    return (
      <div className="muted">
        Possible mid-season takeover: Top 100's records first show {name} at {spell.club} on {shortDay(spell.startedOn)} ({record} since). Not counted until confirmed.{' '}
        <button type="button" className="secondary" onClick={() => save(spell.startedOn, null, null)}>Confirm</button>{' '}
        <button type="button" className="secondary" onClick={() => edit(spell)}>Different date</button>
      </div>
    );
  }
  return <div><button type="button" className="secondary" onClick={() => edit(null)}>Took over mid-season?</button></div>;
}

// The scoring request for the reviews that need scoring, from the inputs on the page.
const reviewScoringConfig = (data, reviews, inputs, newcomers) => ({
  mode: 'review',
  currentSeason: data.season,
  managers: reviews.map((review) => {
    const values = inputs[`r${review.id}`] || {};
    const base = data.inputs[String(review.manager_id)] || {};
    return {
      key: String(review.id), name: review.manager_name, club: review.club_name, display: review.manager_name,
      // Routine reviews are scored for context only: reappointed unless barred (rule 3.1).
      routine: isRoutine(review) || undefined,
      tookOverMidSeason: review.took_over_mid_season || Boolean(confirmedSpell(data, review.manager_id)), gold: base.gold, loginGaps: fieldValue(values, 'loginGaps'),
      inactive: review.inactive || undefined, misconduct: review.misconduct || undefined, standing: review.standing || undefined,
      lastChance: review.last_chance ? 'recorded at an earlier review' : undefined, wish: review.wish || undefined,
    };
  }),
  supply: { newcomers: newcomers.split(',').map((name) => name.trim()).filter(Boolean), leavers: [] },
  spells: spellsFor(data, reviews.map((review) => [String(review.id), review.manager_id])),
  discipline: Object.fromEntries(reviews.map((review) => [String(review.id), { sanctions: teamValue(data, review.manager_id, 'sanctions') || 0 }])),
  activity: Object.fromEntries(reviews.map((review) => {
    const values = { ...(inputs[`r${review.id}`] || {}), community: teamValue(data, review.manager_id, 'community') };
    return [String(review.id), Object.fromEntries(['competitions', 'topManagerDeals', 'running', 'votingPercent', 'community', 'gameWorlds', 'forfeits']
      .map((key) => [key, fieldValue(values, key)]).filter(([, value]) => value !== null))];
  })),
});

function ReviewsTab({ data, inputs, setInputs, call, setMessage, reload }) {
  // The signed-in official's own community and sanctions assessment of a manager.
  const assess = (managerId, own) => call('set_appointment_assessment',
    { p_manager_id: managerId, p_community: own.community, p_sanctions: own.sanctions, p_season: data.season }, 'Your assessment is saved.');
  const round = data.rounds.review;
  const [newcomers, setNewcomers] = useState((round?.inputs?.supply?.newcomers || []).join(', '));
  // A saved result counts only while the review is still the kind it was scored as (routine or
  // full); a review switched since then shows its automatic score until it's scored again.
  const kinds = JSON.stringify(data.reviews.map((review) => [review.id, isRoutine(review)]));
  const saved = useMemo(() => {
    const routineNow = Object.fromEntries(JSON.parse(kinds).map(([id, routine]) => [String(id), routine]));
    return Object.fromEntries((round?.result?.reviews || [])
      .filter((review) => Boolean(review.facts?.routine) === Boolean(routineNow[review.key]))
      .map((review) => [review.key, review]));
  }, [round, kinds]);
  // Every review is scored, routine ones too (for comparison and context; their outcome stays
  // routine: reappointed unless barred).
  const toScore = data.reviews.filter((review) => review.manager_name);
  // Automatic scores from Top 100's records, worked out when the page opens and not saved, so
  // the list shows a score straight away. Score reviews saves the admin team's (with any
  // corrected inputs), and those replace the automatic ones.
  const [auto, setAuto] = useState({});
  const [autoFailed, setAutoFailed] = useState(false);
  // Rescore when anything the scoring reads changes: the clubs, or a review's facts.
  const toScoreKey = JSON.stringify(data.reviews.map((review) => [review.id, review.took_over_mid_season, review.last_chance,
    review.standing, review.misconduct, review.inactive, review.wish, review.division, review.full_review, confirmedSpell(data, review.manager_id)]));
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
  // A full review needs the admin team's votes only when its result says so (rule 3.1): one clear
  // and obvious error (a second chance needs a majority), or a score close to the line. Otherwise
  // the outcome follows the rules: no error means reappointed, with no vote.
  const needsVote = (review) => Boolean(results[String(review.id)]?.vote);
  const isClear = (review) => !isRoutine(review) && Boolean(results[String(review.id)]) && !needsVote(review);
  const open = (review) => review.manager_id && !review.decision && !review.published_at;
  const routineReady = data.reviews.filter((review) => open(review) && isRoutine(review)
    && !routineBlock(review, data.inputs[String(review.manager_id)]));
  // Clear reappointments go in the bulk action only once the admin team's scores are saved,
  // since those are the scores published with the decisions.
  const clearReady = data.reviews.filter((review) => open(review) && isClear(review) && saved[String(review.id)]?.outcome === 'reappoint'
    && !data.inputs[String(review.manager_id)]?.goldUnclearSince);
  const reappointReady = [...routineReady, ...clearReady];
  const reappointRoutine = async () => {
    if (!window.confirm(`Record "Reappoint" for ${reappointReady.length} review(s) (${routineReady.length} routine, ${clearReady.length} with no clear and obvious error)? Nothing is published until you publish the decided reviews.`)) return;
    setMessage('Saving…');
    for (const review of reappointReady) {
      const { error } = await supabase.rpc('decide_appointment_review', {
        p_id: review.id, p_decision: 'reappoint',
        p_reason: isRoutine(review) ? `Reappointed: ${routineLabel(review)}, and no request to move or take a break.` : 'No clear and obvious error: reappointed.',
      });
      if (error) { setMessage(error.message); await reload(); return; }
    }
    await reload();
    setMessage(`${reappointReady.length} review(s) decided: reappoint (not yet published).`);
  };
  const balance = round?.result?.balance;
  const votesFor = (id) => data.votes.filter((vote) => vote.subject_kind === 'review' && vote.subject_id === id);
  // With every club that can still finish in the bottom three loaded, there are many cards:
  // division tabs filter the summary and the cards, and the summary links to each card.
  const [division, setDivision] = useState('all');
  // Published reviews are done: they move to the archive at the bottom, out of the working list.
  const working = data.reviews.filter((review) => !review.published_at);
  const completed = data.reviews.filter((review) => review.published_at);
  const divisions = [...new Set(working.map((review) => review.division))].sort((a, b) => a - b);
  // Most at risk first: certain to finish in the bottom three, then in it now, then the clubs
  // that could still drop into it (most of which will finish clear).
  const clubsIn = (value) => data.clubs.filter((club) => club.division === value).length || 20;
  const risk = (review) => (review.certain === true ? 0 : review.position > clubsIn(review.division) - 3 ? 1 : 2);
  const RISK_LABEL = ['Certain', 'In it now', 'Could'];
  const byRisk = (a, b) => a.division - b.division || risk(a) - risk(b) || b.position - a.position;
  const ordered = [...working].sort(byRisk);
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
          misconduct, inactivity). Full reviews with no clear and obvious error are reappointed with no vote either: the
          admin team votes only where the score shows one error (a second chance, which needs a majority) or a score
          close to the line. Lists run most at risk first. <strong>Reappoint routine and clear reviews</strong> records
          those decisions in one go (clear ones once the scores are saved). Any
          club can be an exception: <strong>Review fully</strong> on its card gives it scores, votes and a team decision.
        </p>
        <p className="muted">Decisions stay private until <strong>Publish decided reviews</strong>, which publishes them with the scores, votes and reasons and tells each manager.</p>
        <div className="button-row">
          <button type="button" onClick={() => call('load_appointment_reviews', { p_season: data.season }, 'Bottom three loaded.')}>{data.reviews.length ? 'Refresh the clubs' : 'Load the clubs'}</button>
          <label>Newcomers waiting <input value={newcomers} onChange={(event) => setNewcomers(event.target.value)} placeholder="Names, comma separated" /></label>
          <button type="button" disabled={!toScore.length || Boolean(round?.published_at)} onClick={runScoring}>Score reviews ({toScore.length})</button>
          <button type="button" disabled={!reappointReady.length} onClick={reappointRoutine}>Reappoint routine and clear reviews ({reappointReady.length})</button>
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
      {working.length > 0 && (
        <section className="card" id="review-summary">
          <div className="button-row" style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--surface, #fff)', padding: '8px 0' }}>
            <button type="button" className={division === 'all' ? '' : 'secondary'} onClick={() => setDivision('all')}>All ({working.length})</button>
            {divisions.map((value) => (
              <button type="button" key={value} className={division === value ? '' : 'secondary'} onClick={() => setDivision(value)}>
                D{value} ({working.filter((review) => review.division === value).length})
              </button>
            ))}
          </div>
          {divisions.filter((value) => division === 'all' || value === division).map((value) => (
            <div key={value} style={{ overflowX: 'auto' }}>
              <h3 id={`division-${value}`}>Division {value}</h3>
              <table style={{ fontSize: 13, width: '100%' }}>
                <thead><tr><th>Pos</th><th style={{ textAlign: 'left' }}>Club</th><th style={{ textAlign: 'left' }}>Manager</th><th>Pts</th><th>Bottom three</th><th>Mid-season</th><th>Wants</th><th>Review</th><th title="Review score (rule 3.1), out of 100: this season's result, record, activity and conduct. Not the appointment score (3.2) shown in Manager Rankings and on applications.">Review score /100</th><th>Votes</th><th>Decision</th></tr></thead>
                <tbody>
                  {ordered.filter((review) => review.division === value).map((review) => {
                    const result = results[String(review.id)];
                    return (
                      <tr key={review.id} style={risk(review) === 2 ? { opacity: 0.6 } : undefined}>
                        <td>{ordinal(review.position)}</td>
                        <td style={{ textAlign: 'left' }}><a href={`#review-${review.id}`}>{review.club_name}</a></td>
                        <td style={{ textAlign: 'left' }}>{review.manager_name || '–'}</td>
                        <td>{review.points ?? '–'}</td>
                        <td>{risk(review) < 2 ? <strong>{RISK_LABEL[risk(review)]}</strong> : RISK_LABEL[2]}</td>
                        <td>
                          <input type="checkbox" style={BOX} disabled={Boolean(review.published_at)} checked={review.took_over_mid_season}
                            aria-label={`${review.club_name}: took over mid-season`}
                            onChange={(event) => call('update_appointment_review', { p_id: review.id, p_fields: { tookOverMidSeason: event.target.checked } }, 'Saved.')} />
                        </td>
                        <td>{review.wish || '–'}</td>
                        <td>{isRoutine(review)
                          ? (routineBlock(review, data.inputs[String(review.manager_id)]) ? <strong>Decide: {routineBlock(review, data.inputs[String(review.manager_id)])}</strong> : 'Routine')
                          : !results[String(review.id)] ? (routineByDefault(review) ? 'Full (exception)' : 'Full')
                            : needsVote(review) ? <strong>Vote: {results[String(review.id)].outcome === 'secondChance' ? 'second chance' : 'close score'}</strong>
                              : `Clear: ${OUTCOMES[results[String(review.id)].outcome].toLowerCase()}`}</td>
                        <td>{result ? (isRoutine(review)
                          ? <span className="muted" title="Routine review: score for context only">{result.total} <span>context</span></span>
                          : <>{result.total}{isAuto(review.id) ? <span className="muted"> auto</span> : ''}{result.vote ? ' (vote)' : ''}</>)
                          : autoFailed ? '–' : '…'}</td>
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
      {ordered.map((review) => {
        const result = results[String(review.id)];
        const key = `r${review.id}`;
        const subject = `${review.club_name} (${review.manager_name || 'no manager'})`;
        const clear = () => call('decide_appointment_review', { p_id: review.id, p_decision: null, p_reason: null }, 'Team decision cleared.');
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
              {goldUnclear(data.inputs[String(review.manager_id)]) && <p className="status">{goldUnclear(data.inputs[String(review.manager_id)])}.</p>}
              {review.manager_id && !review.published_at && (
                <SpellLine spell={data.inputs[String(review.manager_id)]?.spell} managerId={review.manager_id} name={review.manager_name} season={data.season} call={call} />
              )}
              <ReviewFacts review={review} onSave={(fields) => call('update_appointment_review', { p_id: review.id, p_fields: fields }, 'Saved.')} />
            </div>

            {isRoutine(review) ? (
              <div style={DECISION_STEP}>
                <h4 style={STEP_TITLE}>Routine review: {routineLabel(review)}<span style={DECISION_TAG}>Final · recorded once for the team</span></h4>
                {!review.published_at && !review.decision && (
                  <p style={{ marginTop: 0 }}>
                    <button type="button" className="secondary" onClick={() => call('update_appointment_review', { p_id: review.id, p_fields: { fullReview: true } }, 'This club now has a full review.')}>
                      Review fully (exception)
                    </button>
                  </p>
                )}
                {routineBlock(review, data.inputs[String(review.manager_id)])
                  ? <p><strong>Needs a decision: {routineBlock(review, data.inputs[String(review.manager_id)])}.</strong> No scoring or votes needed unless the team wants them.</p>
                  : <p className="muted" style={{ marginTop: 0 }}>Reappointed unless the manager asks to move or take a break. No votes needed: record it here, or use Reappoint routine reviews at the top for all of them.</p>}
                {result && (
                  <p className="muted">
                    For context only, the review score (rule 3.1): <strong>{result.total}</strong> out of 100 (result {result.breakdown.result} · record {result.breakdown.record} · activity {result.breakdown.activity} · conduct {result.breakdown.conduct}
                    {isAuto(review.id) ? '; automatic, from Top 100\'s records' : ''}).
                    {result.errors?.length ? ` A full review would find: ${result.errors.map((error) => error.text).join('; ')}.` : ' A full review would find no clear and obvious error.'}
                  </p>
                )}
                <Decision current={review.decision} reason={review.decision_reason} choices={OUTCOMES} votes={votesFor(review.id)} requireVotes={false}
                  defaultChoice={review.wish === 'move' ? 'anotherClub' : review.wish === 'break' ? 'leave'
                    : routineBlock(review, data.inputs[String(review.manager_id)]) ? '' : 'reappoint'}
                  defaultReason={`${routineLabel(review)[0].toUpperCase()}${routineLabel(review).slice(1)}.`}
                  published={Boolean(review.published_at)} subject={subject}
                  onClear={clear}
                  onDecide={(decision, reason) => call('decide_appointment_review', { p_id: review.id, p_decision: decision, p_reason: reason }, 'Team decision saved (not yet published).')} />
              </div>
            ) : (<>
            {routineByDefault(review) && !review.published_at && (
              <p className="status" style={{ ...STEP }}>
                Full review by exception ({routineLabel(review)} would usually be routine).{' '}
                <button type="button" className="secondary" onClick={() => call('update_appointment_review', { p_id: review.id, p_fields: { fullReview: false } }, 'Back to a routine review.')}>Make routine again</button>
              </p>
            )}
            <div style={STEP}>
              <h4 style={STEP_TITLE}>2 · Scoring inputs</h4>
              <InputsEditor values={inputs[key] || {}} records={data.inputs[String(review.manager_id)] || {}} disabled={Boolean(review.published_at)}
                onChange={(values) => setInputs({ ...inputs, [key]: values })}
                assessment={data.assessments?.[String(review.manager_id)]} onAssess={(own) => assess(review.manager_id, own)} />
            </div>

            <div style={STEP}>
              <h4 style={STEP_TITLE}>3 · Review score</h4>
              {result ? (
                <>
                  {isAuto(review.id) && <p className="muted" style={{ marginTop: 0 }}>Automatic, from Top 100's records. Score reviews saves the admin team's score with any corrected inputs.</p>}
                  <p>
                    Review score (rule 3.1): <strong>{result.total}</strong> out of 100 (result {result.breakdown.result} · record {result.breakdown.record} · activity {result.breakdown.activity} · conduct {result.breakdown.conduct}).
                    Suggested: <strong>{OUTCOMES[result.outcome]}</strong>{result.vote ? ' · close: the admin team should vote' : ''}.
                  </p>
                  <p className="muted">{result.reason}</p>
                </>
              ) : <p className="muted">{autoFailed ? 'The automatic score could not be worked out: use Score reviews at the top.' : 'Working out the automatic score…'}</p>}
            </div>

            {isClear(review) && !review.published_at && (
              <p style={{ ...STEP }}>
                <strong>No vote needed.</strong> {result.outcome === 'reappoint' ? 'No clear and obvious error, so the manager is reappointed (rule 3.1).' : 'The rules decide this outcome (rule 3.1).'}
                {' '}Record the decision below{result.outcome === 'reappoint' ? ', or use Reappoint routine and clear reviews at the top once the scores are saved' : ''}.
              </p>
            )}
            <div style={VOTE_STEP} hidden={isClear(review)}>
              <h4 style={STEP_TITLE}>4 · Votes<span style={VOTE_TAG}>Each admin, individually</span></h4>
              <p className="muted" style={{ marginTop: 0 }}>Every admin casts their own vote, with a reason. Votes and reasons are published with the decision.</p>
              <Votes votes={votesFor(review.id)} choices={OUTCOMES} disabled={Boolean(review.published_at)}
                onVote={(choice, reason) => call('cast_appointment_vote', { p_subject_kind: 'review', p_subject_id: review.id, p_choice: choice, p_reason: reason }, 'Vote recorded.')}
                onWithdraw={() => call('withdraw_appointment_vote', { p_subject_kind: 'review', p_subject_id: review.id }, 'Vote withdrawn.')} />
            </div>

            <div style={DECISION_STEP}>
              <h4 style={STEP_TITLE}>5 · Team decision<span style={DECISION_TAG}>Final · recorded once for the team</span></h4>
              <p className="muted" style={{ marginTop: 0 }}>{isClear(review) ? 'Not a vote. One admin records the outcome the rules give.' : 'Not a vote. Once everyone has voted, one admin records what the team decided.'} It isn't published until you publish the decided reviews.</p>
              <Decision key={isClear(review) ? `clear:${result.outcome}` : 'vote'} current={review.decision} reason={review.decision_reason} choices={OUTCOMES} votes={votesFor(review.id)} majorityFor={['secondChance']}
                requireVotes={!isClear(review)} defaultChoice={isClear(review) ? result.outcome : ''}
                defaultReason={isClear(review) && result.outcome === 'reappoint' ? 'No clear and obvious error: reappointed.' : ''}
                published={Boolean(review.published_at)} subject={subject} onClear={clear}
                onDecide={(decision, reason) => call('decide_appointment_review', { p_id: review.id, p_decision: decision, p_reason: reason }, 'Team decision saved (not yet published).')} />
            </div>
            </>)}
          </section>
        );
      })}
      {completed.length > 0 && (
        <section className="card">
          <details>
            <summary><strong>Archive: completed reviews ({completed.length})</strong> <span className="muted">published, with the manager told</span></summary>
            <table style={{ fontSize: 13, width: '100%', marginTop: 8 }}>
              <thead><tr><th>Div</th><th>Pos</th><th style={{ textAlign: 'left' }}>Club</th><th style={{ textAlign: 'left' }}>Manager</th><th style={{ textAlign: 'left' }}>Decision</th><th>Published</th></tr></thead>
              <tbody>{[...completed].sort(byRisk).map((review) => (
                <tr key={review.id}>
                  <td>D{review.division}</td><td>{ordinal(review.position)}</td>
                  <td style={{ textAlign: 'left' }}>{review.club_name}</td><td style={{ textAlign: 'left' }}>{review.manager_name || '–'}</td>
                  <td style={{ textAlign: 'left' }}><strong>{OUTCOMES[review.decision]}</strong>{review.decision_reason ? `. ${review.decision_reason}` : ''}</td>
                  <td>{when(review.published_at)}</td>
                </tr>
              ))}</tbody>
            </table>
          </details>
        </section>
      )}
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
  // The signed-in official's own community and sanctions assessment of a manager.
  const assess = (managerId, own) => call('set_appointment_assessment',
    { p_manager_id: managerId, p_community: own.community, p_sanctions: own.sanctions, p_season: data.season }, 'Your assessment is saved.');
  const round = data.rounds.vacancies;
  const vacancies = data.vacancies.filter((vacancy) => vacancy.status !== 'withdrawn');
  const applications = data.applications.filter((application) => application.status === 'active');
  const clubName = (id) => data.vacancies.find((vacancy) => vacancy.id === id)?.club_name || `#${id}`;
  const applicantName = Object.fromEntries(applications.map((application) => [String(application.manager_id), application.managerName]));
  const savedResult = round?.result;
  // Applications made or changed since the last scoring aren't in its result: flag them so the
  // team scores again before relying on the rankings or the suggested appointments.
  // Compared with the preferences the scoring actually used (saved with its inputs), so a change made
  // while scoring was running is still caught.
  const scoredKeys = new Set((savedResult?.applicants || []).map((applicant) => String(applicant.key)));
  const scoredPreferences = round?.inputs?.preferences || {};
  const isUnscored = (application) => {
    if (!round) return false;
    const key = String(application.manager_id);
    if (!scoredKeys.has(key)) return true;
    const used = scoredPreferences[key];
    const now = application.preferences.map(clubName);
    return !Array.isArray(used) || used.length !== now.length || used.some((club, index) => club !== now[index]);
  };
  const unscored = applications.filter(isUnscored);

  // Vacancies (or their comparison managers) added or changed since the last scoring.
  const vacancySignature = (list) => JSON.stringify(list.map((vacancy) => [vacancy.club, vacancy.division]).sort());
  const vacanciesChanged = Boolean(round) && vacancySignature(round.inputs?.vacancies || [])
    !== vacancySignature(vacancies.map((vacancy) => ({ club: vacancy.club_name, division: vacancy.division })));
  const comparisonsChanged = Boolean(round) && vacancies.some((vacancy) => vacancy.comparison_manager
    && !(savedResult?.comparisons || []).some((entry) => entry.key === `${COMPARISON}${vacancy.id}` && entry.display === vacancy.comparison_manager));

  const buildConfig = () => {
    const keyOf = (application) => String(application.manager_id);
    // Each vacancy's outgoing (or previous) manager is scored alongside, for comparison only:
    // with no preferences they are never allocated, and the scores are kept out of what is published.
    const comparisons = vacancies.filter((vacancy) => vacancy.comparison_manager).map((vacancy) => {
      const stillThere = data.clubs.some((club) => club.club === vacancy.club_name && club.manager === vacancy.comparison_manager);
      return { key: `${COMPARISON}${vacancy.id}`, managerId: vacancy.comparisonManagerId, name: vacancy.comparison_manager, club: stillThere ? vacancy.club_name : undefined, seasonClub: vacancy.club_name, display: vacancy.comparison_manager };
    });
    // A comparison manager's inputs: as edited if they are also applying, otherwise Top 100's records.
    const comparisonInputs = (comparison) => (comparison.managerId ? inputs[`a${comparison.managerId}`] || data.inputs[String(comparison.managerId)] || {} : {});
    // Community and sanctions: the team average of the officials' own assessments.
    const scoringValues = (managerId, values) => ({ ...values, community: teamValue(data, managerId, 'community'), sanctions: teamValue(data, managerId, 'sanctions') });
    const config = {
      mode: 'vacancies',
      currentSeason: data.season,
      vacancies: vacancies.map((vacancy) => ({ club: vacancy.club_name, division: vacancy.division })),
      applicants: [
        ...applications.map((application) => ({ key: keyOf(application), name: application.managerName, club: application.club, display: application.managerName })),
        // seasonClub: a comparison manager who has left is credited with the club's season so far.
        ...comparisons.map(({ key, name, club, display, seasonClub }) => ({ key, name, club, display, seasonClub })),
      ],
      spells: spellsFor(data, applications.map((application) => [keyOf(application), application.manager_id])),
      preferences: Object.fromEntries([
        ...applications.map((application) => [keyOf(application), application.preferences.map(clubName)]),
        ...comparisons.map((comparison) => [comparison.key, []]),
      ]),
      discipline: Object.fromEntries(applications.map((application) => {
        const base = data.inputs[keyOf(application)] || {};
        const values = scoringValues(application.manager_id, inputs[`a${application.manager_id}`] || base);
        return [keyOf(application), { gold: base.gold, openSanction: base.openSanction, sanctions: fieldValue(values, 'sanctions') || 0, forfeits: fieldValue(values, 'forfeits') || 0 }];
      }).concat(comparisons.map((comparison) => {
        const base = data.inputs[String(comparison.managerId)] || {};
        const values = scoringValues(comparison.managerId, comparisonInputs(comparison));
        return [comparison.key, { gold: base.gold, openSanction: base.openSanction, sanctions: fieldValue(values, 'sanctions') || 0, forfeits: fieldValue(values, 'forfeits') || 0 }];
      }))),
      activity: Object.fromEntries(applications.map((application) => {
        const values = scoringValues(application.manager_id, inputs[`a${application.manager_id}`] || {});
        return [keyOf(application), Object.fromEntries(['competitions', 'topManagerDeals', 'running', 'votingPercent', 'community', 'gameWorlds']
          .map((key) => [key, fieldValue(values, key)]).filter(([, value]) => value !== null))];
      }).concat(comparisons.map((comparison) => [comparison.key, Object.fromEntries(['competitions', 'topManagerDeals', 'running', 'votingPercent', 'community', 'gameWorlds']
        .map((key) => [key, fieldValue(scoringValues(comparison.managerId, comparisonInputs(comparison)), key)]).filter(([, value]) => value !== null))]))),
    };
    return config;
  };

  const scoreConfig = async (config) => {
    const scored = await score(config);
    const isComparison = (key) => String(key).startsWith(COMPARISON);
    return {
      ...scored,
      applicants: scored.applicants.filter((applicant) => !isComparison(applicant.key)),
      comparisons: scored.applicants.filter((applicant) => isComparison(applicant.key)),
      allocation: { ...scored.allocation, unplaced: (scored.allocation.unplaced || []).filter((key) => !isComparison(key)) },
    };
  };

  // Like the reviews: whenever there's no saved scoring, or applications or vacancies have changed
  // since it, the page works out the scores automatically from Top 100's records and shows those.
  // Score applicants saves the admin team's scoring (with any corrected inputs), which replaces them.
  const needsAuto = !round?.published_at && applications.length > 0 && vacancies.length > 0
    && (!round || unscored.length > 0 || vacanciesChanged || comparisonsChanged);
  const [auto, setAuto] = useState(null);
  const [autoFailed, setAutoFailed] = useState(false);
  const autoKey = JSON.stringify([needsAuto, applications.map((application) => [application.manager_id, application.preferences]),
    vacancies.map((vacancy) => [vacancy.id, vacancy.club_name, vacancy.division, vacancy.comparison_manager]),
    // The team's community and sanctions assessments, and confirmed mid-season spells, feed the scores too.
    data.assessments || null, applications.map((application) => confirmedSpell(data, application.manager_id))]);
  useEffect(() => {
    setAuto(null);
    setAutoFailed(false);
    if (!needsAuto) return undefined;
    let active = true;
    scoreConfig(buildConfig())
      .then((scored) => { if (active) setAuto(scored); })
      .catch(() => { if (active) setAutoFailed(true); });
    return () => { active = false; };
  }, [autoKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const isAuto = needsAuto && Boolean(auto);
  const result = isAuto ? auto : savedResult;

  const runScoring = async () => {
    const config = buildConfig();
    setMessage('Scoring…');
    try {
      // Each applicant's choices go with the scores, so the published decisions can show each
      // club's own applicants (comparison managers have none and are left out).
      const result = { ...(await scoreConfig(config)),
        preferences: Object.fromEntries(Object.entries(config.preferences).filter(([key]) => !String(key).startsWith(COMPARISON))) };
      await call('save_appointment_round', { p_kind: 'vacancies', p_inputs: { ...config, edited: own(inputs, 'a') }, p_result: result, p_season: data.season }, 'Scored.');
    } catch (error) {
      setMessage(error.message);
    }
  };

  // A finished round (decisions published, or vacancies withdrawn) is archived before the next
  // one, since a season holds one round of scores at a time.
  const archivable = data.vacancies.filter((vacancy) => vacancy.published_at || vacancy.status === 'withdrawn');
  const unpublished = data.vacancies.some((vacancy) => vacancy.decided_at && !vacancy.published_at);
  const archiveBlock = !archivable.length ? ''
    : unpublished ? 'Publish the decided vacancies before archiving this round.'
      : round && !round.published_at ? 'Publish this round\'s decisions before archiving it.' : '';
  const canArchive = archivable.length > 0 && !archiveBlock;
  const archives = data.archives || [];

  // Rule 3.2: the scores appoint, unless applicants for the same club are within five points, when
  // the admin team votes between them. So for each club the vote is open only to the applicant the
  // scores appoint and those within five points of them who could still take the club: eligible,
  // and not placed by the scores at a club they prefer. Returns null when the scores can't settle
  // it yet (no scores, or an applicant for the club not scored), and then anyone may be voted for.
  // The rule's allocation (the archive's allocateVacancies), re-run here with the team's recorded
  // decisions at other clubs fixed: each round, every applicant still free points at their
  // most-preferred open club they are eligible for, and the highest score among those is appointed.
  const scoredFor = (managerId, club) => result?.applicants?.find((applicant) => applicant.key === String(managerId))?.byVacancy?.[club];
  const allocate = (exceptClub) => {
    const fixed = vacancies.filter((vacancy) => vacancy.appointed_manager_id && vacancy.club_name !== exceptClub);
    const open = new Set(vacancies.filter((vacancy) => !fixed.includes(vacancy)).map((vacancy) => vacancy.club_name));
    const taken = new Set(fixed.map((vacancy) => String(vacancy.appointed_manager_id)));
    const waiting = new Set(applications.map((application) => String(application.manager_id)).filter((id) => !taken.has(id)));
    const appointments = fixed.map((vacancy) => ({ club: vacancy.club_name, manager: String(vacancy.appointed_manager_id) }));
    const choiceFor = (id) => applications.find((application) => String(application.manager_id) === id).preferences.map(clubName)
      .find((club) => open.has(club) && scoredFor(id, club)?.eligibility?.eligible);
    for (;;) {
      const bids = [...waiting].map((id) => ({ id, club: choiceFor(id) })).filter((bid) => bid.club)
        .map((bid) => ({ ...bid, scored: scoredFor(bid.id, bid.club) }))
        .sort((x, y) => y.scored.total - x.scored.total || y.scored.breakdown.current - x.scored.breakdown.current);
      if (!bids.length) break;
      open.delete(bids[0].club);
      waiting.delete(bids[0].id);
      appointments.push({ club: bids[0].club, manager: bids[0].id, score: bids[0].scored.total });
    }
    return appointments;
  };
  // Rule 3.2: the scores appoint, unless applicants for the same club are within five points, when
  // the admin team votes between them. So the vote at a club is open only to the applicant the
  // scores appoint there and those within five points of them who could still take it: eligible,
  // and not placed by the scores at a club they prefer. Returns null when the scores can't settle
  // it yet (no scores, or an applicant for the club not scored), and then anyone may be voted for.
  const contendersFor = (vacancy) => {
    const applying = applications.filter((application) => application.preferences.includes(vacancy.id));
    if (!result || applying.some((application) => !scoredFor(application.manager_id, vacancy.club_name) || (isUnscored(application) && !isAuto))) return null;
    const appointments = allocate(vacancy.club_name);
    const placedAt = Object.fromEntries(appointments.map((item) => [item.manager, item.club]));
    const rank = (application, club) => application.preferences.map(clubName).indexOf(club);
    // Managers the team has already appointed at another club are taken, whatever their preferences.
    const decidedElsewhere = new Set(vacancies.filter((other) => other.appointed_manager_id && other.club_name !== vacancy.club_name)
      .map((other) => String(other.appointed_manager_id)));
    const free = applying.filter((application) => {
      if (!scoredFor(application.manager_id, vacancy.club_name).eligibility?.eligible) return false;
      if (decidedElsewhere.has(String(application.manager_id))) return false;
      const at = placedAt[String(application.manager_id)];
      return !at || at === vacancy.club_name || rank(application, vacancy.club_name) < rank(application, at);
    });
    const appointed = appointments.find((item) => item.club === vacancy.club_name);
    const scoreOf = (application) => scoredFor(application.manager_id, vacancy.club_name).total;
    const top = appointed ? appointed.score : Math.max(...free.map(scoreOf));
    // Within five points either way: an applicant freed late can score above the one the scores appoint.
    const within = free.filter((application) => Math.abs(top - scoreOf(application)) <= 5 + 1e-9);
    return { appointed: appointed ? applicantName[appointed.manager] || appointed.manager : null, placedAt,
      names: within.map((application) => application.managerName), ids: within.map((application) => String(application.manager_id)) };
  };
  // Clubs still to be decided where the scores leave a vote between applicants who also applied
  // here: that vote's outcome can change who is free to take this club.
  const contested = (here) => {
    const applyingHere = new Set(applications.filter((application) => application.preferences.includes(here.id)).map((application) => application.managerName));
    return vacancies.filter((vacancy) => vacancy.id !== here.id && !vacancy.appointed_manager_id && !vacancy.published_at)
      .filter((vacancy) => { const names = contendersFor(vacancy)?.names || []; return names.length > 1 && names.some((name) => applyingHere.has(name)); })
      .map((vacancy) => vacancy.club_name);
  };
  const contenderNotice = (vacancy, contenders) => {
    if (!contenders) return '';
    const pending = contested(vacancy);
    const after = pending.length ? ` This can change once the team decides ${pending.join(' and ')}.` : '';
    if (!contenders.names.length) return `No eligible applicant is free to take this club under the scores (rule 3.2), so there is nothing to vote on.${after}`;
    if (contenders.names.length === 1) return `The scores appoint ${contenders.names[0]}: no other applicant who could take this club is within five points (rule 3.2), so there is no vote.${after}`;
    return '';
  };

  // A vote for an applicant who can't end up at this club as things stand: the same official
  // backs them at another open club (each manager takes one club), or the scores rule them out.
  const openVacancyIds = new Set(vacancies.filter((vacancy) => !vacancy.published_at).map((vacancy) => vacancy.id));
  const vacancyVoteWarning = (vacancy, name, voter) => {
    const notes = [];
    // voter is null for an official who hasn't voted on this club yet: their votes elsewhere are "mine".
    const sameVoter = (vote) => (voter ? vote.voter === voter : vote.mine);
    const elsewhere = data.votes.filter((vote) => vote.subject_kind === 'vacancy' && vote.subject_id !== vacancy.id
      && openVacancyIds.has(vote.subject_id) && vote.choice === name && sameVoter(vote)).map((vote) => clubName(vote.subject_id));
    if (elsewhere.length) notes.push(`${voter ? 'This official' : 'You'} also voted for ${name} at ${elsewhere.join(' and ')}; a manager can only take one club.`);
    const contenders = contendersFor(vacancy);
    if (contenders && !contenders.names.includes(name)) {
      const application = applications.find((item) => item.managerName === name);
      const placed = application && contenders.placedAt[String(application.manager_id)];
      notes.push(`Not open to a vote under rule 3.2${placed && placed !== vacancy.club_name ? `: the scores place ${name} at ${placed}, which they prefer`
        : contenders.appointed ? `: more than five points from ${contenders.appointed}` : ''}. This vote doesn't count.`);
    }
    return notes.join(' ');
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
              {vacancy.context ? ` · ${vacancy.context}` : ''}
              {` · compared with ${vacancy.comparison_manager || 'nobody'}`}{' '}
              {!vacancy.published_at && <button type="button" className="secondary" onClick={() => {
                const name = window.prompt(`Compare ${vacancy.club_name} applicants with which manager (the outgoing or previous manager)?`, vacancy.comparison_manager || '');
                if (name !== null) call('set_appointment_vacancy_comparison', { p_id: vacancy.id, p_manager: name }, 'Comparison saved. Score applicants again to update it.');
              }}>Change comparison</button>}{' '}
              {!vacancy.published_at && vacancy.status === 'open' && <button type="button" className="secondary" onClick={() => call('set_appointment_vacancy_status', { p_id: vacancy.id, p_status: 'closed' }, 'Closed.')}>Close</button>}
              {!vacancy.published_at && vacancy.status === 'closed' && !vacancy.decided_at && <button type="button" className="secondary" onClick={() => call('set_appointment_vacancy_status', { p_id: vacancy.id, p_status: 'open' }, 'Reopened.')}>Reopen</button>}
              {!vacancy.published_at && vacancy.status !== 'withdrawn' && !vacancy.decided_at && <> <button type="button" className="secondary" onClick={() => call('set_appointment_vacancy_status', { p_id: vacancy.id, p_status: 'withdrawn' }, 'Withdrawn.')}>Withdraw</button></>}
              {/* Rule 3.2: the appointee confirms within 24 hours. One who declines a published appointment is recorded here. */}
              {vacancy.published_at && vacancy.appointed_manager_id && <button type="button" className="secondary" onClick={() => {
                const note = window.prompt(`Record that ${vacancy.appointedManager || 'the appointee'} declined ${vacancy.club_name}?\n\nThe decision stays published, marked as declined, and ${vacancy.club_name} can go into the next round. Optional note for the public page (e.g. "Prefers to stay at Sunderland."):`, '');
                if (note !== null) call('record_appointment_declined', { p_id: vacancy.id, p_note: note }, `Recorded: the appointee declined ${vacancy.club_name}. Archive this round, then add ${vacancy.club_name} to the next one.`);
              }}>Appointee declined</button>}
              {vacancy.declined_at && <span className="status"> · appointee declined {when(vacancy.declined_at)}</span>}
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
          <button type="button" className="secondary" disabled={!canArchive} title="Move this round's published and withdrawn vacancies to the archive, so a new round can start"
            onClick={() => window.confirm(`Archive this round? ${archivable.map((vacancy) => vacancy.club_name).join(', ')} move to the archive with their applications and scores, and stay on the public page as an earlier round. Open vacancies stay, and the next round starts fresh.`)
              && call('archive_appointment_round', { p_season: data.season }, 'Round archived. Add the next round\'s vacancies.')}>
            Archive this round
          </button>
        </div>
        {archiveBlock && <p className="muted">{archiveBlock}</p>}
        {round && <p className="muted">Last scored {when(round.scored_at)}{round.published_at ? `, published ${when(round.published_at)}` : ''}.</p>}
        {needsAuto && (
          <p className="status" role="status">
            {isAuto ? 'The scores below are automatic, from Top 100\'s records' : autoFailed ? 'The automatic scores could not be worked out' : 'Working out the scores automatically…'}
            {unscored.length > 0 ? ` (${unscored.length} application${unscored.length === 1 ? '' : 's'} new or changed since the last saved scoring: ${unscored.map((application) => application.managerName).join(', ')})` : ''}
            {vacanciesChanged || comparisonsChanged ? `${unscored.length > 0 ? ',' : ''} with vacancies changed since the last saved scoring` : ''}.
            {' '}Check the scoring inputs, then Score applicants to save the admin team's scores.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Applications ({applications.length})</h2>
        {applications.map((application) => (
          <div key={application.id} style={{ marginBottom: 12 }}>
            <strong>{application.managerName}</strong> ({application.club}, D{application.clubDivision} {ordinal(application.clubPosition)}): {application.preferences.map(clubName).join(' → ')}
            {isUnscored(application) && <span className="status" style={{ marginLeft: 8 }}>{isAuto ? 'Automatic score' : 'Not yet scored'}</span>}
            {application.note && <div className="muted">“{application.note}”</div>}
            {data.inputs[String(application.manager_id)]?.gold === false && <div className="status">Not a Gold member.</div>}
            {goldUnclear(data.inputs[String(application.manager_id)]) && <div className="status">{goldUnclear(data.inputs[String(application.manager_id)])}.</div>}
            <SpellLine spell={data.inputs[String(application.manager_id)]?.spell} managerId={application.manager_id} name={application.managerName} season={data.season} call={call} />
            <details>
              <summary>Scoring inputs (from Top 100's records; check and fill in before scoring)</summary>
              <InputsEditor fields={INPUT_FIELDS.filter(({ key }) => key !== 'loginGaps')} values={inputs[`a${application.manager_id}`] || {}}
                records={data.inputs[String(application.manager_id)] || {}}
                onChange={(values) => setInputs({ ...inputs, [`a${application.manager_id}`]: values })}
                assessment={data.assessments?.[String(application.manager_id)]} onAssess={(own) => assess(application.manager_id, own)} />
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
        // Applicants for this club the last scoring didn't include (or include as they now stand).
        const rankedKeys = new Set(ranking.map(({ applicant }) => String(applicant.key)));
        const notScored = applications.filter((application) => application.preferences.includes(vacancy.id)
          && isUnscored(application) && !rankedKeys.has(String(application.manager_id)));
        const comparison = (result?.comparisons || []).find((entry) => entry.key === `${COMPARISON}${vacancy.id}`);
        const comparisonScore = comparison?.byVacancy?.[vacancy.club_name];
        const choices = Object.fromEntries(applications.filter((application) => application.preferences.includes(vacancy.id)).map((application) => [String(application.manager_id), application.managerName]));
        // Vacancy votes are stored by applicant name; the decision is by manager id.
        const voteChoices = Object.fromEntries(Object.values(choices).map((name) => [name, name]));
        const idByName = Object.fromEntries(Object.entries(choices).map(([id, name]) => [name, id]));
        const vacancyVotes = data.votes.filter((vote) => vote.subject_kind === 'vacancy' && vote.subject_id === vacancy.id);
        const contenders = vacancy.published_at ? null : contendersFor(vacancy);
        const openChoices = contenders ? Object.fromEntries(contenders.names.map((name) => [name, name])) : voteChoices;
        const decisionChoices = contenders ? Object.fromEntries(contenders.ids.map((id) => [id, choices[id]])) : choices;
        // Votes for an applicant the scores rule out don't count towards the decision.
        const countedVotes = contenders ? vacancyVotes.filter((vote) => contenders.names.includes(vote.choice)) : vacancyVotes;
        const settled = contenders && contenders.names.length === 1 ? contenders.ids[0] : '';
        return (
          <section className="card" key={vacancy.id}>
            <h3>{vacancy.club_name} (D{vacancy.division})</h3>
            {ranking.length ? (
              <>
              <table>
                <thead><tr><th>Applicant</th><th style={NUM} title="Appointment score (rule 3.2), out of 100">Appointment score /100</th>{SCORE_PARTS.map(([part, label]) => <th key={label} style={NUM} title={SCORE_HELP[part][1]}>{label}</th>)}<th>Eligible</th></tr></thead>
                <tbody>{ranking.map(({ applicant, scored }) => (
                  <tr key={applicant.key}>
                    <td>{applicant.display}{applications.some((application) => String(application.manager_id) === String(applicant.key) && isUnscored(application)) && <div className="muted">Changed since scoring</div>}</td><td style={NUM}><strong>{scored.total}</strong></td>
                    {SCORE_PARTS.map(([part]) => <td key={part} style={NUM}>{scored.breakdown[part]}</td>)}
                    <td>{scored.eligibility.eligible ? 'Yes' : scored.eligibility.reasons.join(' ')}</td>
                  </tr>
                ))}
                {notScored.map((application) => (
                  <tr key={`unscored-${application.id}`}>
                    <td>{application.managerName}</td>
                    <td colSpan={SCORE_PARTS.length + 2} className="muted">Not yet scored: applied or changed their application after the last scoring.</td>
                  </tr>
                ))}
                {comparisonScore && (
                  <tr className="muted" style={{ fontStyle: 'italic' }}>
                    <td>{comparison.display} (outgoing, for comparison)</td><td style={NUM}>{comparisonScore.total}</td>
                    {SCORE_PARTS.map(([part]) => <td key={part} style={NUM}>{comparisonScore.breakdown[part]}</td>)}
                    <td>Not applying</td>
                  </tr>
                )}</tbody>
              </table>
              <details style={{ marginTop: 8 }}>
                <summary>How each score is worked out</summary>
                <dl style={{ margin: '8px 0 0' }}>
                  {SCORE_PARTS.map(([part]) => (
                    <div key={part} style={{ marginBottom: 8 }}><dt style={{ fontWeight: 700 }}>{SCORE_HELP[part][0]}</dt><dd style={{ margin: 0 }} className="muted">{SCORE_HELP[part][1]}</dd></div>
                  ))}
                </dl>
              </details>
              </>
            ) : (
              <p className="muted">
                {result ? 'No applicants scored for this club.' : 'Not scored yet.'}
                {notScored.length > 0 && ` Not yet scored: ${notScored.map((application) => application.managerName).join(', ')}.`}
              </p>
            )}
            <div style={VOTE_STEP}>
              <h4 style={STEP_TITLE}>Votes<span style={VOTE_TAG}>Each admin, individually</span></h4>
              <p className="muted" style={{ marginTop: 0 }}>Every admin casts their own vote for an applicant, with a reason. Rule 3.2 asks for a vote where applicants are within five points; those votes and reasons are published with the appointment.</p>
              <Votes votes={vacancyVotes} disabled={Boolean(vacancy.published_at)} choices={openChoices}
                notice={contenderNotice(vacancy, contenders)}
                warningFor={(name, voter) => vacancyVoteWarning(vacancy, name, voter)}
                onVote={(choice, reason) => call('cast_appointment_vote', { p_subject_kind: 'vacancy', p_subject_id: vacancy.id, p_choice: choice, p_reason: reason }, 'Vote recorded.')}
                onWithdraw={() => call('withdraw_appointment_vote', { p_subject_kind: 'vacancy', p_subject_id: vacancy.id }, 'Vote withdrawn.')} />
              {vacancy.published_at ? (
                <p className="muted" style={{ margin: '8px 0 0', fontSize: 13 }}>{vacancy.publish_votes === false ? 'These votes were not published.' : 'These votes were published with the appointment.'}</p>
              ) : (
                <label style={{ ...INLINE, marginTop: 8, fontSize: 13 }}>
                  <input type="checkbox" style={BOX} checked={vacancy.publish_votes !== false}
                    onChange={(event) => call('set_appointment_vacancy_votes_published', { p_id: vacancy.id, p_publish: event.target.checked },
                      event.target.checked ? 'These votes will be published with the appointment.' : 'These votes won\'t be published.')} />
                  Publish these votes and reasons with the appointment (untick if this club didn't need a vote)
                </label>
              )}
            </div>
            <div style={DECISION_STEP}>
              <h4 style={STEP_TITLE}>Team decision<span style={DECISION_TAG}>Final · recorded once for the team</span></h4>
              <p className="muted" style={{ marginTop: 0 }}>Not a vote. Once everyone has voted, one admin records who the team appoints. It isn't published until you publish the decided vacancies.</p>
              {vacancy.decided_at && !vacancy.appointed_manager_id && !vacancy.published_at && (
                <p className="status">Recorded as not filled (a cleared decision). Publishing now would publish it unfilled: record the team's decision first.</p>
              )}
              <Decision current={vacancy.appointed_manager_id ? String(vacancy.appointed_manager_id) : ''} reason={vacancy.decision_reason} published={Boolean(vacancy.published_at)}
                votes={countedVotes.map((vote) => ({ ...vote, choice: idByName[vote.choice] || vote.choice }))}
                requireVotes={!settled} defaultChoice={settled}
                defaultReason={settled ? 'Highest score, with no other applicant within five points (rule 3.2).' : ''}
                choices={{ ...decisionChoices, ...(vacancy.appointed_manager_id ? { [String(vacancy.appointed_manager_id)]: vacancy.appointedManager } : {}) }}
                subject={vacancy.club_name}
                onDecide={(manager, reason) => call('decide_appointment_vacancy', { p_id: vacancy.id, p_manager_id: Number(manager), p_reason: reason }, 'Decision saved (not yet published).')}
                // Releases the manager, so decisions at two clubs can be swapped before publishing.
                onClear={() => call('decide_appointment_vacancy', { p_id: vacancy.id, p_manager_id: null, p_reason: null }, 'Decision cleared. Record the team\'s decision again before publishing.')} />
            </div>
          </section>
        );
      })}
      {archives.length > 0 && (
        <section className="card">
          <details>
            <summary><strong>Archive: earlier rounds ({archives.length})</strong> <span className="muted">still shown on the public page</span></summary>
            {archives.map((archive) => (
              <div key={archive.id} style={{ marginTop: 8 }}>
                <strong>Archived {when(archive.archivedAt)}</strong> <span className="muted">· {archive.applications} application{archive.applications === 1 ? '' : 's'}</span>
                <ul>{archive.vacancies.map((vacancy) => (
                  <li key={vacancy.id}>{vacancy.club} (D{vacancy.division}): {vacancy.appointed ? `appointed ${vacancy.appointed}`
                    : vacancy.declined ? `${vacancy.declined} declined (${when(vacancy.declinedAt)}): add ${vacancy.club} to the next round`
                    : vacancy.status === 'withdrawn' ? 'withdrawn' : 'not filled'}
                    {/* Rule 3.2: the appointee confirms within 24 hours; one who declines is recorded here. */}
                    {vacancy.appointed && vacancy.publishedAt && <> <button type="button" className="secondary" onClick={() => {
                      const note = window.prompt(`Record that ${vacancy.appointed} declined ${vacancy.club}?\n\nThe decision stays published, marked as declined, and ${vacancy.club} can go into the next round. Optional note for the public page (e.g. "Prefers to stay at their club."):`, '');
                      if (note !== null) call('record_appointment_declined', { p_id: vacancy.id, p_note: note }, `Recorded: ${vacancy.appointed} declined ${vacancy.club}. Add ${vacancy.club} as a vacancy in the next round.`);
                    }}>Appointee declined</button></>}
                  </li>
                ))}</ul>
              </div>
            ))}
          </details>
        </section>
      )}
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
    // Saved edits win; an input added since they were saved (such as votingPercent) comes from records.
    return { ...Object.fromEntries(INPUT_FIELDS.map(({ key: field }) => [field, base[field] ?? ''])), ...(saved[key] || {}) };
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

  // Top 100's forfeit counts as last loaded, so a count nobody edited follows the records (a
  // confirmed takeover drops the club's earlier forfeits) while a manual correction stays.
  const recordedForfeits = useRef({});
  const load = useCallback(async () => {
    const { data: loaded, error } = await supabase.rpc('appointment_admin_overview', { p_world_slug: 'top-100' });
    if (error) { setMessage(error.message); return; }
    // A confirmed mid-season takeover (from the manager's profile or entered by the admin team)
    // makes a review a mid-season one, so it's routine unless the team asked for a full review.
    const overview = { ...loaded, reviews: (loaded.reviews || []).map((review) => ({ ...review,
      took_over_mid_season: review.took_over_mid_season || Boolean(loaded.inputs?.[String(review.manager_id)]?.spell?.confirmed) })) };
    const forfeits = Object.fromEntries(Object.entries(overview.inputs || {}).map(([id, values]) => [id, values?.forfeits ?? '']));
    const managerOf = (key) => (key.startsWith('a') ? key.slice(1)
      : String(overview.reviews.find((review) => `r${review.id}` === key)?.manager_id ?? ''));
    setData(overview);
    setInputs((current) => {
      const next = { ...initialInputs(overview), ...current };
      Object.keys(current).forEach((key) => {
        const id = managerOf(key);
        if (id && id in forfeits && String(current[key]?.forfeits ?? '') === String(recordedForfeits.current[id] ?? '')) {
          next[key] = { ...next[key], forfeits: forfeits[id] };
        }
      });
      return next;
    });
    recordedForfeits.current = forfeits;
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
          Bottom-three reviews (rule 3.1), vacancies (rule 3.2) and the waiting list (rule 3.3). Managers state their wishes and apply in{' '}
          <a href="https://manager.smtop100.blog/appointments" style={HERO_LINK}>Manager Portal</a>; published decisions appear at{' '}
          <a href="https://tournaments.smtop100.blog/appointments" style={HERO_LINK}>tournaments.smtop100.blog/appointments</a>.
        </p>
        <div className="button-row">
          <button type="button" className={tab === 'reviews' ? '' : 'secondary'} onClick={() => setTab('reviews')}>Reviews</button>
          <button type="button" className={tab === 'vacancies' ? '' : 'secondary'} onClick={() => setTab('vacancies')}>Vacancies</button>
          <button type="button" className={tab === 'waiting' ? '' : 'secondary'} onClick={() => setTab('waiting')}>Waiting list</button>
        </div>
      </section>
      {message && <p role="status">{message}</p>}
      {data && tab === 'reviews' && <ReviewsTab data={data} inputs={inputs} setInputs={setInputs} call={call} setMessage={setMessage} reload={load} />}
      {data && tab === 'vacancies' && <VacanciesTab data={data} inputs={inputs} setInputs={setInputs} call={call} setMessage={setMessage} />}
      {tab === 'waiting' && <AdminWaitingListTab setMessage={setMessage} />}
    </main>
  );
}
