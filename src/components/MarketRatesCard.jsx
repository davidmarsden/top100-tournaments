import { useEffect, useState } from 'react';
import { playerName } from '../lib/playerName';
import { supabase } from '../lib/supabaseClient';

export const POSITION_GROUPS = [
  ['GK', 'Goalkeepers'], ['CB', 'Centre-backs'], ['FB', 'Full-backs'], ['DM', 'Defensive midfielders'],
  ['CM', 'Central midfielders'], ['W', 'Wingers'], ['AM', 'Attacking midfielders'], ['ST', 'Strikers'],
];
const GROUP_LABEL = Object.fromEntries(POSITION_GROUPS);
const RATING_BANDS = ['under 75', '75-79', '80-84', '85-89', '90+'];
// Fewer deals than this in a cell: shown faintly, as a rough guide only.
const THIN = 5;

export function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '—';
  if (number >= 1e9) return `£${(number / 1e9).toFixed(2)}bn`;
  if (number >= 1e6) return `£${(number / 1e6).toFixed(1)}m`;
  return `£${Math.round(number / 1e3)}k`;
}
const ratio = (value) => (value === null || value === undefined ? '—' : `${Number(value).toFixed(2)}×`);
const shortDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');

// Parses "2.5m", "750k", "£1,200,000" or a plain number into pounds. Empty or unreadable: null.
export function parseMoney(text) {
  const clean = String(text ?? '').replace(/[£,\s]/g, '').toLowerCase();
  if (!clean) return null;
  const match = /^(\d+(?:\.\d+)?)(m|k|bn)?$/.exec(clean);
  if (!match) return null;
  const multiplier = { m: 1e6, k: 1e3, bn: 1e9 }[match[2]] || 1;
  return Math.round(Number(match[1]) * multiplier);
}

