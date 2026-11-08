import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import { cardFor } from '../lib/appointmentCards.mjs';

// Published bottom-three review decisions (rulebook 3.1) and appointments (3.2), with
// the scores they rest on and every official's vote and reason.

const OUTCOMES = {
  reappoint: 'Reappointed',
  secondChance: 'Reappointed on a last chance',
  anotherClub: 'Not reappointed: may apply for another club',
  leave: 'Not reappointed',
};

const ordinal = (n) => { const v = Number(n) % 100; return `${n}${v >= 11 && v <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th'}`; };
function VoteList({ votes, label = (choice) => choice }) {
  if (!votes?.length) return null;
  return (
    <ul className="muted">
      {votes.map((vote, index) => <li key={index}>{vote.voter || 'Official'}: {label(vote.choice)}. {vote.reason}</li>)}
    </ul>
  );
}

const PARTS = ['current', 'recent', 'honours', 'level', 'stability', 'activity'];
const shortDate = (value) => new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

// One appointments round: its decisions (with the new managers' profile cards), then one list of
// every applicant's score. A season can have several rounds; earlier ones are archived.
function AppointmentRound({ season, vacancies, scores, label }) {
  // One list of every applicant in the round, each with a single score (measured against the
  // yardstick division): Top 100 doesn't publish who applied for which club.
  const applicants = (scores?.vacancies?.applicants || []).filter((applicant) => applicant.total !== undefined);
  const yardstick = scores?.vacancies?.yardstickDivision;
  return (
    <>
      {vacancies.length > 0 && (
        <section className="card">
          <h2>{label ? `${label}: appointments` : 'Appointments'}</h2>
          {vacancies.map((vacancy) => {
            const card = cardFor(season, vacancy);
            return (
              <div key={vacancy.id} style={{ marginBottom: 16 }}>
                <h3>{vacancy.club} (Division {vacancy.division})</h3>
                {vacancy.context && <p className="muted">{vacancy.context}</p>}
                <p><strong>{vacancy.appointed ? `Appointed: ${vacancy.appointed}` : 'Not filled'}</strong>{vacancy.reason ? `. ${vacancy.reason}` : ''}</p>
                <VoteList votes={vacancy.votes} />
                {card && <img src={card.src} alt={`${card.manager}, new manager of ${vacancy.club}`} loading="lazy" width="1200" height="675" style={{ width: '100%', height: 'auto', borderRadius: 12, marginTop: 8 }} />}
              </div>
            );
          })}
        </section>
      )}
      {applicants.length > 0 && (
        <section className="card">
          <h2>{label ? `${label}: applicants` : 'Applicants'}</h2>
          <p>
            Every manager who applied in this round, with their appointment score under rule 3.2. Not everyone applied for
            every club: each manager applied only for the clubs they wanted, in their own order of preference, so a lower
            score doesn't mean a manager missed out on any particular job.
          </p>
          <p className="muted">
            Scores are measured against Division {yardstick ?? 1}. Part of the score is a manager's record at the vacancy's
            level, so for a club in a lower division a score can be a little higher. The scores guide the decisions but don't
            make them: where applicants for the same club are within five points, the admin team votes, and those votes
            aren't part of the scores.
          </p>
          <table>
            <thead><tr><th>Applicant</th><th>Score</th><th>Current · recent · honours · level · stability · activity</th></tr></thead>
            <tbody>{applicants.map((applicant) => (
              <tr key={applicant.display}>
                <td>{applicant.display}</td><td>{applicant.total}</td>
                <td>{PARTS.map((part) => applicant.breakdown?.[part]).join(' · ')}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </>
  );
}

export default function PublicAppointments() {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('Loading…');

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setMessage('Supabase is not connected.'); return; }
    supabase.rpc('public_appointment_decisions', { p_world_slug: 'top-100' }).then(({ data: result, error }) => {
      if (error) setMessage(error.message);
      else { setData(result); setMessage(''); }
    });
  }, []);

  const reviewScores = Object.fromEntries((data?.scores?.review?.reviews || []).map((review) => [review.key, review]));
  // Earlier rounds this season (archived), newest first. Rounds are numbered only when there's
  // more than one; the current round has the highest number.
  const archived = data?.archivedRounds || [];
  const rounds = archived.length + (data?.vacancies.length ? 1 : 0);
  const roundLabel = (number, archivedAt) => (rounds > 1 ? `Round ${number}${archivedAt ? ` (closed ${shortDate(archivedAt)})` : ''}` : '');

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Top 100 · Appointments</p>
        <h1>S{data?.season ?? ''} appointments and reviews</h1>
        <p>
          Vacant clubs are filled under <a href="https://smtop100.blog/rules/#32-club-vacancies-and-manager-appointments" style={{ color: '#fff', textDecoration: 'underline', fontWeight: 600 }}>rule 3.2</a>, and every bottom-three manager is reviewed under <a href="https://smtop100.blog/rules/" style={{ color: '#fff', textDecoration: 'underline', fontWeight: 600 }}>rule 3.1</a>: reappoint unless
          reappointing would be a clear and obvious error. Each decision is published
          with its score and the admin team's votes and reasons.
        </p>
      </section>
      {message && <p role="status">{message}</p>}
      {data && !data.reviews.length && !data.vacancies.length && !archived.length && <section className="card"><p>No decisions published yet this season.</p></section>}

      {data?.vacancies.length > 0 && (
        <AppointmentRound season={data.season} vacancies={data.vacancies} scores={data.scores} label={roundLabel(rounds)} />
      )}
      {archived.map((round, index) => (
        <AppointmentRound key={round.id} season={data.season} vacancies={round.vacancies} scores={round.scores}
          label={roundLabel(archived.length - index, round.archivedAt)} />
      ))}
      {data?.reviews.length > 0 && (
        <section className="card">
          <h2>Bottom-three reviews</h2>
          {data.reviews.map((review) => {
            const scored = reviewScores[String(review.id)];
            return (
              <div key={review.id} style={{ marginBottom: 16 }}>
                <h3>D{review.division} {ordinal(review.position)} · {review.club} · {review.manager}</h3>
                <p><strong>{OUTCOMES[review.decision]}</strong>{review.reason ? `. ${review.reason}` : ''}</p>
                {scored && (
                  <p className="muted">
                    Review score {scored.total} (result {scored.breakdown.result} · record {scored.breakdown.record} · activity {scored.breakdown.activity} · conduct {scored.breakdown.conduct}).
                    {scored.errors?.length ? ` Clear and obvious errors: ${scored.errors.map((error) => error.text).join('; ')}.` : ' No clear and obvious error.'}
                  </p>
                )}
                <VoteList votes={review.votes} label={(choice) => OUTCOMES[choice] || choice} />
              </div>
            );
          })}
        </section>
      )}

    </main>
  );
}
