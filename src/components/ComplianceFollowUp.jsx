import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Follow-up on squad limit rulings: squads back within 50, deals during transfer
// bans, required sales made or broken, re-bids. "Can be sold from" is Soccer
// Manager's own transfer ban on the player (a week after a deal with a club outside
// Top 100, a month after one with a Top 100 club), from the latest synced squad. Checks run in the database every
// five minutes (enqueue_compliance_events); this page records rulings and shows results.

const date = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '–');
const SEVERITY = { critical: '🔴', warning: '🟠', info: '🟢' };
const REQUIREMENT = { sell_external_cash: 'Sell to a club outside Top 100 for cash', sell: 'Sell' };
const today = () => new Date().toISOString().slice(0, 10);
const inAMonth = () => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 10); };

export default function ComplianceFollowUp() {
  const [events, setEvents] = useState([]);
  const [bans, setBans] = useState([]);
  const [obligations, setObligations] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [message, setMessage] = useState('');
  const [ban, setBan] = useState({ club: '', starts: today(), ends: inAMonth(), terms: 'external_cash_sales_only', reason: '' });
  const [sale, setSale] = useState({ club: '', player: '', requirement: 'sell_external_cash', noRebid: true, reason: '' });

  const load = useCallback(async () => {
    const [log, banRows, obligationRows, crosswalk] = await Promise.all([
      supabase.from('compliance_events').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('club_transfer_bans').select('*').order('ends_on', { ascending: false }),
      supabase.rpc('compliance_obligation_overview', { p_world_slug: 'top-100' }),
      supabase.from('soccer_manager_club_crosswalk').select('source_club_id, source_club_name').eq('source_world_id', 239138).order('source_club_name'),
    ]);
    const error = log.error || banRows.error || obligationRows.error;
    if (error) { setMessage(error.message); return; }
    setEvents(log.data || []);
    setBans(banRows.data || []);
    setObligations(obligationRows.data || []);
    setClubs(crosswalk.data || []);
    setMessage('');
  }, []);

  useEffect(() => { load(); }, [load]);

  const call = async (name, args) => {
    const { error } = await supabase.rpc(name, args);
    if (error) { setMessage(error.message); return false; }
    await load();
    return true;
  };

  const addBan = async (event) => {
    event.preventDefault();
    if (!ban.club || !ban.reason.trim()) { setMessage('Choose a club and give a reason.'); return; }
    if (await call('set_club_transfer_ban', { p_source_club_id: ban.club, p_starts_on: ban.starts, p_ends_on: ban.ends, p_reason: ban.reason, p_terms: ban.terms })) {
      setBan({ ...ban, club: '', reason: '' });
    }
  };

  const addSale = async (event) => {
    event.preventDefault();
    if (!sale.club || !/^\d+$/.test(sale.player) || !sale.reason.trim()) { setMessage('Choose a club, enter the Soccer Manager player ID (a number) and give a reason.'); return; }
    if (await call('add_compliance_obligation', { p_source_club_id: sale.club, p_source_player_id: sale.player, p_requirement: sale.requirement, p_no_rebid: sale.noRebid, p_reason: sale.reason })) {
      setSale({ ...sale, club: '', player: '', reason: '' });
    }
  };

  const clubPicker = (value, onChange) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Club…</option>
      {clubs.map((club) => <option key={club.source_club_id} value={club.source_club_id}>{club.source_club_name}</option>)}
    </select>
  );

  const open = events.filter((event) => !event.acknowledged_at);
  const activeBans = bans.filter((row) => row.ends_on >= today());

  return (
    <>
      {message && <p role="status">{message}</p>}
      <section className="card">
        <h2>Ruling follow-up ({open.length} new)</h2>
        {events.length === 0 && <p>Nothing yet.</p>}
        <ul>
          {events.map((event) => (
            <li key={event.id} style={{ opacity: event.acknowledged_at ? 0.6 : 1 }}>
              {SEVERITY[event.severity]} <strong>{event.title}</strong> ({date(event.created_at)}): {event.body}
              {!event.acknowledged_at && <> <button type="button" onClick={() => call('acknowledge_compliance_event', { p_event_id: event.id })}>Seen</button></>}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>Transfer bans ({activeBans.length} active)</h2>
        <ul>
          {bans.map((row) => (
            <li key={row.id}>
              <strong>{row.club_name}</strong>: {date(row.starts_on)} to {date(row.ends_on)},{' '}
              {row.terms === 'external_cash_sales_only' ? 'cash sales to clubs outside Top 100 only' : 'no deals'}. {row.reason}
            </li>
          ))}
        </ul>
        <form onSubmit={addBan}>
          <h3>Record a ban</h3>
          <p>
            {clubPicker(ban.club, (club) => setBan({ ...ban, club }))}{' '}
            <label>From <input type="date" value={ban.starts} onChange={(event) => setBan({ ...ban, starts: event.target.value })} /></label>{' '}
            <label>to <input type="date" value={ban.ends} onChange={(event) => setBan({ ...ban, ends: event.target.value })} /></label>{' '}
            <select value={ban.terms} onChange={(event) => setBan({ ...ban, terms: event.target.value })}>
              <option value="external_cash_sales_only">Cash sales to clubs outside Top 100 only</option>
              <option value="no_transfers">No deals at all</option>
            </select>
          </p>
          <p><input style={{ width: '100%' }} placeholder="Reason (the ruling)" value={ban.reason} onChange={(event) => setBan({ ...ban, reason: event.target.value })} /></p>
          <button type="submit">Record ban</button>
        </form>
      </section>

      <section className="card">
        <h2>Required sales ({obligations.filter((row) => row.status === 'open').length} outstanding)</h2>
        <table>
          <thead><tr><th>Club</th><th>Player</th><th>Requirement</th><th>Can be sold from</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {obligations.map((row) => (
              <tr key={row.id}>
                <td>{row.club_name}</td>
                <td>{row.player_name || row.source_player_id}</td>
                <td>{REQUIREMENT[row.requirement]}{row.no_rebid ? '; no re-bid' : ''}</td>
                <td>
                  {row.sellable_from ? date(row.sellable_from) : '–'}
                  {row.status === 'open' && row.sellable_from && new Date(row.sellable_from) <= new Date() ? <strong> (now: not yet sold)</strong> : ''}
                </td>
                <td>
                  {row.status}
                  {row.resolved_transfer ? ` (to ${row.resolved_transfer.to}, ${date(row.resolved_transfer.date)})` : ''}
                </td>
                <td>{row.status === 'open' && <button type="button" onClick={() => call('set_compliance_obligation_status', { p_obligation_id: row.id, p_status: 'waived' })}>Waive</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={addSale}>
          <h3>Record a required sale</h3>
          <p>
            {clubPicker(sale.club, (club) => setSale({ ...sale, club }))}{' '}
            <input placeholder="SM player ID" value={sale.player} onChange={(event) => setSale({ ...sale, player: event.target.value.trim() })} size={10} />{' '}
            <select value={sale.requirement} onChange={(event) => setSale({ ...sale, requirement: event.target.value })}>
              <option value="sell_external_cash">Sell to a club outside Top 100 for cash</option>
              <option value="sell">Sell (any buyer)</option>
            </select>{' '}
            <label><input type="checkbox" checked={sale.noRebid} onChange={(event) => setSale({ ...sale, noRebid: event.target.checked })} /> No re-bid</label>
          </p>
          <p><input style={{ width: '100%' }} placeholder="Reason (the ruling)" value={sale.reason} onChange={(event) => setSale({ ...sale, reason: event.target.value })} /></p>
          <button type="submit">Record required sale</button>
        </form>
      </section>
    </>
  );
}
