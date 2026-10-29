import { useCallback, useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

// Manager Portal: apply for vacant clubs (rulebook 3.2) and, after a bottom-three
// finish, say whether you want to stay, move or take a break (3.1).

const WISHES = [
  ['stay', 'Stay at my club'],
  ['move', 'Move to another club'],
  ['break', 'Take a break from Top 100'],
];
const DECISIONS = {
  reappoint: 'Reappointed',
  secondChance: 'Reappointed on a last chance',
  anotherClub: 'Not reappointed: you can apply for another club',
  leave: 'Not reappointed',
};
// Tick boxes and radio buttons beside their labels (the portal styles stack form labels).
const INLINE = { display: 'flex', alignItems: 'center', gap: 8, fontWeight: 'normal' };
const BOX = { width: 'auto', margin: 0, flex: 'none' };
const ordinal = (n) => { const v = Number(n) % 100; return `${n}${v >= 11 && v <= 13 ? 'th' : { 1: 'st', 2: 'nd', 3: 'rd' }[v % 10] || 'th'}`; };
const when = (value) => (value ? new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function Shell({ children }) {
  return <main className="manager-portal-shell">{children}</main>;
}

function ReviewCard({ review, season, onSave, busy }) {
  const [wish, setWish] = useState(review.wish || '');
  const [note, setNote] = useState(review.wishNote || '');
  if (review.decision) {
    return (
      <section className="card">
        <p className="eyebrow">Your S{season} review</p>
        <h2>{DECISIONS[review.decision]}</h2>
        {review.reason && <p>{review.reason}</p>}
        <p><a href="https://tournaments.smtop100.blog/appointments">See every published decision and its reasons</a></p>
      </section>
    );
  }
  return (
    <section className="card">
      <p className="eyebrow">Bottom-three review</p>
      <h2>{review.club}: {ordinal(review.position)} in Division {review.division}</h2>
      <p className="muted">
        Every bottom-three manager is reviewed, and the rule is to reappoint unless reappointing would be a clear and obvious
        error. Tell the admin team what you would like; it is recorded with the decision.
      </p>
      <fieldset disabled={busy}>
        {WISHES.map(([value, label]) => (
          <label key={value} style={INLINE}>
            <input type="radio" name="wish" value={value} checked={wish === value} onChange={() => setWish(value)} style={BOX} /> {label}
          </label>
        ))}
        <label style={{ display: 'block', marginTop: 8 }}>
          Anything the admin team should know (optional)
          <textarea rows={3} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)} style={{ width: '100%' }} />
        </label>
        <button type="button" disabled={!wish} onClick={() => onSave(wish, note)}>Save</button>
      </fieldset>
    </section>
  );
}

function VacanciesCard({ data, onSubmit, onWithdraw, busy }) {
  const open = data.vacancies.filter((vacancy) => vacancy.open);
  const application = data.application?.status === 'active' ? data.application : null;
  // Clubs that have since closed, been withdrawn or been decided drop out of the editable list.
  const [chosen, setChosen] = useState((application?.preferences || []).filter((id) => open.some((vacancy) => vacancy.id === id)));
  const [note, setNote] = useState(application?.note || '');
  const notGold = data.gold?.gold === false;
  const name = (id) => data.vacancies.find((vacancy) => vacancy.id === id)?.club || `#${id}`;
  const toggle = (id) => setChosen((list) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id]));
  const move = (index, step) =>
    setChosen((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(index + step, 0, item);
      return next;
    });

  if (!data.vacancies.length) {
    return (
      <section className="card">
        <p className="eyebrow">Vacancies</p>
        <h2>No vacancies open</h2>
        <p className="muted">When clubs need a manager, they are listed here with a closing date, and you will get a notification.</p>
      </section>
    );
  }
  return (
    <section className="card">
      <p className="eyebrow">Vacancies for S{(data.season || 0) + 1}</p>
      <h2>Apply for a club</h2>
      <p className="muted">
        Tick the clubs you want and put them in order: your first choice at the top. Applying for one club is fine. Every
        applicant is scored for every club they apply for, and the scores and decisions are published (rule 3.2).
      </p>
      {notGold && <p className="status">Applying needs Gold membership, which every Top 100 manager must have.</p>}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {data.vacancies.map((vacancy) => (
          <li key={vacancy.id} style={{ marginBottom: 8 }}>
            <label style={INLINE}>
              <input type="checkbox" disabled={!vacancy.open || busy || notGold} checked={chosen.includes(vacancy.id)} onChange={() => toggle(vacancy.id)} style={BOX} />
              <span><strong>{vacancy.club}</strong> (Division {vacancy.division} next season)
                {vacancy.open ? (vacancy.closesAt ? `, closes ${when(vacancy.closesAt)}` : '') : ', closed'}</span>
            </label>
            {vacancy.context && <div className="muted">{vacancy.context}</div>}
          </li>
        ))}
      </ul>
      {chosen.length > 0 && (
        <>
          <h3>Your order of preference</h3>
          <ol>
            {chosen.map((id, index) => (
              <li key={id}>
                {name(id)}{' '}
                <button type="button" className="secondary" disabled={index === 0 || busy} onClick={() => move(index, -1)} aria-label="Move up">↑</button>{' '}
                <button type="button" className="secondary" disabled={index === chosen.length - 1 || busy} onClick={() => move(index, 1)} aria-label="Move down">↓</button>
              </li>
            ))}
          </ol>
        </>
      )}
      <label style={{ display: 'block' }}>
        A note for the admin team (optional)
        <textarea rows={3} maxLength={1000} value={note} disabled={busy || notGold} onChange={(event) => setNote(event.target.value)} style={{ width: '100%' }} />
      </label>
      <div className="button-row">
        <button type="button" disabled={busy || notGold || !chosen.length || !open.length} onClick={() => onSubmit(chosen, note)}>
          {application ? 'Update my application' : 'Apply'}
        </button>
        {application && <button type="button" className="secondary" disabled={busy} onClick={onWithdraw}>Withdraw</button>}
      </div>
      {application && <p className="muted">Application saved {when(application.updatedAt)}: {application.preferences.map(name).join(', ')}.</p>}
    </section>
  );
}

