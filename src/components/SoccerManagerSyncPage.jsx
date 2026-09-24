import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeSoccerManagerPayload, summarizeNormalizedPayload } from '../lib/soccerManagerSync';
import { normalizeSoccerManagerMatchReplay, summarizeMatchReplay } from '../lib/soccerManagerMatchReplay';
import {
  collectorBookmarklet,
  isAllowedSoccerManagerOrigin,
  MATCH_ENGINE_DIAGNOSTIC_PATHS,
  soccerManagerCollectorProtocol,
} from '../lib/soccerManagerCollector';
import { normalizedPayloadForPersistence, stageSoccerManagerSync } from '../lib/soccerManagerSyncPersistence';
import SoccerManagerSyncReview from './SoccerManagerSyncReview.jsx';
import SoccerManagerArchiveAdapter from './SoccerManagerArchiveAdapter.jsx';

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

function MatchReplayPreview({ payload }) {
  const summary = summarizeMatchReplay(payload);
  return <section className="card module-card">
    <div className="card-header"><p className="eyebrow">Match archive candidate</p><h2>{summary.match}</h2></div>
    <SummaryCards summary={summary} />
    <div className="grid two-columns">
      <article>
        <h3>Key chances</h3>
        <div className="entrant-list">
          {(payload.chances || []).map((chance) => <div className="entrant-row" key={`${chance.sequence}:${chance.minute}`}>
            <div>
              <strong>{chance.minute}' · {chance.teamSide === 'h' ? payload.fixture.homeName : payload.fixture.awayName} · {chance.outcome}</strong>
              <span>{chance.player?.surname || chance.player?.firstName || chance.player?.playerId || 'Unknown player'}{chance.secondaryPlayer?.playerId ? ` · supplied by ${chance.secondaryPlayer.surname || chance.secondaryPlayer.playerId}` : ''}</span>
            </div>
          </div>)}
        </div>
      </article>
      <article>
        <h3>Substitutions</h3>
        <div className="entrant-list">
          {(payload.substitutions || []).map((subs) => <div className="entrant-row" key={`${subs.sequence}:${subs.minute}`}>
            <div>
              <strong>{subs.minute}' · {subs.teamSide === 'h' ? payload.fixture.homeName : payload.fixture.awayName}</strong>
              <span>{subs.offPlayerIds.length} off · {subs.onPlayerIds.length} on</span>
            </div>
          </div>)}
        </div>
      </article>
    </div>
  </section>;
}

function ClubSquadPreview({ payload }) {
  return <section className="card module-card">
    <div className="card-header"><p className="eyebrow">Club squad</p><h2>{payload.club.name || payload.club.clubId || 'Squad snapshot'}</h2></div>
    <SummaryCards summary={{ clubId: payload.club.clubId, setupId: payload.club.setupId, players: payload.players.length }} />
    {!!payload.schema?.playerKeys?.length && <details className="sm-sync-schema">
      <summary>Raw squad field names ({payload.schema.playerKeys.length})</summary>
      <p className="muted">Field names only — no raw player values are included.</p>
      <div className="sm-sync-field-list">{payload.schema.playerKeys.map((key) => <code key={key}>{key}</code>)}</div>
    </details>}
    <div className="table-wrap"><table><thead><tr><th>Player</th><th>Age</th><th>Pos</th><th>Rat</th><th>Value</th><th>Wages</th><th>Morale</th><th>Cond</th><th>Apps</th><th>G</th><th>A</th></tr></thead><tbody>
      {payload.players.map((row, index) => <tr key={row.playerId || row.playerDataId || index}>
        <td><strong>{row.name || row.shortName || row.surname || 'Unknown'}</strong><span>{row.playerId}</span></td>
        <td>{formatValue(row.age)}</td><td>{row.position || '—'}</td><td>{formatValue(row.rating)}</td><td>{formatValue(row.value)}</td><td>{formatValue(row.wages)}</td><td>{formatValue(row.morale)}</td><td>{formatValue(row.condition)}</td><td>{formatValue(row.appearances)}</td><td>{formatValue(row.goals)}</td><td>{formatValue(row.assists)}</td>
      </tr>)}
    </tbody></table></div>
  </section>;
}


