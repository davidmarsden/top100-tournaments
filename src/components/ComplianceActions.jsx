import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// The admin team's to-do list for rule 4.1, worked out from the records so nothing is forgotten:
//   - an upheld breach with no transfer ban recorded, with the usual ban ready to record
//     (one month for a first breach, three for a repeat, cash sales to clubs outside Top 100);
//   - a banned or upheld club still over the limit;
//   - a required sale that can be made now but hasn't been;
//   - breaches waiting for a decision, and follow-up alerts not yet seen.

const date = (value) => (value ? new Date(`${String(value).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '–');
const addMonths = (value, months) => {
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a, b) => Math.round((new Date(`${b}T12:00:00Z`) - new Date(`${a}T12:00:00Z`)) / 86400000);
const ordinal = (n) => (n === 1 ? 'First' : n === 2 ? 'Second' : n === 3 ? 'Third' : `${n}th`);

// A ban covers a breach when it was recorded against it, or it's the same club's ban starting
// within two weeks of the breach (bans recorded before they were linked to breaches).
function banFor(breach, bans) {
  return bans.find((ban) => ban.breach_id === breach.id)
    || bans.find((ban) => ban.source_club_id === breach.source_club_id && breach.started_on
      && Math.abs(daysBetween(breach.started_on, ban.starts_on)) <= 14);
}

const LEVEL_NAMES = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth' };
const MONTH_WORDS = { 1: 'one-month', 3: 'three-month', 4: 'four-month', 6: 'six-month' };

// The ban the ladder (rule 4.1) gives for this breach: the manager's last ban, less a level for
// each six months clean since it ended, plus one. Dates stay editable.
function SuggestedBan({ breach, onRecorded, setMessage }) {
  const starts = breach.started_on || new Date().toISOString().slice(0, 10);
  const [ladder, setLadder] = useState(null);
  const [from, setFrom] = useState(starts);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.rpc('transfer_ban_ladder', { p_manager_id: breach.manager_id, p_manager_name: breach.manager_name, p_as_of: starts })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) { setMessage(error.message); return; }
        setLadder(data);
        setTo(addMonths(starts, data.months));
      });
    return () => { active = false; };
  }, [breach.id]);

  if (!ladder) return <li className="compliance-action is-urgent"><strong>{breach.club_name}: breach upheld, but no transfer ban recorded.</strong> Working out the ban level…</li>;

  const level = ladder.level;
  const months = MONTH_WORDS[ladder.months] || `${ladder.months}-month`;
  const last = ladder.lastBan;
  const history = last
    ? `Last ban: level ${last.level}, ended ${date(last.endsOn)} (${last.monthsClean} month${last.monthsClean === 1 ? '' : 's'} clean, so back to level ${ladder.backToLevel}).`
    : 'No previous ban on record.';
  const reason = `${ordinal(level)} level offence: ${breach.peak_count} players on ${date(breach.started_on)}.`
    + `${breach.review_note ? ` Ruling: ${breach.review_note}` : ''} ${months.charAt(0).toUpperCase()}${months.slice(1)} ban, cash sales to clubs outside Top 100 only.`;

  async function record() {
    setBusy(true);
    const { data: ban, error } = await supabase.rpc('set_club_transfer_ban', {
      p_source_club_id: breach.source_club_id, p_starts_on: from, p_ends_on: to, p_reason: reason,
      p_terms: 'external_cash_sales_only', p_breach_id: breach.id,
    });
    if (!error && ban?.id) {
      const { error: levelError } = await supabase.rpc('record_transfer_ban_level', {
        p_ban_id: ban.id, p_manager_id: breach.manager_id, p_manager_name: breach.manager_name, p_level: level,
      });
      if (levelError) setMessage(`Ban recorded, but its level wasn't: ${levelError.message}`);
    }
    setBusy(false);
    if (error) setMessage(error.message); else onRecorded();
  }

  return (
    <li className="compliance-action is-urgent">
      <strong>{breach.club_name}: breach upheld, but no transfer ban recorded.</strong>{' '}
      {breach.manager_name || 'The manager'}: {LEVEL_NAMES[level]} level offence ({breach.peak_count} players, {date(breach.started_on)}). {history}
      <div className="compliance-action__form">
        <label>From <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>{' '}
        <label>to <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>{' '}
        <button type="button" onClick={record} disabled={busy}>{busy ? 'Recording…' : `Record ${months} ban`}</button>
      </div>
      <small className="muted">Reason recorded: {reason}</small>
    </li>
  );
}

