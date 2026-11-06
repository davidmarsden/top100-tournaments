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
  const [sale, setSale] = useState({ club: '', players: [], extraIds: '', requirement: 'sell_external_cash', noRebid: true, reason: '' });
  const [squad, setSquad] = useState([]);

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

  // The chosen club's squad from the latest sync, for picking the player(s) a ruling names.
  useEffect(() => {
    if (!sale.club) { setSquad([]); return undefined; }
    let current = true;
    supabase.rpc('compliance_club_squad', { p_source_club_id: sale.club, p_world_slug: 'top-100' }).then(({ data, error }) => {
      if (!current) return;
      if (error) { setMessage(error.message); setSquad([]); return; }
      setSquad(data || []);
    });
    return () => { current = false; };
  }, [sale.club]);

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
    const extra = sale.extraIds.split(/[\s,;/]+/).filter(Boolean);
    if (extra.some((id) => !/^\d+$/.test(id))) { setMessage('Soccer Manager player IDs are numbers (separate several with commas).'); return; }
    const players = [...new Set([...sale.players, ...extra])];
    if (!sale.club || players.length === 0 || !sale.reason.trim()) { setMessage('Choose a club, tick the player (or players: selling any one of them meets the ruling) and give a reason.'); return; }
    if (await call('add_compliance_obligations', { p_source_club_id: sale.club, p_source_player_ids: players, p_requirement: sale.requirement, p_no_rebid: sale.noRebid, p_reason: sale.reason })) {
      setSale({ ...sale, club: '', players: [], extraIds: '', reason: '' });
    }
  };

  const clubPicker = (value, onChange) => (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      <option value="">Club…</option>
      {clubs.map((club) => <option key={club.source_club_id} value={club.source_club_id}>{club.source_club_name}</option>)}
    </select>
  );

  const togglePlayer = (id) => setSale({ ...sale, players: sale.players.includes(id) ? sale.players.filter((p) => p !== id) : [...sale.players, id] });
  const playerLabel = (row) => row.player_name || row.source_player_id;
  // Soccer Manager reports "no transfer ban" as time 0 (1 Jan 1970).
  const banEnds = (row) => (row.sellable_from && new Date(row.sellable_from).getFullYear() > 2000 ? row.sellable_from : null);
  // An either-or ruling is one row per player in the database; show it as one ruling.
  const rulings = [];
  obligations.forEach((row) => {
    const group = row.choice_group && rulings.find((ruling) => ruling.choice_group === row.choice_group);
    if (group) group.members.push(row);
    else rulings.push({ ...row, members: [row] });
  });
  rulings.forEach((ruling) => {
    const sold = ruling.members.find((member) => member.status === 'met' || member.status === 'breached');
    const open = ruling.members.filter((member) => member.status === 'open');
    // Only synced players count: one with no snapshot has unknown availability.
    const checked = (open.length ? open : ruling.members).filter((member) => member.checked_at);
    const dates = checked.map(banEnds);
    Object.assign(ruling, {
      status: sold ? sold.status : ruling.members[0].status,
      resolved_transfer: sold ? { ...sold.resolved_transfer, player: playerLabel(sold) } : ruling.members[0].resolved_transfer,
      // The soonest any of the players can be sold.
      sellable_from: dates.includes(null) ? null : dates.sort()[0] || null,
      checked: checked.length > 0,
    });
  });

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
        <h2>Required sales ({rulings.filter((row) => row.status === 'open').length} outstanding)</h2>
        <table>
          <thead><tr><th>Club</th><th>Player</th><th>Requirement</th><th>Can be sold from</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rulings.map((row) => (
              <tr key={row.id}>
                <td>{row.club_name}</td>
                <td>
                  {row.members.map(playerLabel).join(' or ')}
                  {row.members.length > 1 && <small> (any one)</small>}
                </td>
                <td>{REQUIREMENT[row.requirement]}{row.no_rebid ? '; no re-bid' : ''}</td>
                <td>
                  {row.sellable_from ? date(row.sellable_from) : (row.checked ? 'now' : '–')}
                  {row.status === 'open' && row.checked && (!row.sellable_from || new Date(row.sellable_from) <= new Date()) ? <strong> (not yet sold)</strong> : ''}
                </td>
                <td>
                  {row.status}
                  {row.resolved_transfer?.to ? ` (${row.members.length > 1 ? `${row.resolved_transfer.player} ` : ''}to ${row.resolved_transfer.to}, ${date(row.resolved_transfer.date)})` : ''}
                </td>
                <td>{row.status === 'open' && <button type="button" onClick={() => call('set_compliance_obligation_status', { p_obligation_id: row.id, p_status: 'waived' })}>Waive</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <form onSubmit={addSale}>
          <h3>Record a required sale</h3>
          <p>
            {clubPicker(sale.club, (club) => setSale({ ...sale, club, players: [], extraIds: '' }))}{' '}
            <select value={sale.requirement} onChange={(event) => setSale({ ...sale, requirement: event.target.value })}>
              <option value="sell_external_cash">Sell to a club outside Top 100 for cash</option>
              <option value="sell">Sell (any buyer)</option>
            </select>{' '}
            <label><input type="checkbox" checked={sale.noRebid} onChange={(event) => setSale({ ...sale, noRebid: event.target.checked })} /> No re-bid</label>
          </p>
          {sale.club && (
            <fieldset>
              <legend>Player(s): tick one, or several if selling any one of them meets the ruling</legend>
              {squad.length === 0 && <p>No synced squad for this club. Enter the Soccer Manager player ID(s) below.</p>}
              <div style={{ columns: '14rem', fontSize: '0.9em' }}>
                {squad.map((player) => (
                  <label key={player.source_player_id} style={{ display: 'block' }}>
                    <input type="checkbox" checked={sale.players.includes(player.source_player_id)} onChange={() => togglePlayer(player.source_player_id)} />{' '}
                    {player.player_name || player.source_player_id} <small>{[player.player_position, player.rating, player.age && `age ${player.age}`].filter(Boolean).join(' · ')}</small>
                  </label>
                ))}
              </div>
              <p><input placeholder="Or SM player IDs, comma-separated" value={sale.extraIds} onChange={(event) => setSale({ ...sale, extraIds: event.target.value })} size={30} /></p>
              {sale.players.length + sale.extraIds.split(/[\s,;/]+/).filter(Boolean).length > 1 && <p><strong>Either-or:</strong> selling any one of these meets the ruling; the others are then released.</p>}
            </fieldset>
          )}
          <p><input style={{ width: '100%' }} placeholder="Reason (the ruling)" value={sale.reason} onChange={(event) => setSale({ ...sale, reason: event.target.value })} /></p>
          <button type="submit">Record required sale</button>
        </form>
      </section>
    </>
  );
}