export default function SoccerManagerSyncPage() {
  const [payloads, setPayloads] = useState([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [status, setStatus] = useState('Drop Soccer Manager JSON responses here, or send them directly from Soccer Manager with the browser collector. Nothing is written to the database.');
  const [collectorStatus, setCollectorStatus] = useState('');
  const [diagnostics, setDiagnostics] = useState([]);
  const [diagnosticsCapturedAt, setDiagnosticsCapturedAt] = useState(null);
  const [matchEngineSources, setMatchEngineSources] = useState([]);
  const [matchReplay, setMatchReplay] = useState(null);
  const [replayPageContext, setReplayPageContext] = useState(null);
  const [stageStatus, setStageStatus] = useState('');
  const [stageBusy, setStageBusy] = useState(false);
  const [reviewRefreshToken, setReviewRefreshToken] = useState(0);
  const [archiveRefreshToken, setArchiveRefreshToken] = useState(0);
  const collectorLinkRef = useRef(null);
  const totalSummary = useMemo(() => payloads.map((entry) => ({
    id: entry.id,
    name: entry.name,
    ...(entry.payload?.kind === 'matchReplay'
      ? summarizeMatchReplay(entry.payload)
      : summarizeNormalizedPayload(entry.payload)),
  })), [payloads]);

  function normalizeCapturedEntries(entries) {
    const next = [];
    const errors = [];
    const seenFinanceCompanions = new Map();

    function financeCompanionContext(sourceUrl) {
      if (!sourceUrl) return null;
      try {
        const url = new URL(sourceUrl);
        const action = url.searchParams.get('action');
        if (action !== 'clubfinance' && action !== 'incomegraph') return null;
        url.searchParams.delete('action');
        url.searchParams.sort();
        return { action, context: `${url.origin}${url.pathname}?${url.searchParams.toString()}` };
      } catch {
        return null;
      }
    }

    for (const entry of entries) {
      try {
        const payload = normalizeSoccerManagerPayload(entry.raw, { sourceUrl: entry.sourceUrl });
        if (payload.kind === 'clubFinance') {
          const companion = financeCompanionContext(entry.sourceUrl);
          if (companion) {
            const signature = `${companion.context}:${JSON.stringify(payload)}`;
            const previousAction = seenFinanceCompanions.get(signature);
            if (previousAction && previousAction !== companion.action) continue;
            seenFinanceCompanions.set(signature, companion.action);
          }
        }
        next.push({
          id: entry.id || entry.sourceUrl || entry.name,
          name: entry.name,
          sourceUrl: entry.sourceUrl || null,
          payload,
        });
      } catch (error) {
        errors.push(`${entry.name}: ${error.message}`);
      }
    }
    return { next, errors };
  }

  useEffect(() => {
    if (collectorLinkRef.current) {
      collectorLinkRef.current.setAttribute('href', collectorBookmarklet());
    }
  }, []);

  useEffect(() => {
    function handleCollectorMessage(event) {
      if (!isAllowedSoccerManagerOrigin(event.origin)) return;
      const message = event.data;
      const collectorSession = new URLSearchParams(window.location.search).get('collectorSession');
      if (!collectorSession || !message || message.version !== 1 || message.session !== collectorSession) return;
      if (message.sourceOrigin !== event.origin) return;

      if (message.type === soccerManagerCollectorProtocol.helloType) {
        if (event.source && typeof event.source.postMessage === 'function') {
          event.source.postMessage({
            type: soccerManagerCollectorProtocol.readyType,
            session: collectorSession,
          }, event.origin);
        }
        return;
      }

      if (message.type !== soccerManagerCollectorProtocol.messageType || !Array.isArray(message.payloads)) return;

      const diagnosticRows = Array.isArray(message.diagnostics)
        ? message.diagnostics.slice(-50).filter((row) => typeof row?.url === 'string')
        : [];
      const allowedEnginePaths = new Set(MATCH_ENGINE_DIAGNOSTIC_PATHS);
      const engineRows = [];
      const engineSeenPaths = new Set();
      let engineChars = 0;
      for (const row of Array.isArray(message.matchEngineSources) ? message.matchEngineSources : []) {
        if (engineRows.length >= MATCH_ENGINE_DIAGNOSTIC_PATHS.length) break;
        if (!row || typeof row.url !== 'string') continue;
        let pathname;
        try {
          const url = new URL(row.url);
          if (url.origin !== event.origin || !allowedEnginePaths.has(url.pathname)) continue;
          pathname = url.pathname;
        } catch {
          continue;
        }
        if (engineSeenPaths.has(pathname)) continue;
        if (row.source !== null && typeof row.source !== 'string') continue;
        if (typeof row.source === 'string') {
          if (row.source.length > 2000000 || engineChars + row.source.length > 6000000) continue;
          engineChars += row.source.length;
        }
        if (row.error !== null && row.error !== undefined && typeof row.error !== 'string') continue;
        engineSeenPaths.add(pathname);
        engineRows.push(row);
      }
      let replayRow = null;
      if (message.matchReplay && typeof message.matchReplay === 'object') {
        const row = message.matchReplay;
        let validUrl = false;
        if (typeof row.url === 'string') {
          try {
            validUrl = new URL(row.url).origin === event.origin;
          } catch {
            validUrl = false;
          }
        }
        const xmlValid = row.xml === null || (typeof row.xml === 'string' && row.xml.length <= 2000000);
        const errorValid = row.error === null || row.error === undefined || typeof row.error === 'string';
        if (validUrl && xmlValid && errorValid) {
          replayRow = {
            url: row.url,
            xml: typeof row.xml === 'string' ? row.xml : null,
            error: row.error || null,
          };
        }
      }
      setDiagnostics(diagnosticRows);
      setMatchEngineSources(engineRows);
      setMatchReplay(replayRow);
      let replayContextRow = null;
      if (message.replayPageContext && typeof message.replayPageContext === 'object') {
        const row = message.replayPageContext;
        try {
          const url = new URL(row.pageUrl);
          const rawParams = row.params && typeof row.params === 'object' && !Array.isArray(row.params) ? row.params : {};
          const rawIdentifiers = row.identifiers && typeof row.identifiers === 'object' && !Array.isArray(row.identifiers) ? row.identifiers : {};
          const rawSignals = Array.isArray(row.scriptSignals) ? row.scriptSignals : [];
          const paramKeys = Object.keys(rawParams);
          const identifierKeys = Object.keys(rawIdentifiers);
          const shapeWithinLimits = paramKeys.length <= 40 && identifierKeys.length <= 80 && rawSignals.length <= 120;
          const boundedMap = (value, keys) => Object.fromEntries(keys.map((key) => [key, value[key]]));
          const entriesValid = [...paramKeys.map((key) => [key, rawParams[key]]), ...identifierKeys.map((key) => [key, rawIdentifiers[key]])]
            .every(([key, entry]) => typeof key === 'string' && key.length <= 120 && typeof entry === 'string' && entry.length <= 500);
          const signalsValid = rawSignals.every((value) => value && typeof value.key === 'string' && value.key.length <= 80 && typeof value.value === 'string' && value.value.length <= 500);
          const candidate = shapeWithinLimits && entriesValid && signalsValid
            ? { pageUrl: row.pageUrl, params: boundedMap(rawParams, paramKeys), identifiers: boundedMap(rawIdentifiers, identifierKeys), scriptSignals: rawSignals }
            : null;
          if (candidate && url.origin === event.origin && JSON.stringify(candidate).length <= 100000) {
            replayContextRow = candidate;
          }
        } catch {
          replayContextRow = null;
        }
      }
      setReplayPageContext(replayContextRow);
      setDiagnosticsCapturedAt(typeof message.capturedAt === 'string' ? message.capturedAt : null);

      const entries = message.payloads.slice(-20).map((item, index) => {
        let name = `Soccer Manager response ${index + 1}`;
        try {
          const url = new URL(item?.url);
          name = url.pathname.split('/').filter(Boolean).pop() || name;
        } catch {
          // Keep the generic label; the URL is metadata only.
        }
        const sourceUrl = typeof item?.url === 'string' ? item.url : null;
        return { id: sourceUrl || `${name}:${index}`, name, sourceUrl, raw: item?.data };
      });

      const { next, errors } = normalizeCapturedEntries(entries);
      if (replayRow?.xml) {
        try {
          const payload = normalizeSoccerManagerMatchReplay(replayRow.xml, replayRow.url);
          next.push({
            id: `match-replay:${payload.source.setupId || 'unknown'}:${payload.source.fixtureId}`,
            name: `Match replay ${payload.source.fixtureId}`,
            sourceUrl: replayRow.url,
            payload,
          });
        } catch (error) {
          errors.push(`Match replay: ${error.message}`);
        }
      }
      setPayloads(next);
      setStatus(errors.length
        ? `Received ${next.length} supported response(s) from Soccer Manager. ${errors.join(' ')}`
        : next.length
          ? `Received and normalized ${next.length} Soccer Manager response${next.length === 1 ? '' : 's'} directly from your logged-in tab.`
          : replayRow?.xml
            ? 'Captured the match replay but could not normalize it. See the error above.'
            : diagnosticRows.length
              ? `No supported JSON response matched yet. Captured ${diagnosticRows.length} recent Soccer Manager request URL${diagnosticRows.length === 1 ? '' : 's'} for diagnosis.`
              : 'No supported JSON responses or request diagnostics were received.');
      const sourceCount = engineRows.filter((row) => typeof row.source === 'string').length;
      setCollectorStatus(
        `Last browser sync: ${new Date().toLocaleString('en-GB')} · ${event.origin}`
        + (engineRows.length ? ` · match-engine sources ${sourceCount}/${engineRows.length}` : '')
        + (replayRow ? ` · match replay ${replayRow.xml ? 'captured' : 'detected'}` : '')
        + (replayContextRow ? ' · replay page context captured' : ''),
      );

      if (event.source && typeof event.source.postMessage === 'function') {
        event.source.postMessage({ type: soccerManagerCollectorProtocol.ackType, session: collectorSession, accepted: next.length, rejected: errors.length }, event.origin);
      }
    }

    window.addEventListener('message', handleCollectorMessage);
    return () => window.removeEventListener('message', handleCollectorMessage);
  }, []);

  async function copyCollector() {
    try {
      await navigator.clipboard.writeText(collectorBookmarklet());
      setCollectorStatus('Collector bookmarklet copied. Create a browser bookmark and paste it into the bookmark URL/location field.');
    } catch {
      setCollectorStatus('Could not copy automatically. Drag the “Top 100 Sync” link to your bookmarks bar instead.');
    }
  }

  async function importFiles(files) {
    const entries = [];
    const readErrors = [];
    for (const file of Array.from(files || [])) {
      try {
        entries.push({ name: file.name, raw: JSON.parse(await file.text()) });
      } catch (error) {
        readErrors.push(`${file.name}: ${error.message}`);
      }
    }
    const { next, errors } = normalizeCapturedEntries(entries);
    const allErrors = [...readErrors, ...errors];
    setDiagnosticsCapturedAt(null);
    setMatchEngineSources([]);
    setMatchReplay(null);
    setReplayPageContext(null);
    setPayloads(next);
    setStatus(allErrors.length ? `Loaded ${next.length} file(s). ${allErrors.join(' ')}` : `Loaded and normalized ${next.length} Soccer Manager response${next.length === 1 ? '' : 's'}.`);
    // Always remount the native input after an import attempt. Browsers often
    // suppress change when the same path is selected twice, including after
    // a malformed/unsupported file is corrected in place.
    setFileInputKey((value) => value + 1);
  }

  async function stageForReview() {
    if (!payloads.length) return;
    setStageBusy(true);
    setStageStatus('');
    try {
      const result = await stageSoccerManagerSync(payloads, diagnosticsCapturedAt);
      setStageStatus(`Staged sync #${result.runId}: ${result.sourceCount} source response${result.sourceCount === 1 ? '' : 's'} and ${result.entityCount} normalized entities. Review the differences below before approving them into the canonical source layer.`);
      setReviewRefreshToken((value) => value + 1);
    } catch (error) {
      setStageStatus(`Could not stage this sync: ${error.message}`);
    } finally {
      setStageBusy(false);
    }
  }

  function downloadNormalized() {
    const blob = new Blob([JSON.stringify(normalizedPayloadForPersistence(payloads), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `top100-sm-sync-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }
  function downloadDiagnostics() {
    const blob = new Blob([JSON.stringify({
      capturedAt: diagnosticsCapturedAt,
      requests: diagnostics,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `top100-sm-sync-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadMatchEngineDiagnostics() {
    const blob = new Blob([JSON.stringify({
      capturedAt: diagnosticsCapturedAt,
      files: matchEngineSources.map((row) => ({
        url: row.url,
        source: typeof row.source === 'string' ? row.source : null,
        error: row.error || null,
      })),
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `top100-sm-match-engine-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadReplayPageContextDiagnostics() {
    if (!replayPageContext) return;
    const blob = new Blob([JSON.stringify({
      capturedAt: diagnosticsCapturedAt,
      ...replayPageContext,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `top100-sm-replay-page-context-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function downloadMatchReplayDiagnostics() {
    if (!matchReplay) return;
    const blob = new Blob([JSON.stringify({
      capturedAt: diagnosticsCapturedAt,
      pageUrl: matchReplay.url,
      xml: matchReplay.xml,
      error: matchReplay.error,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `top100-sm-match-replay-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <main className="app-shell">
    <section className="hero"><div className="hero-row"><div><p className="eyebrow">Top 100 data tools</p><h1>Soccer Manager Sync</h1><p>Turn Soccer Manager's internal JSON responses into clean Top 100 records, stage the differences privately, and review them before anything can flow into the public archive.</p></div><div className="button-row"><a className="button secondary" href="/admin">Tournament admin</a><a className="button secondary" href="/admin/manager-accounts">Manager accounts</a></div></div></section>

    <section className="card module-card">
      <div className="card-header"><p className="eyebrow">v0.2 · browser collector</p><h2>Sync from Soccer Manager</h2></div>
      <p>Install the collector once, then use it while you are signed into Soccer Manager. It discovers supported JSON requests already made by the current Soccer Manager page, refetches them inside that same logged-in tab, and sends the JSON directly here. Cookies and passwords are never included. Nothing is persisted unless you explicitly stage the normalized result for review.</p>
      <div className="button-row">
        <a ref={collectorLinkRef} className="button" href="#collector" title="Drag this link to your bookmarks bar" onClick={(event) => event.preventDefault()}>Top 100 Sync</a>
        <button type="button" className="secondary" onClick={copyCollector}>Copy collector bookmarklet</button>
      </div>
      <p className="muted">Desktop: drag “Top 100 Sync” to your bookmarks bar, or copy it and create a bookmark manually. Then visit a league table, club, player changes or transfer-market screen on Soccer Manager and click the bookmark.</p>
      {collectorStatus && <p className="status">{collectorStatus}</p>}
    </section>

    <section className="card module-card">
      <div className="card-header"><p className="eyebrow">Fallback · preview only</p><h2>Import captured JSON</h2></div>
      <div className="sm-sync-drop">
        <input key={fileInputKey} id="sm-sync-files" type="file" accept=".json,application/json" multiple onChange={(event) => importFiles(event.target.files)} />
        <p className="muted">Supported now: competition snapshot, club squad, player changes, transfer market and club finance responses. Raw files stay in your browser.</p>
      </div>
      <p className="status">{status}</p>
      {!!payloads.length && <div className="button-row"><button type="button" onClick={stageForReview} disabled={stageBusy}>{stageBusy ? 'Staging…' : 'Stage for review'}</button><button type="button" className="secondary" onClick={downloadNormalized}>Download normalized snapshot</button><button type="button" className="secondary" onClick={() => { setPayloads([]); setDiagnostics([]); setMatchEngineSources([]); setMatchReplay(null); setReplayPageContext(null); setDiagnosticsCapturedAt(null); setStageStatus(''); setFileInputKey((value) => value + 1); setStatus('Cleared.'); }}>Clear</button></div>}
      {stageStatus && <p className="status">{stageStatus}</p>}
    </section>

    {!!diagnostics.length && <section className="card module-card">
      <div className="card-header"><p className="eyebrow">Diagnostic capture</p><h2>Recent Soccer Manager requests</h2></div>
      <p className="muted">These are the latest same-origin resource URLs visible to the browser. Sensitive-looking query parameters are redacted before they leave Soccer Manager.{diagnosticsCapturedAt ? ` Captured ${new Date(diagnosticsCapturedAt).toLocaleString('en-GB')}.` : ''}</p>
      <div className="button-row"><button type="button" className="secondary" onClick={downloadDiagnostics}>Download diagnostics</button></div>
      <div className="table-wrap"><table><thead><tr><th>#</th><th>Type</th><th>Request</th></tr></thead><tbody>
        {diagnostics.map((row, index) => <tr key={`${row.url}:${row.startTime ?? index}`}><td>{index + 1}</td><td>{row.initiatorType || '—'}</td><td><code>{row.url}</code></td></tr>)}
      </tbody></table></div>
    </section>}

    {!!matchEngineSources.length && <section className="card module-card">
      <div className="card-header"><p className="eyebrow">Match-engine diagnostics</p><h2>Captured Soccer Manager source files</h2></div>
      <p className="muted">
        Exact allowlisted same-origin JavaScript files only. The bundle contains static source text and source URLs;
        it does not include cookies, request headers or authenticated JSON response bodies.
        {diagnosticsCapturedAt ? ` Captured ${new Date(diagnosticsCapturedAt).toLocaleString('en-GB')}.` : ''}
      </p>
      <div className="button-row">
        <button type="button" className="secondary" onClick={downloadMatchEngineDiagnostics}>
          Download match-engine diagnostics
        </button>
      </div>
      <div className="table-wrap"><table><thead><tr><th>File</th><th>Status</th><th>Size</th></tr></thead><tbody>
        {matchEngineSources.map((row) => {
          let fileName = row.url;
          try { fileName = new URL(row.url).pathname.split('/').filter(Boolean).pop() || row.url; } catch {}
          return <tr key={row.url}>
            <td><code>{fileName}</code></td>
            <td>{row.error || 'Captured'}</td>
            <td>{typeof row.source === 'string' ? `${row.source.length.toLocaleString('en-GB')} chars` : '—'}</td>
          </tr>;
        })}
      </tbody></table></div>
    </section>}

    {!!replayPageContext && <section className="card module-card">
      <div className="card-header"><p className="eyebrow">Replay-loader diagnostics</p><h2>Replay page context</h2></div>
      <p className="muted">
        Captures only structural replay-selection data: the page URL/query context, likely fixture/match identifiers, and allowlisted identifier/value signals extracted from inline scripts. No arbitrary script or HTML excerpts cross origins. This is diagnostic-only and is never staged or persisted.
        {diagnosticsCapturedAt ? ` Captured ${new Date(diagnosticsCapturedAt).toLocaleString('en-GB')}.` : ''}
      </p>
      <div className="overview-metrics">
        <article><span>Query fields</span><strong>{Object.keys(replayPageContext.params || {}).length}</strong></article>
        <article><span>Identifiers</span><strong>{Object.keys(replayPageContext.identifiers || {}).length}</strong></article>
        <article><span>Script signals</span><strong>{replayPageContext.scriptSignals?.length || 0}</strong></article>
      </div>
      <p className="muted"><code>{replayPageContext.pageUrl}</code></p>
      <div className="button-row">
        <button type="button" className="secondary" onClick={downloadReplayPageContextDiagnostics}>
          Download replay page context
        </button>
      </div>
    </section>}

    {!!matchReplay && <section className="card module-card">
      <div className="card-header"><p className="eyebrow">Match replay diagnostics</p><h2>Completed match XML</h2></div>
      <p className="muted">
        Temporary diagnostic capture of the replay XML already present in the Soccer Manager page. It is not staged or persisted to the Top 100 database.
        {diagnosticsCapturedAt ? ` Captured ${new Date(diagnosticsCapturedAt).toLocaleString('en-GB')}.` : ''}
      </p>
      <div className="overview-metrics">
        <article><span>Status</span><strong>{matchReplay.error || (matchReplay.xml ? 'Captured' : 'Detected')}</strong></article>
        <article><span>Size</span><strong>{typeof matchReplay.xml === 'string' ? `${matchReplay.xml.length.toLocaleString('en-GB')} chars` : '—'}</strong></article>
      </div>
      <p className="muted"><code>{matchReplay.url}</code></p>
      <div className="button-row">
        <button type="button" className="secondary" onClick={downloadMatchReplayDiagnostics}>
          Download match replay diagnostics
        </button>
      </div>
    </section>}

    <SoccerManagerSyncReview refreshToken={reviewRefreshToken} onReviewComplete={() => setArchiveRefreshToken((value) => value + 1)} />
    <SoccerManagerArchiveAdapter refreshToken={archiveRefreshToken} />

    {!!totalSummary.length && <section className="card module-card">
      <div className="card-header"><p className="eyebrow">Import summary</p><h2>What we found</h2></div>
      {totalSummary.map((summary) => <div key={summary.id} className="sm-sync-summary"><strong>{summary.name}</strong><SummaryCards summary={Object.fromEntries(Object.entries(summary).filter(([key]) => key !== 'name' && key !== 'id'))} /></div>)}
    </section>}

    {payloads.map((entry) => <div key={entry.id}>
      {entry.payload.kind === 'competition' && <CompetitionPreview payload={entry.payload} />}
      {entry.payload.kind === 'playerChanges' && <PlayerChangesPreview payload={entry.payload} />}
      {entry.payload.kind === 'transfers' && <TransfersPreview payload={entry.payload} />}
      {entry.payload.kind === 'clubFinance' && <FinancePreview payload={entry.payload} />}
      {entry.payload.kind === 'clubSquad' && <ClubSquadPreview payload={entry.payload} />}
      {entry.payload.kind === 'matchReplay' && <MatchReplayPreview payload={entry.payload} />}
    </div>)}
  </main>;
}
