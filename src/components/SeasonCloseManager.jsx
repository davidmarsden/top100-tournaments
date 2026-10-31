import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAdminAuth } from './AdminGate.jsx';
import { formatDrawDate, managerCandidate, parseNameList, verifyDraw } from '../lib/prizeDraw.js';

const REVEAL_DELAY_MS = 1400;

function seasonOf(tournament) {
  const number = Number(tournament?.season_number) || Number(String(tournament?.name || '').match(/S\s*(\d+)/i)?.[1]);
  return number || null;
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SeasonCloseManager({ selectedTournament, onTournamentUpdated, canManage }) {
  if (!selectedTournament) return <p className="muted">Select a tournament first.</p>;
  return <div className="season-close">
    <ArchivePanel tournament={selectedTournament} onTournamentUpdated={onTournamentUpdated} canManage={canManage} />
    <PrizeDrawPanel tournament={selectedTournament} canManage={canManage} />
  </div>;
}

// ---------------------------------------------------------------------------
// Archive readiness and archive action
// ---------------------------------------------------------------------------
function ArchivePanel({ tournament, onTournamentUpdated, canManage }) {
  const { isGlobalAdmin } = useAdminAuth();
  const [checks, setChecks] = useState(null);
  const [honours, setHonours] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const archived = ['archived', 'completed'].includes(String(tournament.status || '').toLowerCase());
  const errors = (checks || []).filter((row) => row.level === 'error');
  const warnings = (checks || []).filter((row) => row.level === 'warning');

  useEffect(() => { load(); }, [tournament.id, tournament.status]);

  async function load() {
    setBusy(true);
    setStatus('Running archive checks...');
    const [checksResult, honoursResult, snapshotsResult] = await Promise.all([
      supabase.rpc('tournament_archive_checks', { p_tournament_id: tournament.id }),
      supabase.from('honours').select('id, honour, position, entry:tournament_entries!honours_entry_id_fkey(id, teams(name), managers(name, display_name))').eq('tournament_id', tournament.id).order('position'),
      supabase.from('tournament_archive_snapshots').select('id, created_at').eq('tournament_id', tournament.id).order('created_at', { ascending: false }).limit(5),
    ]);
    if (checksResult.error) {
      setChecks(null);
      setStatus(/function|schema cache/i.test(checksResult.error.message)
        ? 'Archive checks are not installed yet: apply the season-close database migration.'
        : `Could not run archive checks: ${checksResult.error.message}`);
    } else {
      setChecks(checksResult.data || []);
      setStatus('');
    }
    setHonours(honoursResult.error ? [] : honoursResult.data || []);
    setSnapshots(snapshotsResult.error ? [] : snapshotsResult.data || []);
    setBusy(false);
  }

  async function archive(force = false) {
    const verb = archived ? 'Re-archive' : 'Archive';
    const prompt = force
      ? `Force-archive ${tournament.name} despite ${errors.length} blocking issue(s)? Only do this if you have checked each one.`
      : `${verb} ${tournament.name}? This records the Cup and Shield winners and runners-up, saves a full snapshot and switches the public page to its archive view.`;
    if (!window.confirm(prompt)) return;
    setBusy(true);
    setStatus('Archiving...');
    const { data, error } = await supabase.rpc('archive_tournament', { p_tournament_id: tournament.id, p_force: force });
    if (error) {
      setStatus(`Archive failed: ${error.message}`);
      setBusy(false);
      return;
    }
    setStatus(`Archived. Snapshot #${data?.snapshot_id} saved with ${(data?.honours || []).length} honours.`);
    await onTournamentUpdated?.();
    await load();
  }

  async function downloadSnapshot(id) {
    const { data, error } = await supabase.from('tournament_archive_snapshots').select('snapshot').eq('id', id).single();
    if (error) { setStatus(`Could not load snapshot: ${error.message}`); return; }
    downloadJson(`${tournament.public_slug || tournament.slug || `tournament-${tournament.id}`}-archive-${id}.json`, data.snapshot);
  }

  return <section className="season-close-panel">
    <div className="season-close-heading">
      <div>
        <p className="eyebrow">Step 1 · Archive</p>
        <h3>{archived ? 'Archived' : 'Archive readiness'}</h3>
        <p className="muted">Checks every fixture, tie and result review. Archiving records each bracket's winner and runner-up, keeps a full copy of the tournament and makes it the permanent public record.</p>
      </div>
      <span className={`season-close-badge ${archived ? 'is-done' : errors.length ? 'is-blocked' : checks ? 'is-ready' : ''}`}>{archived ? 'Archived' : !checks ? '—' : errors.length ? `${errors.length} blocking` : 'Ready'}</span>
    </div>

    {checks && <ul className="season-check-list">
      {!errors.length && <li className="check-ok">All fixtures resolved, every tie has a winner and no results are under review.</li>}
      {errors.map((row, index) => <li key={`e${index}`} className="check-error">{row.message}{row.match_id ? <small> · match #{row.match_id}</small> : null}</li>)}
      {warnings.map((row, index) => <li key={`w${index}`} className="check-warning">{row.message}{row.match_id ? <small> · match #{row.match_id}</small> : null}</li>)}
    </ul>}

    {honours.length > 0 && <div className="season-honours">
      {honours.map((row) => <article key={row.id} className={row.position === 1 ? 'is-winner' : ''}>
        <span>{row.position === 1 ? (/shield/i.test(row.honour) ? '🛡️' : '🏆') : '🥈'} {row.honour}</span>
        <strong>{row.entry?.teams?.name || 'Unknown team'}</strong>
        <small>{row.entry?.managers?.display_name || row.entry?.managers?.name || ''}</small>
      </article>)}
    </div>}

    <div className="button-row">
      {canManage && <button type="button" onClick={() => archive(false)} disabled={busy || !checks || errors.length > 0}>{archived ? 'Re-archive (refresh honours and snapshot)' : 'Archive tournament'}</button>}
      {canManage && isGlobalAdmin && errors.length > 0 && <button type="button" className="secondary danger" onClick={() => archive(true)} disabled={busy}>Force archive</button>}
      <button type="button" className="secondary" onClick={load} disabled={busy}>Re-run checks</button>
    </div>
    {status && <p className="status">{status}</p>}

    {snapshots.length > 0 && <div className="season-snapshots">
      <p className="eyebrow">Saved snapshots</p>
      {snapshots.map((row) => <div key={row.id} className="season-snapshot-row"><span>#{row.id} · {formatDrawDate(row.created_at)}</span><button type="button" className="secondary compact" onClick={() => downloadSnapshot(row.id)}>Download JSON</button></div>)}
    </div>}
  </section>;
}

// ---------------------------------------------------------------------------
// Prize draw
// ---------------------------------------------------------------------------
function PrizeDrawPanel({ tournament, canManage }) {
  const season = seasonOf(tournament);
  const [pool, setPool] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [extraNames, setExtraNames] = useState('');
  const [title, setTitle] = useState('');
  const [prize, setPrize] = useState('');
  const [winnersCount, setWinnersCount] = useState(3);
  const [draws, setDraws] = useState([]);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(null);
  const [verification, setVerification] = useState({});
  const [showExcluded, setShowExcluded] = useState(false);

  useEffect(() => {
    setTitle(`${season ? `S${season} ` : ''}Youth Cup prize draw`);
    setPrize(season ? `New player pick in S${season + 1}` : 'New player pick next season');
    setExtraNames('');
    setReveal(null);
    load();
  }, [tournament.id]);

  async function load() {
    const [poolResult, drawsResult] = await Promise.all([
      supabase.rpc('prize_draw_pool', { p_tournament_id: tournament.id }),
      supabase.from('prize_draws').select('*').eq('tournament_id', tournament.id).order('drawn_at', { ascending: false }),
    ]);
    if (poolResult.error) {
      setStatus(/function|schema cache/i.test(poolResult.error.message)
        ? 'The prize draw is not installed yet: apply the season-close database migration.'
        : `Could not load the prize draw pool: ${poolResult.error.message}`);
      return;
    }
    const rows = poolResult.data || [];
    setPool(rows);
    setSelected(new Set(rows.filter((row) => row.eligible).map((row) => row.manager_id)));
    setDraws(drawsResult.error ? [] : drawsResult.data || []);
    setStatus('');
  }

  const eligible = useMemo(() => pool.filter((row) => row.eligible), [pool]);
  const excluded = useMemo(() => pool.filter((row) => !row.eligible), [pool]);
  const extras = useMemo(() => parseNameList(extraNames), [extraNames]);
  const poolNames = useMemo(() => new Set(pool.map((row) => String(row.manager_name || '').trim().toLowerCase())), [pool]);
  const extraClashes = extras.filter((row) => poolNames.has(row.name.toLowerCase()));
  const candidates = useMemo(() => [
    ...eligible.filter((row) => selected.has(row.manager_id)).map(managerCandidate),
    ...extras,
  ], [eligible, selected, extras]);
  const count = Math.max(1, Math.min(Number(winnersCount) || 1, 50));
  const canDraw = canManage && candidates.length >= count && title.trim() && !extraClashes.length;

  function toggle(id) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function runDraw() {
    if (!window.confirm(`Draw ${count} winner${count === 1 ? '' : 's'} from ${candidates.length} entries for "${title.trim()}"? The result is saved and logged; re-draws are logged too.`)) return;
    setBusy(true);
    setStatus('Drawing...');
    const excludedRows = [
      ...excluded.map((row) => ({ key: `manager:${row.manager_id}`, name: row.manager_name, club: row.team_name, reason: row.reason || 'Not eligible' })),
      ...eligible.filter((row) => !selected.has(row.manager_id)).map((row) => ({ key: `manager:${row.manager_id}`, name: row.manager_name, club: row.team_name, reason: 'Removed by organiser' })),
    ];
    const { data, error } = await supabase.rpc('run_prize_draw', {
      p_tournament_id: tournament.id,
      p_title: title.trim(),
      p_winners_count: count,
      p_candidates: candidates,
      p_excluded: excludedRows,
      p_prize: prize.trim() || null,
    });
    setBusy(false);
    if (error) { setStatus(`Draw failed: ${error.message}`); return; }
    setStatus('');
    setReveal({ draw: data, shown: 0 });
    setDraws((current) => [data, ...current]);
  }

  useEffect(() => {
    if (!reveal || reveal.shown >= (reveal.draw.winners || []).length) return undefined;
    const timer = setTimeout(() => setReveal((current) => current && { ...current, shown: current.shown + 1 }), reveal.shown === 0 ? 600 : REVEAL_DELAY_MS);
    return () => clearTimeout(timer);
  }, [reveal]);

  async function setPublished(draw, published) {
    const { data, error } = await supabase.rpc('publish_prize_draw', { p_draw_id: draw.id, p_published: published });
    if (error) { setStatus(`Could not update draw: ${error.message}`); return; }
    setStatus(published ? 'Draw published on the public tournament page.' : 'Draw unpublished.');
    setDraws((current) => current.map((row) => row.id === data.id ? data : (published && row.title === data.title ? { ...row, published: false } : row)));
  }

  async function voidDraw(draw) {
    const reason = window.prompt('Why is this draw being voided? (shown in the log)');
    if (!reason?.trim()) return;
    const { data, error } = await supabase.rpc('void_prize_draw', { p_draw_id: draw.id, p_reason: reason.trim() });
    if (error) { setStatus(`Could not void draw: ${error.message}`); return; }
    setDraws((current) => current.map((row) => row.id === data.id ? data : row));
  }

  async function verify(draw) {
    setVerification((current) => ({ ...current, [draw.id]: { message: 'Verifying...' } }));
    const result = await verifyDraw(draw);
    setVerification((current) => ({ ...current, [draw.id]: result }));
  }

  return <section className="season-close-panel">
    <div className="season-close-heading">
      <div>
        <p className="eyebrow">Step 2 · End-of-season prize draw</p>
        <h3>Random draw picker</h3>
        <p className="muted">The pool is every manager currently running an entrant with no forfeits on the Fair Play register. Winners are drawn on the server with a fresh random seed; every draw, including re-draws, is logged and can be independently verified.</p>
      </div>
      <span className="season-close-badge">{candidates.length} in the draw</span>
    </div>

    <div className="prize-draw-setup">
      <label>Draw title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Prize<input value={prize} onChange={(event) => setPrize(event.target.value)} /></label>
      <label className="prize-draw-count">Winners<input type="number" min="1" max="50" value={winnersCount} onChange={(event) => setWinnersCount(event.target.value)} /></label>
    </div>

    <div className="prize-draw-pool">
      <div className="prize-draw-pool-head">
        <strong>Eligible managers ({selected.size}/{eligible.length} included)</strong>
        <div className="button-row">
          <button type="button" className="secondary compact" onClick={() => setSelected(new Set(eligible.map((row) => row.manager_id)))}>Include all</button>
          <button type="button" className="secondary compact" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      </div>
      <div className="prize-draw-chips">
        {eligible.map((row) => <label key={row.manager_id} className={selected.has(row.manager_id) ? 'prize-chip is-on' : 'prize-chip'}>
          <input type="checkbox" checked={selected.has(row.manager_id)} onChange={() => toggle(row.manager_id)} />
          <span>{row.manager_name}</span><small>{row.team_name}</small>
        </label>)}
        {!eligible.length && <p className="muted">No eligible managers found.</p>}
      </div>
      {excluded.length > 0 && <>
        <button type="button" className="link-button" onClick={() => setShowExcluded((value) => !value)}>{showExcluded ? 'Hide' : 'Show'} {excluded.length} excluded by Fair Play</button>
        {showExcluded && <div className="prize-draw-chips is-excluded">{excluded.map((row) => <span key={row.manager_id} className="prize-chip is-off"><span>{row.manager_name}</span><small>{row.reason}{row.team_name ? ` · ${row.team_name}` : ''}</small></span>)}</div>}
      </>}
    </div>

    <label className="prize-draw-extra">Add other names (optional, one per line) — for any other draw, or a manager to add by hand
      <textarea rows={3} value={extraNames} onChange={(event) => setExtraNames(event.target.value)} placeholder={'Name one\nName two'} />
    </label>
    {extraClashes.length > 0 && <p className="status error">Already in the pool: {extraClashes.map((row) => row.name).join(', ')}. Remove them from the extra names.</p>}

    <div className="button-row">
      <button type="button" className="prize-draw-button" onClick={runDraw} disabled={!canDraw || busy}>{busy ? 'Drawing...' : `🎲 Draw ${count} winner${count === 1 ? '' : 's'}`}</button>
      {candidates.length < count && <span className="muted">Need at least {count} entries.</span>}
    </div>
    {status && <p className="status">{status}</p>}

    {reveal && <div className="prize-draw-reveal" aria-live="polite">
      <p className="eyebrow">{reveal.draw.title}</p>
      <ol>
        {(reveal.draw.winners || []).map((winner, index) => <li key={winner.key} className={index < reveal.shown ? 'is-revealed' : ''}>
          <span className="reveal-rank">{index + 1}</span>
          <strong>{index < reveal.shown ? winner.name : 'Drawing…'}</strong>
          <small>{index < reveal.shown ? winner.club || '' : ''}</small>
        </li>)}
      </ol>
      {reveal.shown >= (reveal.draw.winners || []).length && <p className="muted">Saved as draw #{reveal.draw.id}. Publish it below to show it on the public page.</p>}
    </div>}

    {draws.length > 0 && <div className="prize-draw-log">
      <p className="eyebrow">Draw log</p>
      {draws.map((draw) => <article key={draw.id} className={`prize-draw-log-row${draw.voided ? ' is-voided' : ''}${draw.published ? ' is-published' : ''}`}>
        <div>
          <strong>#{draw.id} · {draw.title}</strong>
          <small>{formatDrawDate(draw.drawn_at)} · {draw.winners_count} from {(draw.candidates || []).length}{draw.published ? ' · Published' : ''}{draw.voided ? ` · Voided: ${draw.void_reason}` : ''}</small>
          <p>{(draw.winners || []).map((winner) => winner.name).join(' · ')}</p>
          {verification[draw.id] && <small className={verification[draw.id].ok ? 'verify-ok' : verification[draw.id].ok === false ? 'verify-fail' : ''}>{verification[draw.id].message}</small>}
        </div>
        <div className="button-row">
          <button type="button" className="secondary compact" onClick={() => verify(draw)}>Verify</button>
          {canManage && !draw.voided && <button type="button" className="secondary compact" onClick={() => setPublished(draw, !draw.published)}>{draw.published ? 'Unpublish' : 'Publish'}</button>}
          {canManage && !draw.voided && <button type="button" className="secondary compact danger" onClick={() => voidDraw(draw)}>Void</button>}
        </div>
      </article>)}
    </div>}
  </section>;
}
