import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { reviewSoccerManagerSyncChange, reviewSoccerManagerSyncRun } from '../lib/soccerManagerSyncPersistence';

function formatWhen(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString('en-GB');
  } catch {
    return String(value);
  }
}

function reviewJson(value) {
  if (value === null || value === undefined) return '—';
  return JSON.stringify(value, null, 2);
}

const CHANGE_PAGE_SIZE = 500;

export default function SoccerManagerSyncReview({ refreshToken = 0, onReviewComplete = null }) {
  const [runs, setRuns] = useState([]);
  const [selectedRunId, setSelectedRunId] = useState(null);
  const [changes, setChanges] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingChanges, setLoadingChanges] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [status, setStatus] = useState('');
  const changeRequestRef = useRef(0);
  const runRequestRef = useRef(0);
  const selectedRunIdRef = useRef(null);

  useEffect(() => {
    selectedRunIdRef.current = selectedRunId;
  }, [selectedRunId]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) || null,
    [runs, selectedRunId],
  );

  const pendingCount = useMemo(
    () => changes.filter((change) => change.status === 'pending').length,
    [changes],
  );

  const allChangesLoaded = Boolean(selectedRun)
    && !loadingChanges
    && changes.length === selectedRun.change_count
    && changes.every((change) => change.run_id === selectedRunId);

  const changeSummary = useMemo(() => {
    const summary = new Map();
    for (const change of changes) {
      const key = `${change.entity_type} · ${change.change_kind}`;
      summary.set(key, (summary.get(key) || 0) + 1);
    }
    return [...summary.entries()];
  }, [changes]);

  const loadRuns = useCallback(async () => {
    if (!supabase) return;
    const requestId = runRequestRef.current + 1;
    runRequestRef.current = requestId;
    setLoadingRuns(true);
    const fields = 'id, status, captured_at, source_count, entity_count, change_count, created_at, reviewed_at';

    const unresolvedRuns = [];
    let unresolvedCursor = null;
    let unresolvedError = null;

    while (true) {
      let query = supabase
        .from('soccer_manager_sync_runs')
        .select(fields)
        .neq('status', 'reviewed')
        .order('id', { ascending: false })
        .limit(CHANGE_PAGE_SIZE);

      if (unresolvedCursor !== null) {
        query = query.lt('id', unresolvedCursor);
      }

      const result = await query;

      if (result.error) {
        unresolvedError = result.error;
        break;
      }

      const page = result.data || [];
      unresolvedRuns.push(...page);
      if (page.length < CHANGE_PAGE_SIZE) break;
      unresolvedCursor = page[page.length - 1].id;
    }

    const recentReviewedResult = await supabase
      .from('soccer_manager_sync_runs')
      .select(fields)
      .eq('status', 'reviewed')
      .order('created_at', { ascending: false })
      .limit(12);

    if (runRequestRef.current !== requestId) return;

    setLoadingRuns(false);
    const error = unresolvedError || recentReviewedResult.error;
    if (error) {
      setStatus(`Could not load staged sync runs: ${error.message}`);
      return;
    }

    const byId = new Map();
    for (const run of [...unresolvedRuns, ...(recentReviewedResult.data || [])]) {
      byId.set(run.id, run);
    }
    const nextRuns = [...byId.values()].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    setRuns(nextRuns);
    setSelectedRunId((current) => {
      if (current && nextRuns.some((run) => run.id === current)) return current;
      return nextRuns[0]?.id || null;
    });
  }, []);

  const loadChanges = useCallback(async (runId) => {
    const requestId = changeRequestRef.current + 1;
    changeRequestRef.current = requestId;
    setChanges([]);

    if (!supabase || !runId) {
      setLoadingChanges(false);
      return;
    }

    setLoadingChanges(true);
    const allChanges = [];
    let from = 0;
    let error = null;

    while (true) {
      const result = await supabase
        .from('soccer_manager_sync_changes')
        .select('id, run_id, entity_type, entity_key, scope_key, change_kind, status, before_data, after_data, reviewed_at')
        .eq('run_id', runId)
        .order('entity_type', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + CHANGE_PAGE_SIZE - 1);

      if (result.error) {
        error = result.error;
        break;
      }

      const page = result.data || [];
      allChanges.push(...page);
      if (page.length < CHANGE_PAGE_SIZE) break;
      from += CHANGE_PAGE_SIZE;
    }

    if (changeRequestRef.current !== requestId || selectedRunIdRef.current !== runId) return;

    setLoadingChanges(false);
    if (error) {
      setStatus(`Could not load staged changes: ${error.message}`);
      return;
    }
    setChanges(allChanges);
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns, refreshToken]);

  useEffect(() => {
    loadChanges(selectedRunId);
  }, [loadChanges, selectedRunId, refreshToken]);

  async function reviewOne(changeId, decision) {
    const change = changes.find((row) => row.id === changeId);
    if (!change || change.run_id !== selectedRunId || loadingChanges) return;
    setBusyId(changeId);
    setStatus('');
    try {
      await reviewSoccerManagerSyncChange(changeId, decision);
      setStatus(`Change ${decision}.`);
      await Promise.all([loadRuns(), loadChanges(selectedRunId)]);
      if (typeof onReviewComplete === 'function') onReviewComplete();
      if (typeof onReviewComplete === 'function') onReviewComplete();
    } catch (error) {
      setStatus(`Review failed: ${error.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function reviewRun(decision) {
    if (!selectedRunId || !pendingCount || !allChangesLoaded) return;
    const verb = decision === 'approved' ? 'approve' : 'reject';
    if (!window.confirm(`Really ${verb} all ${pendingCount} pending changes in sync #${selectedRunId}?`)) return;

    setBusyId(`run:${selectedRunId}`);
    setStatus('');
    try {
      const reviewed = await reviewSoccerManagerSyncRun(selectedRunId, decision);
      setStatus(`${reviewed} change${reviewed === 1 ? '' : 's'} ${decision}.`);
      await Promise.all([loadRuns(), loadChanges(selectedRunId)]);
    } catch (error) {
      setStatus(`Review failed: ${error.message}`);
    } finally {
      setBusyId(null);
    }
  }

  return <section className="card module-card sm-sync-review">
    <div className="card-header">
      <p className="eyebrow">v0.3 · persistent source layer</p>
      <h2>Sync review</h2>
      <p>Staged Soccer Manager data stays private here until you approve it into the canonical source layer. Approval still does not update the public Top 100 archive yet.</p>
    </div>

    {status && <p className="status">{status}</p>}

    <div className="sm-sync-review-layout">
      <aside className="sm-sync-run-list">
        <div className="sm-sync-review-heading">
          <strong>Recent syncs</strong>
          <button type="button" className="secondary" onClick={loadRuns} disabled={loadingRuns}>
            {loadingRuns ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {!runs.length && !loadingRuns && <p className="muted">No staged syncs yet.</p>}
        {runs.map((run) => <button
          type="button"
          key={run.id}
          className={`sm-sync-run-card ${selectedRunId === run.id ? 'selected' : ''}`}
          onClick={() => {
            if (run.id === selectedRunId) return;
            changeRequestRef.current += 1;
            setChanges([]);
            setLoadingChanges(true);
            setSelectedRunId(run.id);
          }}
        >
          <strong>Sync #{run.id}</strong>
          <span>{formatWhen(run.captured_at)}</span>
          <span>{run.change_count} change{run.change_count === 1 ? '' : 's'} · {run.status.replaceAll('_', ' ')}</span>
        </button>)}
      </aside>

      <div className="sm-sync-review-main">
        {!selectedRun && <p className="muted">Select a sync run to review its changes.</p>}
        {selectedRun && <>
          <div className="sm-sync-review-heading">
            <div>
              <strong>Sync #{selectedRun.id}</strong>
              <p className="muted">{selectedRun.source_count} source response{selectedRun.source_count === 1 ? '' : 's'} · {selectedRun.entity_count} normalized entities · {selectedRun.change_count} changes</p>
            </div>
            {!!pendingCount && <div className="button-row">
              <button type="button" onClick={() => reviewRun('approved')} disabled={Boolean(busyId) || !allChangesLoaded}>Approve all ({pendingCount})</button>
              <button type="button" className="secondary" onClick={() => reviewRun('rejected')} disabled={Boolean(busyId) || !allChangesLoaded}>Reject all</button>
            </div>}
          </div>

          {!!changeSummary.length && <div className="sm-sync-change-summary">
            {changeSummary.map(([label, count]) => <span key={label}><strong>{count}</strong> {label}</span>)}
          </div>}

          {loadingChanges && <p className="muted">Loading all {selectedRun.change_count} changes before review actions are enabled…</p>}
          {!loadingChanges && !allChangesLoaded && <p className="status error-text">The complete change set is not loaded for this run. Bulk review is disabled.</p>}
          {!loadingChanges && selectedRun.change_count === 0 && <div className="empty-state"><strong>No differences from the approved canonical source state.</strong><p className="muted">This sync is already up to date.</p></div>}

          <div className="sm-sync-change-list">
            {changes.map((change) => <article key={change.id} className={`sm-sync-change-card ${change.status}`}>
              <div className="sm-sync-change-title">
                <div>
                  <span className="sm-sync-change-kind">{change.change_kind}</span>
                  <strong>{change.entity_type}</strong>
                  <code>{change.entity_key}</code>
                </div>
                <span className="sm-sync-change-status">{change.status}</span>
              </div>
              {change.scope_key && <p className="muted">Scope: {change.scope_key}</p>}
              <details>
                <summary>Compare normalized data</summary>
                <div className="sm-sync-diff-grid">
                  <div><strong>Before</strong><pre>{reviewJson(change.before_data)}</pre></div>
                  <div><strong>After</strong><pre>{reviewJson(change.after_data)}</pre></div>
                </div>
              </details>
              {change.status === 'pending' && <div className="button-row">
                <button type="button" onClick={() => reviewOne(change.id, 'approved')} disabled={Boolean(busyId) || loadingChanges}>Approve</button>
                <button type="button" className="secondary" onClick={() => reviewOne(change.id, 'rejected')} disabled={Boolean(busyId) || loadingChanges}>Reject</button>
              </div>}
            </article>)}
          </div>
        </>}
      </div>
    </div>
  </section>;
}