function PriceCheck({ worldId }) {
  const [form, setForm] = useState({ group: 'ST', age: '24', rating: '85', value: '' });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function check(event) {
    event.preventDefault();
    const value = parseMoney(form.value);
    if (form.value.trim() && value === null) { setError('Enter the value like 2.5m or 750k, or leave it empty.'); return; }
    setBusy(true);
    setError('');
    const { data, error: rpcError } = await supabase.rpc('market_price_check', {
      p_game_world_id: worldId, p_position_group: form.group, p_age: Number(form.age), p_rating: Number(form.rating), p_value: value,
    });
    setBusy(false);
    if (rpcError) { setError(rpcError.message || 'Could not check the price.'); setResult(null); return; }
    setResult(data);
  }

  return (
    <div className="top100-market__check">
      <p className="eyebrow">Price check</p>
      <form onSubmit={check}>
        <label>Position
          <select value={form.group} onChange={set('group')}>{POSITION_GROUPS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
        </label>
        <label>Age<input type="number" min="14" max="45" value={form.age} onChange={set('age')} required /></label>
        <label>Rating<input type="number" min="40" max="99" value={form.rating} onChange={set('rating')} required /></label>
        <label>Value (optional)<input type="text" inputMode="decimal" placeholder="e.g. 2.5m" value={form.value} onChange={set('value')} /></label>
        <button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Check'}</button>
      </form>
      {error && <p className="status" role="status">{error}</p>}
      {result && (
        <div className="top100-market__estimate" role="status">
          <EstimateBlock title="From another manager" side={result.managers} total />
          <EstimateBlock title="From a computer club" side={result.computer} />
          {result.listed?.length > 0 && (
            <>
              <p className="eyebrow">On the transfer list now</p>
              <ul>{result.listed.map((row, index) => (
                <li key={index}><strong>{playerName(row.player)}</strong> <span className="muted">{row.club} · {row.position} · {row.age} · {row.rating}</span>
                  <div className="muted">Value {money(row.value)} · {row.askingPrice ? `asking ${money(row.askingPrice)}` : (row.askingLabel || 'no asking price')}{row.concern ? ` · ${row.concern}` : ''}</div></li>
              ))}</ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// What a deal cost: cash, plus the players who went the other way.
function DealPrice({ row }) {
  const back = (row.playersBack || []).filter((p) => p && p.name);
  if (!back.length) return <>{money(row.fee)}</>;
  return (
    <>
      {Number(row.fee) > 0 ? `${money(row.fee)} + ` : ''}
      {back.map((p) => `${playerName(p.name)}${p.rating ? ` (${p.rating})` : ''}`).join(' + ')}
      {' '}≈ {money(row.total)}
    </>
  );
}

function EstimateBlock({ title, side, total = false }) {
  if (!side) return null;
  if (!side.n) return (<><p className="eyebrow">{title}</p><p className="muted">No similar completed deals yet.</p></>);
  const pxShare = Number(side.partExchangeShare) || 0;
  return (
    <>
      <p className="eyebrow">{title}</p>
      <div className="top100-app-card__headline"><strong>{money(side.mid)}</strong><span>likely {money(side.low)} – {money(side.high)}{total ? ' in cash and players' : ' cash'}</span></div>
      <p className="muted">
        From {side.n} similar deal{side.n === 1 ? '' : 's'} ({side.basis}){side.fromValue ? `, at a typical ${ratio(side.medianRatio)} the player's value` : ''}.
        {total && pxShare > 0 ? ` ${Math.round(pxShare * 100)}% were part exchanges, usually ${side.playersBack} player${Number(side.playersBack) === 1 ? '' : 's'} back${side.bestBackRating ? ` (best about ${side.bestBackRating})` : ''}${Number(side.medianCashWithPlayers) > 0 ? ` plus about ${money(side.medianCashWithPlayers)}` : ''}.` : ''}
      </p>
      {side.comparables?.length > 0 && (
        <ul>{side.comparables.map((row, index) => (
          <li key={index}><strong>{playerName(row.player)}</strong> <span className="muted">{row.position} · {row.age} · {row.rating} · value {money(row.value)}</span>
            <div className="muted">{row.from} → {row.to} · <DealPrice row={row} /> ({ratio(row.ratio)} value) · {shortDate(row.seenAt)}</div></li>
        ))}</ul>
      )}
    </>
  );
}

function RatesTable({ groups, valueKey }) {
  const cell = (group, band) => group.bands?.find((row) => row.band === band);
  return (
    <div className="table-wrap">
      <table className="top100-market__table">
        <thead><tr><th><span className="is-long">Position</span><span className="is-short">Pos</span></th>{RATING_BANDS.map((band) => <th key={band}>{band}</th>)}</tr></thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.group}>
              <th scope="row" title={GROUP_LABEL[group.group]}><span className="is-long">{GROUP_LABEL[group.group] || group.group}</span><span className="is-short">{group.group}</span></th>
              {RATING_BANDS.map((band) => {
                const row = cell(group, band);
                if (!row) return <td key={band} className="muted">—</td>;
                return (
                  <td key={band} className={row.n < THIN ? 'is-thin' : undefined} title={`${row.n} deal${row.n === 1 ? '' : 's'} · ${ratio(row.medianRatio)} value`}>
                    <strong>{money(row[valueKey])}</strong><span>{ratio(row.medianRatio)} · {row.n}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function packageLine(b) {
  const px = Math.round((Number(b.partExchangeShare) || 0) * 100);
  const parts = [`about ${money(b.medianTotal)} (${ratio(b.medianRatio)} value)`];
  if (px > 0) {
    parts.push(`${px}% part exchanges, usually ${b.playersBack} player${Number(b.playersBack) === 1 ? '' : 's'} back${b.bestBackRating ? `, best about ${b.bestBackRating}` : ''}${Number(b.cashShare) > 0 ? `, plus cash in ${Math.round(Number(b.cashShare) * 100)}% of those` : ''}`);
  }
  return parts.join(' · ');
}

// What players have sold for in this game world. Between managers, a deal's price is its cash plus
// the value of the players who went the other way; from computer clubs, it's the cash.
export default function MarketRatesCard({ session, worldId }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!session?.user?.id || !supabase || !worldId) return undefined;
    let active = true;
    setData(null);
    supabase.rpc('get_market_rates', { p_game_world_id: worldId }).then(({ data: result, error }) => {
      if (active) setData(error ? null : result);
    });
    return () => { active = false; };
  }, [session?.user?.id, worldId]);
  if (!data || !(data.managers?.deals || data.computer?.deals)) return null;

  const managers = data.managers || {};
  const computer = data.computer || {};
  return (
    <details className="top100-market">
      <summary><h3>Market rates</h3><span className="muted">What players cost in {data.world || 'this game world'}</span><span className="top100-market__toggle" aria-hidden="true" /></summary>

      <p className="eyebrow top100-market__section">Between managers</p>
      <p className="muted">
        {managers.deals} deals since {shortDate(data.firstDeal)}, {Math.round((Number(managers.partExchangeShare) || 0) * 100)}% of them part exchanges.
        Each deal counts its cash plus the value of the players who went the other way; typically {ratio(managers.medianRatio)} the player's value in all.
      </p>
      {managers.bands?.length > 0 && (
        <ul className="top100-market__packages">
          {[...managers.bands].reverse().map((b) => (
            <li key={b.band}><strong>{b.band} rated</strong> <span className="muted">({b.n} deals)</span><div>{packageLine(b)}</div></li>
          ))}
        </ul>
      )}
      {managers.groups?.length > 0 && <RatesTable groups={managers.groups} valueKey="medianTotal" />}
      {data.ages?.length > 0 && (
        <p className="muted">By age: {data.ages.map((row) => `${row.band} ${ratio(row.medianRatio)}`).join(' · ')} of value.</p>
      )}

      {computer.groups?.length > 0 && (
        <>
          <p className="eyebrow top100-market__section">From computer clubs</p>
          <p className="muted">Cash only: {computer.deals} buys, typically {ratio(computer.medianRatio)} the player's value.</p>
          <RatesTable groups={computer.groups} valueKey="medianFee" />
        </>
      )}

      <PriceCheck worldId={data.worldId} />
      <p className="muted top100-app-card__meta">
        Cells show the median price, then price ÷ player value and the number of deals. Faint cells have fewer than {THIN} deals.
        Players going the other way are valued as of the deal where Sync saw them move, otherwise at today's value.
        {data.excluded?.linked ? ` ${data.excluded.linked} swaps split across two transfers are left out.` : ''}
      </p>
    </details>
  );
}
