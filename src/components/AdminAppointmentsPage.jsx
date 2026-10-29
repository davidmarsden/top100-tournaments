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
// Activity and discipline inputs officials can adjust before scoring. Gold, game worlds,
// running Top 100, competitions, deals and forfeits are filled from Top 100's records.
const INPUT_FIELDS = [
  ['competitions', 'Competitions (this and last season)'],
  ['topManagerDeals', 'Deals with Top 100 managers'],
  ['running', 'Running Top 100 (0–3)'],
  ['community', 'Community (0–3)'],
  ['gameWorlds', 'Game worlds'],
  ['forfeits', 'Forfeits this season'],
  ['sanctions', 'Sanctions this season'],
  ['loginGaps', '7-day login gaps'],
];
// The functions that take the game world (the others act on one row by id).
const WORLD_FUNCTIONS = new Set(['load_appointment_reviews', 'save_appointment_round', 'publish_appointments', 'upsert_appointment_vacancy', 'announce_appointment_vacancies']);
const INLINE = { display: 'flex', alignItems: 'center', gap: 6 };
const BOX = { width: 'auto', margin: 0, flex: 'none' };
const ordinal = (n) => { const v = Number(n) % 100; return `${n}${v >= 11 && v <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th'}`; };
const when = (value) => (value ? new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
const numberOrNull = (value) => (value === '' || value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value));

function InputsEditor({ values, onChange, fields = INPUT_FIELDS, disabled }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {fields.map(([key, label]) => (
        <label key={key} style={{ fontSize: 13 }}>
          {label}
          <input type="number" step="any" style={{ width: 70, display: 'block' }} disabled={disabled}
            value={values[key] ?? ''} onChange={(event) => onChange({ ...values, [key]: event.target.value })} />
        </label>
      ))}
    </div>
  );
}

