import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function money(value) {
  if (!hasNumber(value)) return '—';
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(Number(value));
}

function hasNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function number(value, digits = 1) {
  if (!hasNumber(value)) return '—';
  return Number(value).toFixed(digits);
}

function mean(rows, field) {
  const values = rows.map((row) => row[field]).filter(hasNumber).map(Number);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sumKnown(rows, field) {
  const values = rows.map((row) => row[field]).filter(hasNumber).map(Number);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function positionGroup(player) {
  if (player.goalkeeper || /^GK\b/i.test(player.position || '')) return 'Goalkeepers';
  const position = String(player.position || '');
  if (/(^|[,(])(?:AM|F)\b/i.test(position)) return 'Attack';
  if (/(^|[,(])(?:DM|M)\b/i.test(position)) return 'Midfield';
  if (/(^|[,(])D\b/i.test(position)) return 'Defence';
  return 'Other';
}

function playerName(player) {
  return player.name || player.surname || `Player ${player.sourcePlayerId || ''}`.trim();
}

function sortByRatingThenValue(a, b) {
  return Number(b.rating || 0) - Number(a.rating || 0) || Number(b.value || 0) - Number(a.value || 0);
}

export default function ManagerSquadDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadDashboard() {
    setLoading(true);
    setError('');
    try {
      if (!hasSupabaseConfig || !supabase) throw new Error('Supabase is not connected.');
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (!sessionData.session) {
        setDashboard(null);
        return;
      }
      const { data, error: rpcError } = await supabase.rpc('get_my_soccer_manager_dashboard');
      if (rpcError) throw rpcError;
      setDashboard(data || null);
    } catch (loadError) {
      setError(loadError?.message || 'Could not load your squad dashboard.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setLoading(false);
      setDashboard(null);
      setError('Supabase is not connected.');
      return undefined;
    }

    let active = true;
    let subscription = null;

    async function initialise() {
      await loadDashboard();
      if (!active) return;

      const { data: listener } = supabase.auth.onAuthStateChange(async (_event, nextSession) => {
        if (!active) return;
        if (!nextSession) {
          setDashboard(null);
          setError('');
          setLoading(false);
          return;
        }
        await loadDashboard();
      });
      subscription = listener.subscription;
    }

    initialise();
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  const players = dashboard?.players || [];
  const transfers = dashboard?.transfers || [];
  const seniorPlayers = useMemo(() => players.filter((player) => player.youth !== true), [players]);
  const youthPlayers = useMemo(() => players.filter((player) => player.youth === true), [players]);
  const groups = useMemo(() => {
    const output = new Map();
    for (const player of seniorPlayers) {
      const group = positionGroup(player);
      if (!output.has(group)) output.set(group, []);
      output.get(group).push(player);
    }
    return ['Goalkeepers', 'Defence', 'Midfield', 'Attack', 'Other']
      .filter((group) => output.has(group))
      .map((group) => ({ name: group, players: output.get(group).sort(sortByRatingThenValue) }));
  }, [seniorPlayers]);

  const metrics = useMemo(() => ({
    seniorAverageRating: mean(seniorPlayers, 'rating'),
    seniorAverageAge: mean(seniorPlayers, 'age'),
    seniorValue: sumKnown(seniorPlayers, 'value'),
    expiring: seniorPlayers.filter((player) => hasNumber(player.contract) && Number(player.contract) <= 1).length,
    firstTeamReady: seniorPlayers.filter((player) => hasNumber(player.rating) && Number(player.rating) >= 89).length,
    youthAverageRating: mean(youthPlayers, 'rating'),
  }), [seniorPlayers, youthPlayers]);

  const alerts = useMemo(() => seniorPlayers
    .map((player) => {
      const flags = [];
      if (hasNumber(player.contract) && Number(player.contract) <= 1) flags.push('contract ≤1');
      if (hasNumber(player.condition) && Number(player.condition) < 80) flags.push(`condition ${player.condition}`);
      if (hasNumber(player.morale) && Number(player.morale) < 80) flags.push(`morale ${player.morale}`);
      if (hasNumber(player.age) && hasNumber(player.rating) && Number(player.age) >= 33 && Number(player.rating) <= 89) flags.push('succession watch');
      return flags.length ? { player, flags } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.flags.length - a.flags.length || sortByRatingThenValue(a.player, b.player))
    .slice(0, 12), [seniorPlayers]);

  const performers = useMemo(() => [...seniorPlayers]
    .filter((player) => hasNumber(player.averagePerformance))
    .sort((a, b) => Number(b.averagePerformance) - Number(a.averagePerformance))
    .slice(0, 8), [seniorPlayers]);

  const prospects = useMemo(() => [...youthPlayers]
    .sort(sortByRatingThenValue)
    .slice(0, 12), [youthPlayers]);

  if (loading) return <main className="manager-portal-shell"><section className="card"><h1>Loading squad dashboard…</h1></section></main>;
  if (!dashboard && !error) return <main className="manager-portal-shell"><section className="card manager-login-card"><h1>Sign in first</h1><p className="muted">Use your Manager Portal sign-in, then come back to Squad &amp; Transfers.</p><a className="button" href="/">Go to Manager Portal</a></section></main>;
  if (error) return <main className="manager-portal-shell"><section className="card manager-login-card"><h1>Couldn’t load the dashboard</h1><p className="status">{error}</p><button type="button" onClick={loadDashboard}>Try again</button></section></main>;
  if (!dashboard?.teamId) return <main className="manager-portal-shell"><section className="card manager-login-card"><h1>No current club linked</h1><p className="muted">Your Manager Portal account is valid, but there is no current Soccer Manager team assignment for this game world yet.</p><div className="button-row"><a className="button" href="/">Back to My Matches</a><button type="button" className="secondary" onClick={loadDashboard}>Check again</button></div></section></main>;

  return <main className="manager-portal-shell squad-dashboard">
    <section className="manager-portal-hero">
      <div>
        <p className="eyebrow">Squad &amp; Transfers · {dashboard.gameWorldName || 'Top 100'}</p>
        <h1>{dashboard.teamName || 'Your club'}</h1>
        <p>{dashboard.managerName} · private manager view</p>
      </div>
      <div className="button-row"><a className="button secondary" href="/">My Matches</a><button type="button" className="secondary" onClick={loadDashboard}>Refresh</button></div>
    </section>

    <section className="portal-metrics squad-metrics">
      <article><span>Senior squad</span><strong>{seniorPlayers.length}</strong></article>
      <article><span>Senior rating</span><strong>{number(metrics.seniorAverageRating)}</strong></article>
      <article><span>Senior age</span><strong>{number(metrics.seniorAverageAge)}</strong></article>
      <article><span>Senior value</span><strong>{money(metrics.seniorValue)}</strong></article>
      <article><span>89+ senior players</span><strong>{metrics.firstTeamReady}</strong></article>
      <article><span>Senior contract ≤1</span><strong>{metrics.expiring}</strong></article>
      <article><span>Youth squad</span><strong>{youthPlayers.length}</strong></article>
      <article><span>Youth rating</span><strong>{number(metrics.youthAverageRating)}</strong></article>
    </section>

    {dashboard.standing && <section className="card squad-standing">
      <div className="card-header"><p className="eyebrow">League snapshot</p><h2>Division {dashboard.standing.division} · {dashboard.standing.position ? `#${dashboard.standing.position}` : 'Position TBC'}</h2></div>
      <div className="squad-standing-grid">
        <span><strong>{dashboard.standing.points ?? '—'}</strong> pts</span>
        <span><strong>{dashboard.standing.played ?? '—'}</strong> played</span>
        <span><strong>{dashboard.standing.won ?? '—'}–{dashboard.standing.drawn ?? '—'}–{dashboard.standing.lost ?? '—'}</strong> W-D-L</span>
        <span><strong>{dashboard.standing.goalDifference > 0 ? '+' : ''}{dashboard.standing.goalDifference ?? '—'}</strong> GD</span>
      </div>
    </section>}

    <section className="portal-grid">
      <article className="card portal-panel">
        <div className="card-header"><p className="eyebrow">Performance</p><h2>Top performers</h2></div>
        <div className="squad-list">{performers.map((player) => <div className="squad-list-row" key={player.id}><div><strong>{playerName(player)}</strong><span>{player.position || '—'} · {player.rating ?? '—'} rated · {player.goals ?? 0}G {player.assists ?? 0}A</span></div><b>{number(player.averagePerformance, 2)}</b></div>)}</div>
      </article>
      <article className="card portal-panel">
        <div className="card-header"><p className="eyebrow">Attention</p><h2>Squad watchlist</h2></div>
        {alerts.length ? <div className="squad-list">{alerts.map(({ player, flags }) => <div className="squad-list-row" key={player.id}><div><strong>{playerName(player)}</strong><span>{player.age ?? '—'} · {player.position || '—'} · {player.rating ?? '—'} rated</span></div><div className="squad-tags">{flags.map((flag) => <span key={flag}>{flag}</span>)}</div></div>)}</div> : <p className="muted">No immediate contract, condition, morale or succession flags.</p>}
      </article>
    </section>

    <section className="card portal-panel">
      <div className="card-header"><p className="eyebrow">Depth</p><h2>Squad by position</h2></div>
      <div className="squad-depth-grid">{groups.map((group) => <article key={group.name}><h3>{group.name} <span>{group.players.length}</span></h3><div className="squad-depth-players">{group.players.map((player) => <div key={player.id}><strong>{playerName(player)}</strong><span>{player.rating ?? '—'} · age {player.age ?? '—'} · {money(player.value)}</span></div>)}</div></article>)}</div>
    </section>

    <section className="card portal-panel">
      <div className="card-header"><p className="eyebrow">Development</p><h2>Youth pipeline</h2></div>
      <div className="squad-depth-grid">{prospects.map((player) => <article key={player.id}><h3>{playerName(player)} <span>{player.rating ?? '—'}</span></h3><div className="squad-depth-players"><div><strong>{player.position || '—'}</strong><span>age {player.age ?? '—'} · {money(player.value)} · contract {player.contract ?? '—'}</span></div></div></article>)}</div>
    </section>

    <section className="card portal-panel">
      <div className="card-header"><p className="eyebrow">Market</p><h2>Transfers involving {dashboard.teamName}</h2></div>
      {transfers.length ? <div className="squad-list">{transfers.map((transfer) => <div className="squad-list-row transfer-row" key={transfer.id}><div><strong><span className={`transfer-direction ${transfer.direction}`}>{transfer.direction === 'in' ? 'IN' : 'OUT'}</span> {transfer.playerName}</strong><span>{transfer.rating ?? '—'} · {transfer.position || '—'} · {transfer.counterpartyClubName || 'Unknown club'}{transfer.counterpartyIsTop100 ? ' · Top 100' : ' · external club'}</span></div><div className="transfer-money"><b>{money(transfer.amount)}</b><span>{transfer.acceptedDate || 'Date unknown'}{transfer.turn ? ` · turn ${transfer.turn}` : ''}</span></div></div>)}</div> : <p className="muted">No archived transfers involving this club yet.</p>}
    </section>
  </main>;
}
