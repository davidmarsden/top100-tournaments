import { useEffect, useState } from 'react';
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
      {result && (result.n ? (
        <div className="top100-market__estimate" role="status">
          <div className="top100-app-card__headline"><strong>{money(result.mid)}</strong><span>likely range {money(result.low)} – {money(result.high)}</span></div>
          <p className="muted">
            From {result.n} similar deal{result.n === 1 ? '' : 's'} ({result.basis})
            {result.fromValue ? `, at a typical ${ratio(result.medianRatio)} the player's value.` : '.'}
          </p>
          {result.comparables?.length > 0 && (
            <>
              <p className="eyebrow">Similar deals</p>
              <ul>{result.comparables.map((row, index) => (
                <li key={index}><strong>{row.player}</strong> <span className="muted">{row.position} · {row.age} · {row.rating}</span>
                  <div className="muted">{row.from} → {row.to} · {money(row.fee)} ({ratio(row.ratio)} value) · {shortDate(row.seenAt)}</div></li>
              ))}</ul>
            </>
          )}
          {result.listed?.length > 0 && (
            <>
              <p className="eyebrow">On the transfer list now</p>
              <ul>{result.listed.map((row, index) => (
                <li key={index}><strong>{row.player}</strong> <span className="muted">{row.club} · {row.position} · {row.age} · {row.rating}</span>
                  <div className="muted">Value {money(row.value)} · {row.askingPrice ? `asking ${money(row.askingPrice)}` : (row.askingLabel || 'no asking price')}{row.concern ? ` · ${row.concern}` : ''}</div></li>
              ))}</ul>
            </>
          )}
        </div>
      ) : <p className="muted" role="status">No similar completed deals yet.</p>)}
    </div>
  );
}

// What players have sold for in this game world, by position and rating, from completed transfers.
// Part exchanges and deals linked to another one between the same clubs are left out.
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
  if (!data || !data.clean) return null;

  const cell = (group, band) => group.bands?.find((row) => row.band === band);
  const excluded = (data.excluded?.partExchange || 0) + (data.excluded?.linked || 0);
  return (
    <details className="top100-market">
      <summary><h3>Market rates</h3><span className="muted">What players sell for in {data.world || 'this game world'}</span></summary>
      <p className="muted">
        Median fee by position and rating, from {data.clean} completed deals since {shortDate(data.firstDeal)}.
        Bought from computer clubs, players typically go for {ratio(data.ratio?.fromAiClubs)} their value; from other managers, {ratio(data.ratio?.fromManagers)}.
        {excluded ? ` ${excluded} part-exchange or multi-part deals are left out, as their fees don't show the full price.` : ''}
      </p>
      <div className="table-wrap">
        <table className="top100-market__table">
          <thead><tr><th><span className="is-long">Position</span><span className="is-short">Pos</span></th>{RATING_BANDS.map((band) => <th key={band}>{band}</th>)}</tr></thead>
          <tbody>
            {data.groups.map((group) => (
              <tr key={group.group}>
                <th scope="row" title={GROUP_LABEL[group.group]}><span className="is-long">{GROUP_LABEL[group.group] || group.group}</span><span className="is-short">{group.group}</span></th>
                {RATING_BANDS.map((band) => {
                  const row = cell(group, band);
                  if (!row) return <td key={band} className="muted">—</td>;
                  return (
                    <td key={band} className={row.n < THIN ? 'is-thin' : undefined}
                      title={`${row.n} deal${row.n === 1 ? '' : 's'} · middle half ${money(row.p25Fee)}–${money(row.p75Fee)} · ${ratio(row.medianRatio)} value`}>
                      <strong>{money(row.medianFee)}</strong><span>{ratio(row.medianRatio)} · {row.n}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data.ages?.length > 0 && (
        <p className="muted">By age: {data.ages.map((row) => `${row.band} ${ratio(row.medianRatio)}`).join(' · ')} of value.</p>
      )}
      <PriceCheck worldId={data.worldId} />
      <p className="muted top100-app-card__meta">Cells show the median fee, then fee ÷ player value and the number of deals. Faint cells have fewer than {THIN} deals.</p>
    </details>
  );
}