function Votes({ votes, choices, onVote, disabled }) {
  const mine = votes.find((vote) => vote.mine);
  const [choice, setChoice] = useState(mine?.choice || '');
  const [reason, setReason] = useState(mine?.reason || '');
  return (
    <div>
      <strong>Votes ({votes.length})</strong>
      <ul>{votes.map((vote) => <li key={vote.id}>{vote.voter_name || 'Official'}: {choices[vote.choice] || vote.choice}. {vote.reason}</li>)}</ul>
      {!disabled && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <select value={choice} onChange={(event) => setChoice(event.target.value)}>
            <option value="">My vote…</option>
            {Object.entries(choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input placeholder="Reason (published)" value={reason} onChange={(event) => setReason(event.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <button type="button" disabled={!choice || !reason.trim()} onClick={() => onVote(choice, reason)}>{mine ? 'Change vote' : 'Vote'}</button>
        </div>
      )}
    </div>
  );
}

function Decision({ current, reason: currentReason, choices, onDecide, published }) {
  const [choice, setChoice] = useState(current || '');
  const [reason, setReason] = useState(currentReason || '');
  if (published) return <p><strong>Published: {choices[current] || 'no appointment'}.</strong> {currentReason}</p>;
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
      <select value={choice} onChange={(event) => setChoice(event.target.value)}>
        <option value="">Decision…</option>
        {Object.entries(choices).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
      <input placeholder="Reason (published)" value={reason} onChange={(event) => setReason(event.target.value)} style={{ flex: 1, minWidth: 200 }} />
      <button type="button" disabled={!choice} onClick={() => onDecide(choice, reason)}>{current ? 'Change decision' : 'Decide'}</button>
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

function ReviewsTab({ data, inputs, setInputs, call, setMessage }) {
  const round = data.rounds.review;
  const [newcomers, setNewcomers] = useState((round?.inputs?.supply?.newcomers || []).join(', '));
  const results = useMemo(() => Object.fromEntries((round?.result?.reviews || []).map((review) => [review.key, review])), [round]);
  const balance = round?.result?.balance;
  const votesFor = (id) => data.votes.filter((vote) => vote.subject_kind === 'review' && vote.subject_id === id);

  const runScoring = async () => {
    const reviews = data.reviews.filter((review) => review.manager_name);
    const config = {
      mode: 'review',
      currentSeason: data.season,
      managers: reviews.map((review) => {
        const values = inputs[`r${review.id}`] || {};
        const base = data.inputs[String(review.manager_id)] || {};
        return {
          key: String(review.id), name: review.manager_name, club: review.club_name, display: review.manager_name,
          tookOverMidSeason: review.took_over_mid_season, gold: base.gold, loginGaps: numberOrNull(values.loginGaps),
          inactive: review.inactive || undefined, misconduct: review.misconduct || undefined, standing: review.standing || undefined,
          lastChance: review.last_chance ? 'recorded at an earlier review' : undefined, wish: review.wish || undefined,
        };
      }),
      supply: { newcomers: newcomers.split(',').map((name) => name.trim()).filter(Boolean), leavers: [] },
      discipline: Object.fromEntries(reviews.map((review) => [String(review.id), { sanctions: numberOrNull(inputs[`r${review.id}`]?.sanctions) || 0 }])),
      activity: Object.fromEntries(reviews.map((review) => {
        const values = inputs[`r${review.id}`] || {};
        return [String(review.id), Object.fromEntries(['competitions', 'topManagerDeals', 'running', 'community', 'gameWorlds', 'forfeits']
          .map((key) => [key, numberOrNull(values[key])]).filter(([, value]) => value !== null))];
      })),
    };
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
          Load the bottom three of every division, add what the scores can't know (mid-season takeovers, standing
          reappointments, earlier last chances, misconduct, inactivity, community), then score. Every decision is the
          admin team's: a second chance needs a majority, and close scores go to a vote, each with a reason.
        </p>
        <div className="button-row">
          <button type="button" onClick={() => call('load_appointment_reviews', { p_season: data.season }, 'Bottom three loaded.')}>Load the bottom three</button>
          <label>Newcomers waiting <input value={newcomers} onChange={(event) => setNewcomers(event.target.value)} placeholder="Names, comma separated" /></label>
          <button type="button" disabled={!data.reviews.length || Boolean(round?.published_at)} onClick={runScoring}>Score reviews</button>
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
      {data.reviews.map((review) => {
        const result = results[String(review.id)];
        const key = `r${review.id}`;
        return (
          <section className="card" key={review.id}>
            <h3>D{review.division} {ordinal(review.position)} · {review.club_name} · {review.manager_name || 'no manager'}</h3>
            {review.wish && <p>Wants to <strong>{review.wish}</strong>{review.wish_note ? `: ${review.wish_note}` : ''}</p>}
            <ReviewFacts review={review} onSave={(fields) => call('update_appointment_review', { p_id: review.id, p_fields: fields }, 'Saved.')} />
            <details style={{ marginTop: 8 }}>
              <summary>Scoring inputs</summary>
              <InputsEditor values={inputs[key] || {}} disabled={Boolean(review.published_at)} onChange={(values) => setInputs({ ...inputs, [key]: values })} />
            </details>
            {result && (
              <div style={{ marginTop: 8 }}>
                <p>
                  <strong>{result.total}</strong> (result {result.breakdown.result} · record {result.breakdown.record} · activity {result.breakdown.activity} · conduct {result.breakdown.conduct}).
                  Suggested: <strong>{OUTCOMES[result.outcome]}</strong>{result.vote ? ' · needs an admin vote' : ''}.
                </p>
                <p className="muted">{result.reason}</p>
              </div>
            )}
            <Votes votes={votesFor(review.id)} choices={OUTCOMES} disabled={Boolean(review.published_at)}
              onVote={(choice, reason) => call('cast_appointment_vote', { p_subject_kind: 'review', p_subject_id: review.id, p_choice: choice, p_reason: reason }, 'Vote recorded.')} />
            <Decision current={review.decision} reason={review.decision_reason} choices={OUTCOMES} published={Boolean(review.published_at)}
              onDecide={(decision, reason) => call('decide_appointment_review', { p_id: review.id, p_decision: decision, p_reason: reason }, 'Decision saved (not yet published).')} />
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
        return [keyOf(application), { gold: base.gold, openSanction: base.openSanction, sanctions: numberOrNull(inputs[`a${application.manager_id}`]?.sanctions) || 0 }];
      })),
      activity: Object.fromEntries(applications.map((application) => {
        const values = inputs[`a${application.manager_id}`] || {};
        return [keyOf(application), Object.fromEntries(['competitions', 'topManagerDeals', 'running', 'community', 'gameWorlds']
          .map((key) => [key, numberOrNull(values[key])]).filter(([, value]) => value !== null))];
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
              <summary>Scoring inputs</summary>
              <InputsEditor fields={INPUT_FIELDS.filter(([key]) => !['forfeits', 'loginGaps'].includes(key))} values={inputs[`a${application.manager_id}`] || {}}
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
            <Votes votes={data.votes.filter((vote) => vote.subject_kind === 'vacancy' && vote.subject_id === vacancy.id)} disabled={Boolean(vacancy.published_at)}
              choices={Object.fromEntries(Object.values(choices).map((name) => [name, name]))}
              onVote={(choice, reason) => call('cast_appointment_vote', { p_subject_kind: 'vacancy', p_subject_id: vacancy.id, p_choice: choice, p_reason: reason }, 'Vote recorded.')} />
            <Decision current={vacancy.appointed_manager_id ? String(vacancy.appointed_manager_id) : ''} reason={vacancy.decision_reason} published={Boolean(vacancy.published_at)}
              choices={{ ...choices, ...(vacancy.appointed_manager_id ? { [String(vacancy.appointed_manager_id)]: vacancy.appointedManager } : {}) }}
              onDecide={(manager, reason) => call('decide_appointment_vacancy', { p_id: vacancy.id, p_manager_id: Number(manager), p_reason: reason }, 'Decision saved (not yet published).')} />
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
    return saved[key] || Object.fromEntries(INPUT_FIELDS.map(([field]) => [field, base[field] ?? '']));
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
          <a href="https://manager.smtop100.blog/appointments">Manager Portal</a>; published decisions appear at{' '}
          <a href="/appointments">/appointments</a>.
        </p>
        <div className="button-row">
          <button type="button" className={tab === 'reviews' ? '' : 'secondary'} onClick={() => setTab('reviews')}>Reviews</button>
          <button type="button" className={tab === 'vacancies' ? '' : 'secondary'} onClick={() => setTab('vacancies')}>Vacancies</button>
        </div>
      </section>
      {message && <p role="status">{message}</p>}
      {data && tab === 'reviews' && <ReviewsTab data={data} inputs={inputs} setInputs={setInputs} call={call} setMessage={setMessage} />}
      {data && tab === 'vacancies' && <VacanciesTab data={data} inputs={inputs} setInputs={setInputs} call={call} setMessage={setMessage} />}
    </main>
  );
}
