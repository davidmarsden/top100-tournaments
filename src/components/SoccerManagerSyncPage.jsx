import { useMemo, useState } from 'react';
import { normalizeSoccerManagerPayload, summarizeNormalizedPayload } from '../lib/soccerManagerSync';

function formatValue(value) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number' && Math.abs(value) >= 1000) return value.toLocaleString('en-GB');
  return String(value);
}

function SummaryCards({ summary }) {
  return <div className="overview-metrics">
    {Object.entries(summary).map(([key, value]) => <article key={key}>
      <span>{key.replace(/([A-Z])/g, ' $1')}</span>
      <strong>{formatValue(value)}</strong>
    </article>)}
  </div>;
}

function CompetitionPreview({ payload }) {
  return <>
    <section className="card module-card">
      <div className="card-header"><p className="eyebrow">World snapshot</p><h2>Divisions and standings</h2></div>
      <div className="standings-grid">
        {payload.divisions.map((division) => <article className="standings-card" key={division.leagueId}>
          <div className="standings-header"><h3>{division.name}</h3><span>{division.standings.length} clubs</span></div>
          <div className="table-wrap"><table><thead><tr><th>#</th><th>Club</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>
            {division.standings.map((club) => <tr key={club.clubId}><td>{club.position}</td><td><strong>{club.name}</strong><span>{club.clubId}</span></td><td>{club.played}</td><td>{club.won}</td><td>{club.drawn}</td><td>{club.lost}</td><td>{club.goalDifference}</td><td><strong>{club.points}</strong></td></tr>)}
          </tbody></table></div>
        </article>)}
      </div>
    </section>

    <section className="grid two-columns">
      <article className="card module-card">
        <div className="card-header"><p className="eyebrow">Latest</p><h2>Results</h2></div>
        <div className="entrant-list">{payload.results.map((match) => <div className="entrant-row" key={match.sourceId}><div><strong>{match.homeName} {match.homeScore}–{match.awayScore} {match.awayName}</strong><span>{match.fixtureDate} · {match.sourceId}</span></div></div>)}</div>
      </article>
      <article className="card module-card">
        <div className="card-header"><p className="eyebrow">Next</p><h2>Fixtures</h2></div>
        <div className="entrant-list">{payload.fixtures.map((match) => <div className="entrant-row" key={match.sourceId}><div><strong>{match.homeName} v {match.awayName}</strong><span>{match.fixtureDate} · {match.sourceId}</span></div></div>)}</div>
      </article>
    </section>
  </>;
}

function PlayerChangesPreview({ payload }) {
  const rows = [...payload.changes, ...payload.newPlayers];
  return <section className="card module-card">
    <div className="card-header"><p className="eyebrow">Player database</p><h2>Changes and new players</h2></div>
    <div className="table-wrap"><table><thead><tr><th>Player</th><th>Club</th><th>Age</th><th>Rating</th><th>Change</th><th>Position</th></tr></thead><tbody>
      {rows.map((row, index) => <tr key={row.playerId || index}><td><strong>{row.name}</strong><span>{row.playerId}</span></td><td>{row.clubName || 'Free Agent'}</td><td>{row.age}</td><td>{row.oldRating ?? '—'} → {row.newRating ?? row.rating ?? '—'}</td><td>{row.changeLabel || row.kind}</td><td>{row.position}</td></tr>)}
    </tbody></table></div>
  </section>;
}

function TransfersPreview({ payload }) {
  return <section className="card module-card">
    <div className="card-header"><p className="eyebrow">Transfer market</p><h2>Deals</h2></div>
    <div className="table-wrap"><table><thead><tr><th>Player</th><th>From</th><th>To</th><th>Rating</th><th>Amount</th><th>Status</th></tr></thead><tbody>
      {payload.transfers.map((row) => <tr key={row.transferId}><td><strong>{row.playerName}</strong><span>{row.playerId}</span></td><td>{row.fromClubName}</td><td>{row.toClubName}</td><td>{row.rating}</td><td>{row.amount?.toLocaleString('en-GB') ?? '—'}</td><td>{row.illegal ? 'Flagged' : row.statusLabel || row.status}</td></tr>)}
    </tbody></table></div>
  </section>;
}