export default function ManagerAppointments() {
  const [data, setData] = useState(null);
  const [signedIn, setSignedIn] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    if (!hasSupabaseConfig || !supabase) { setMessage('Supabase is not connected.'); return; }
    const { data: session } = await supabase.auth.getSession();
    if (!session.session) { setSignedIn(false); return; }
    setSignedIn(true);
    const { data: result, error } = await supabase.rpc('my_appointments', { p_world_slug: 'top-100' });
    if (error) setMessage(error.message);
    else setData(result);
  }, []);

  useEffect(() => { load(); }, [load]);

  const call = async (name, args, done) => {
    setBusy(true);
    setMessage('');
    const { data: result, error } = await supabase.rpc(name, { ...args, p_world_slug: 'top-100' });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setData(result);
    setMessage(done);
  };

  if (!signedIn) {
    return <Shell><section className="card manager-login-card"><h1>Sign in first</h1><p className="muted">Use your Manager Portal sign-in, then come back to Appointments.</p><a className="button" href="/">Go to Manager Portal</a></section></Shell>;
  }
  if (!data) return <Shell><section className="card"><h1>{message || 'Loading…'}</h1></section></Shell>;
  if (!data.manager) {
    return <Shell><section className="card manager-login-card"><h1>No club linked</h1><p className="muted">Your Manager Portal account isn't linked to a Top 100 club yet.</p><a className="button" href="/">Back to My Matches</a></section></Shell>;
  }

  return (
    <Shell>
      <section className="manager-portal-hero">
        <p className="eyebrow">Appointments · Top 100</p>
        <h1>{data.manager.name}</h1>
        <p className="muted">
          {data.manager.club}, {ordinal(data.manager.position)} in Division {data.manager.division}.{' '}
          {data.gold?.gold === false ? 'Not a Gold member.' : data.gold?.daysLeft ? `Gold: ${data.gold.daysLeft} days left.` : ''}
        </p>
        <div className="button-row"><a className="button secondary" href="/">My Matches</a><a className="button secondary" href="https://tournaments.smtop100.blog/appointments">Published decisions</a></div>
      </section>
      {message && <p className="status" role="status">{message}</p>}
      {data.review && <ReviewCard review={data.review} season={data.season} busy={busy} onSave={(wish, note) => call('set_review_wish', { p_wish: wish, p_note: note }, 'Saved. Thank you.')} />}
      <VacanciesCard
        key={(data.application?.preferences || []).join(',')}
        data={data}
        busy={busy}
        onSubmit={(ids, note) => call('submit_vacancy_application', { p_vacancy_ids: ids, p_note: note }, 'Application saved.')}
        onWithdraw={() => call('withdraw_vacancy_application', {}, 'Application withdrawn.')}
      />
    </Shell>
  );
}
