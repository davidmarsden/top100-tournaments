import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Rule 4.1 (50 players, loans both ways). Detection and notifications live in the shared
// database: see top100-tournaments docs/squad-cap-compliance.md.

const CONFIDENCE = {
  confirmed: 'Confirmed by a sync',
  likely: 'Likely (between syncs)',
  possible: 'Possible (between syncs, worst case)',
};

const date = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '–');

function Evidence({ breach }) {
  const evidence = breach.evidence || {};
  if (evidence.captures) {
    return (
      <ul>
        {evidence.captures.map((capture) => (
          <li key={capture.captured_at}>Sync {date(capture.captured_at)}: {capture.players} players</li>
        ))}
        {evidence.estimated_start_from_transfers && <li>Transfers suggest it first went over on {date(evidence.estimated_start_from_transfers)}.</li>}
      </ul>
    );
  }
  const [low, high] = evidence.peak_range || [];
  return (
    <>
      <p>
        Syncs: {evidence.previous_capture?.players} on {date(evidence.previous_capture?.captured_at)}, {evidence.next_capture?.players} on {date(evidence.next_capture?.captured_at)}.
        {' '}Peak {low === high ? high : `${low}–${high}`}. Non-transfer squad change in between: {evidence.non_transfer_change > 0 ? '+' : ''}{evidence.non_transfer_change ?? 0} (youth intake, releases).
      </p>
      <ul>
        {(evidence.days || []).map((day) => (
          <li key={day.date}>
            {date(day.date)} (turn {day.turn}): {day.peak_low === day.peak_high ? day.peak_high : `${day.peak_low}–${day.peak_high}`} at peak ·{' '}
            {day.transfers.map((transfer) => `${transfer.player} ${transfer.from} → ${transfer.to}`).join('; ')}
          </li>
        ))}
      </ul>
    </>
  );
}

export default function SquadLimitSection({ embedded = false }) {
  const [squads, setSquads] = useState([]);
  const [breaches, setBreaches] = useState([]);
  const [notes, setNotes] = useState({});
  const [status, setStatus] = useState('Loading…');

  const load = useCallback(async () => {
    const [overview, register] = await Promise.all([
      supabase.rpc('squad_cap_overview', { p_world_slug: 'top-100' }),
      supabase.from('squad_cap_breaches').select('*').order('first_detected_at', { ascending: false }),
    ]);
    if (overview.error || register.error) {
      setStatus((overview.error || register.error).message);
      return;
    }
    setSquads(overview.data || []);
    setBreaches(register.data || []);
    setStatus('');
  }, []);

  useEffect(() => { load(); }, [load]);

  async function review(breach, nextStatus) {
    const { error } = await supabase.rpc('review_squad_cap_breach', {
      p_breach_id: breach.id,
      p_status: nextStatus,
      p_note: notes[breach.id] || null,
    });
    if (error) setStatus(error.message);
    else load();
  }

  const toReview = breaches.filter((breach) => breach.status === 'open' || (breach.status === 'resolved' && !breach.reviewed_at));
  const decided = breaches.filter((breach) => !toReview.includes(breach));
  const atLimit = squads.filter((squad) => squad.players >= squad.squad_limit);

  const Shell = embedded ? 'div' : 'main';
  return (
    <Shell className={embedded ? undefined : 'app-shell'}>
      {!embedded && (
        <section className="hero">
          <p className="eyebrow">Top 100 · Rule 4.1</p>
          <h1>Squad limit compliance</h1>
          <p>
            Every Top 100 squad against the 50-player limit, from the latest sync, and every breach found between syncs.
            Uphold a breach to notify the manager (confirmed breaches already notify them); dismiss one that the evidence does not support.
          </p>
        </section>
      )}
      {status && <p role="status">{status}</p>}

      <section className="card">
        <h2>To review ({toReview.length})</h2>
        {toReview.length === 0 && <p>Nothing waiting.</p>}
        {toReview.map((breach) => (
          <article key={breach.id} className="card">
            <h3>{breach.club_name}: {breach.peak_count} players</h3>
            <p>
              <strong>{CONFIDENCE[breach.confidence]}</strong> · {breach.manager_name || 'No manager on record'}
              {breach.inherited ? ' (began before this manager was appointed)' : ''} ·{' '}
              {breach.status === 'resolved' ? `back within the limit since ${date(breach.resolved_at)}` : breach.confidence === 'confirmed' ? `still ${breach.current_count}` : `${date(breach.key_date || breach.started_on)}`}
              {breach.manager_notified_at && ` · manager notified ${date(breach.manager_notified_at)}`}
            </p>
            <Evidence breach={breach} />
            <p>
              <label>
                Decision note{' '}
                <input value={notes[breach.id] || ''} onChange={(event) => setNotes({ ...notes, [breach.id]: event.target.value })} placeholder="e.g. corrected in the same turn: warning" />
              </label>
            </p>
            <button type="button" onClick={() => review(breach, 'upheld')}>Uphold</button>{' '}
            <button type="button" onClick={() => review(breach, 'dismissed')}>Dismiss</button>
          </article>
        ))}
      </section>

      <section className="card">
        <h2>Squads at or over the limit ({atLimit.length})</h2>
        <table>
          <thead><tr><th>Club</th><th>Manager</th><th>Div</th><th>Players</th><th>Synced</th></tr></thead>
          <tbody>
            {atLimit.map((squad) => (
              <tr key={squad.club_name}>
                <td>{squad.club_name}</td><td>{squad.manager_name}</td><td>{squad.division}</td>
                <td><strong>{squad.players}</strong>{squad.players > squad.squad_limit ? ' ⚠' : ''}</td><td>{date(squad.captured_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Decided ({decided.length})</h2>
        <ul>
          {decided.map((breach) => (
            <li key={breach.id}>
              {breach.club_name} ({breach.peak_count}, {date(breach.key_date || breach.started_on)}): {breach.status}
              {breach.review_note ? `: ${breach.review_note}` : ''}
              {breach.status !== 'dismissed' && <> <button type="button" onClick={() => review(breach, 'open')}>Reopen</button></>}
            </li>
          ))}
        </ul>
      </section>
    </Shell>
  );
}