function FinancePreview({ payload }) {
  return <section className="card module-card">
    <div className="card-header"><p className="eyebrow">Club finance</p><h2>Season and weekly figures</h2></div>
    <SummaryCards summary={{ balance: payload.season.balance, profit: payload.season.profit, income: payload.season.totalIncome, outgoings: payload.season.totalOutgoings, wages: payload.season.wages, transferSpend: payload.season.transfersOut }} />
    <div className="table-wrap"><table><thead><tr><th>Week</th><th>Income</th><th>Outgoings</th><th>Balance</th><th>Wages</th></tr></thead><tbody>
      {payload.weekly.map((week, index) => <tr key={week.weekStart || index}><td>{week.weekStart}</td><td>{formatValue(week.income)}</td><td>{formatValue(week.outgoings)}</td><td>{formatValue(week.balance)}</td><td>{formatValue(week.wages)}</td></tr>)}
    </tbody></table></div>
  </section>;
}

export default function SoccerManagerSyncPage() {
  const [payloads, setPayloads] = useState([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [status, setStatus] = useState('Drop Soccer Manager JSON responses here. Nothing is written to the database in v0.1.');
  const totalSummary = useMemo(() => payloads.map((entry) => ({ name: entry.name, ...summarizeNormalizedPayload(entry.payload) })), [payloads]);

  async function importFiles(files) {
    const next = [];
    const errors = [];
    for (const file of Array.from(files || [])) {
      try {
        const raw = JSON.parse(await file.text());
        const payload = normalizeSoccerManagerPayload(raw);
        next.push({ name: file.name, payload });
      } catch (error) {
        errors.push(`${file.name}: ${error.message}`);
      }
    }
    setPayloads(next);
    setStatus(errors.length ? `Loaded ${next.length} file(s). ${errors.join(' ')}` : `Loaded and normalized ${next.length} Soccer Manager response${next.length === 1 ? '' : 's'}.`);
  }

  function downloadNormalized() {
    const blob = new Blob([JSON.stringify(payloads.map((entry) => ({ source: entry.name, ...entry.payload })), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `top100-sm-sync-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <main className="app-shell">
    <section className="hero"><div className="hero-row"><div><p className="eyebrow">Top 100 data tools</p><h1>Soccer Manager Sync</h1><p>Turn Soccer Manager's internal JSON responses into clean Top 100 records before we automate collection or write anything to production.</p></div><div className="button-row"><a className="button secondary" href="/admin">Tournament admin</a><a className="button secondary" href="/admin/manager-accounts">Manager accounts</a></div></div></section>

    <section className="card module-card">
      <div className="card-header"><p className="eyebrow">v0.1 · preview only</p><h2>Import captured JSON</h2></div>
      <div className="sm-sync-drop">
        <input key={fileInputKey} id="sm-sync-files" type="file" accept=".json,application/json" multiple onChange={(event) => importFiles(event.target.files)} />
        <p className="muted">Supported now: competition snapshot, player changes, transfer market and club finance responses. Raw files stay in your browser.</p>
      </div>
      <p className="status">{status}</p>
      {!!payloads.length && <div className="button-row"><button type="button" onClick={downloadNormalized}>Download normalized snapshot</button><button type="button" className="secondary" onClick={() => { setPayloads([]); setFileInputKey((value) => value + 1); setStatus('Cleared.'); }}>Clear</button></div>}
    </section>

    {!!totalSummary.length && <section className="card module-card">
      <div className="card-header"><p className="eyebrow">Import summary</p><h2>What we found</h2></div>
      {totalSummary.map((summary) => <div key={summary.name} className="sm-sync-summary"><strong>{summary.name}</strong><SummaryCards summary={Object.fromEntries(Object.entries(summary).filter(([key]) => key !== 'name'))} /></div>)}
    </section>}

    {payloads.map((entry) => <div key={entry.name}>
      {entry.payload.kind === 'competition' && <CompetitionPreview payload={entry.payload} />}
      {entry.payload.kind === 'playerChanges' && <PlayerChangesPreview payload={entry.payload} />}
      {entry.payload.kind === 'transfers' && <TransfersPreview payload={entry.payload} />}
      {entry.payload.kind === 'clubFinance' && <FinancePreview payload={entry.payload} />}
    </div>)}
  </main>;
}