export default function ComplianceActions({ reloadKey = 0, onChanged }) {
  const [data, setData] = useState(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [breaches, bans, obligations, events] = await Promise.all([
      supabase.from('squad_cap_breaches').select('*').or('confidence.eq.confirmed,source.neq.sync').order('started_on'),
      supabase.from('club_transfer_bans').select('*'),
      supabase.rpc('compliance_obligation_overview', { p_world_slug: 'top-100' }),
      supabase.from('compliance_events').select('id').is('acknowledged_at', null),
    ]);
    const error = breaches.error || bans.error || obligations.error || events.error;
    if (error) { setMessage(error.message); return; }
    setData({ breaches: breaches.data || [], bans: bans.data || [], obligations: obligations.data || [], unseen: (events.data || []).length });
    setMessage('');
  }, []);

  useEffect(() => { load(); }, [load, reloadKey]);

  if (!data) return message ? <p role="status">{message}</p> : null;
  const today = new Date().toISOString().slice(0, 10);
  const changed = () => { load(); onChanged?.(); };

  const upheld = data.breaches.filter((breach) => breach.status === 'upheld');
  const unbanned = upheld.filter((breach) => !banFor(breach, data.bans));

  const activeBans = data.bans.filter((ban) => ban.ends_on >= today);
  const stillOver = upheld.filter((breach) => !breach.ended_on && breach.current_count > (breach.squad_limit || 50))
    .filter((breach, index, all) => all.findIndex((other) => other.source_club_id === breach.source_club_id) === index);

  // Open required sales whose player can be sold now (no Soccer Manager transfer ban left).
  const sellableNow = data.obligations.filter((row) => row.status === 'open' && row.checked_at
    && (!row.sellable_from || new Date(row.sellable_from).getFullYear() < 2000 || new Date(row.sellable_from) <= new Date()));
  const sellableClubs = [...new Set(sellableNow.map((row) => row.club_name))];
  const toReview = data.breaches.filter((breach) => breach.status === 'open' || (breach.status === 'resolved' && !breach.reviewed_at));

  const items = unbanned.length + stillOver.length + sellableClubs.length + (toReview.length ? 1 : 0) + (data.unseen ? 1 : 0);

  return (
    <section className="card compliance-actions">
      <h2>Needs action ({items})</h2>
      {message && <p role="status">{message}</p>}
      {items === 0 ? <p>Nothing outstanding.</p> : (
        <ul>
          {unbanned.map((breach) => <SuggestedBan key={breach.id} breach={breach} onRecorded={changed} setMessage={setMessage} />)}
          {toReview.length > 0 && <li className="compliance-action is-urgent"><strong>{toReview.length} breach{toReview.length === 1 ? '' : 'es'} to review</strong>: {toReview.map((breach) => breach.club_name).join(', ')}. See <a href="#squad-limit-review">To review</a>.</li>}
          {stillOver.map((breach) => {
            const ban = activeBans.find((row) => row.source_club_id === breach.source_club_id);
            return (
              <li key={`over-${breach.id}`} className="compliance-action">
                <strong>{breach.club_name} is still on {breach.current_count}</strong> (over since {date(breach.started_on)}{breach.manager_name ? `, ${breach.manager_name}` : ''}).
                {ban ? ` Banned until ${date(ban.ends_on)}.` : ''} Chase a sale to a club outside Top 100.
              </li>
            );
          })}
          {sellableClubs.map((club) => {
            // An either-or ruling (sell any one of several) is one sale.
            const rulings = new Map();
            sellableNow.filter((row) => row.club_name === club).forEach((row) => {
              const key = row.choice_group || row.id;
              rulings.set(key, [...(rulings.get(key) || []), row.player_name || row.source_player_id]);
            });
            const names = [...rulings.values()].map((players) => players.join(' or '));
            return (
              <li key={`sale-${club}`} className="compliance-action">
                <strong>{club}: {names.length} required sale{names.length === 1 ? '' : 's'} can be made now</strong> ({names.join('; ')}). See <a href="#required-sales">Required sales</a>.
              </li>
            );
          })}
          {data.unseen > 0 && <li className="compliance-action"><strong>{data.unseen} follow-up alert{data.unseen === 1 ? '' : 's'} not yet seen.</strong> See <a href="#ruling-follow-up">Ruling follow-up</a>.</li>}
        </ul>
      )}
    </section>
  );
}
