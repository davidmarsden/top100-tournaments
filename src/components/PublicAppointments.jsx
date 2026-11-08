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

// Profile cards announcing new managers, by season and club (sources in docs/appointment-cards).
const CARDS = {
  28: {
    'Borussia Dortmund': { src: '/appointments/s28/card-scott.webp', manager: 'Scott Mckenzie' },
    'Atlético Madrid': { src: '/appointments/s28/card-simon.webp', manager: 'Simon Thomas' },
    'Hellas Verona': { src: '/appointments/s28/card-beddows.webp', manager: 'Sir Stephen Beddows' },
    Juventus: { src: '/appointments/s28/card-trx.webp', manager: 'Mister TRX' },
  },
};
const normalise = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function cardFor(season, vacancy) {
  if (!vacancy.appointed) return null;
  const club = normalise(vacancy.club);
  const match = Object.entries(CARDS[season] || {}).find(([name]) => club.includes(normalise(name)) || normalise(name).includes(club));
  return match && normalise(vacancy.appointed).startsWith(normalise(match[1].manager)) ? match[1] : null;
}

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
  // One list of every applicant in the round, each with a single score (measured against the
  // yardstick division): Top 100 doesn't publish who applied for which club.
  const vacancyScores = (data?.scores?.vacancies?.applicants || []).filter((applicant) => applicant.total !== undefined);
  const yardstick = data?.scores?.vacancies?.yardstickDivision;

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
      {data && !data.reviews.length && !data.vacancies.length && <section className="card"><p>No decisions published yet this season.</p></section>}

      {data?.vacancies.length > 0 && (
        <section className="card">
          <h2>Appointments</h2>
          {data.vacancies.map((vacancy) => (
            <div key={vacancy.id} style={{ marginBottom: 16 }}>
              <h3>{vacancy.club} (Division {vacancy.division})</h3>
              {vacancy.context && <p className="muted">{vacancy.context}</p>}
              <p><strong>{vacancy.appointed ? `Appointed: ${vacancy.appointed}` : 'Not filled'}</strong>{vacancy.reason ? `. ${vacancy.reason}` : ''}</p>
              <VoteList votes={vacancy.votes} />
              {(() => {
                const card = cardFor(data.season, vacancy);
                return card && <img src={card.src} alt={`${card.manager}, new manager of ${vacancy.club}`} loading="lazy" width="1200" height="675" style={{ width: '100%', height: 'auto', borderRadius: 12, marginTop: 8 }} />;
              })()}
            </div>
          ))}
        </section>
      )}

      {vacancyScores.length > 0 && (
        <section className="card">
          <h2>Applicants</h2>
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
            <tbody>{vacancyScores.map((applicant) => (
              <tr key={applicant.display}>
                <td>{applicant.display}</td><td>{applicant.total}</td>
                <td>{['current', 'recent', 'honours', 'level', 'stability', 'activity'].map((part) => applicant.breakdown?.[part]).join(' · ')}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
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
