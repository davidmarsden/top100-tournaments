import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

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
  const vacancyScores = data?.scores?.vacancies?.applicants || [];

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Top 100 · Appointments</p>
        <h1>S{data?.season ?? ''} reviews and appointments</h1>
        <p>
          Every bottom-three manager is reviewed under <a href="https://smtop100.blog/rules/">rule 3.1</a>: reappoint unless
          reappointing would be a clear and obvious error. Vacant clubs are filled under rule 3.2. Each decision is published
          with its score and the admin team's votes and reasons.
        </p>
      </section>
      {message && <p role="status">{message}</p>}
      {data && !data.reviews.length && !data.vacancies.length && <section className="card"><p>No decisions published yet this season.</p></section>}

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

      {data?.vacancies.length > 0 && (
        <section className="card">
          <h2>Appointments</h2>
          {data.vacancies.map((vacancy) => {
            const ranking = vacancyScores
              .map((applicant) => ({ applicant, scored: applicant.byVacancy?.[vacancy.club] }))
              .filter(({ scored }) => scored)
              .sort((a, b) => b.scored.total - a.scored.total);
            return (
              <div key={vacancy.id} style={{ marginBottom: 16 }}>
                <h3>{vacancy.club} (Division {vacancy.division})</h3>
                {vacancy.context && <p className="muted">{vacancy.context}</p>}
                <p><strong>{vacancy.appointed ? `Appointed: ${vacancy.appointed}` : 'Not filled'}</strong>{vacancy.reason ? `. ${vacancy.reason}` : ''}</p>
                {ranking.length > 0 && (
                  <table>
                    <thead><tr><th>Applicant</th><th>Score</th><th>Current · recent · honours · level · stability · activity</th></tr></thead>
                    <tbody>{ranking.map(({ applicant, scored }) => (
                      <tr key={applicant.key}>
                        <td>{applicant.display}</td><td>{scored.total}</td>
                        <td>{['current', 'recent', 'honours', 'level', 'stability', 'activity'].map((part) => scored.breakdown[part]).join(' · ')}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
                <VoteList votes={vacancy.votes} />
              </div>
            );
          })}
        </section>
      )}
    </main>
  );
}
