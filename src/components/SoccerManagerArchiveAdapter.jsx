import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

function worldLabel(world) {
  const divisions = world.data?.divisionCount;
  const teams = world.data?.teamCount;
  const details = [
    divisions ? `${divisions} divisions` : null,
    teams ? `${teams} teams` : null,
  ].filter(Boolean).join(' · ');
  return details || 'Approved Soccer Manager world';
}

export default function SoccerManagerArchiveAdapter({ refreshToken = 0 }) {
  const [worlds, setWorlds] = useState([]);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState(null);
  const [status, setStatus] = useState('');
  const loadRequestRef = useRef(0);

  const loadWorlds = useCallback(async () => {
    if (!supabase) return;
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setLoading(true);
    const { data, error } = await supabase
      .from('soccer_manager_canonical_entities')
      .select('entity_key, data, version, last_approved_at')
      .eq('entity_type', 'world')
      .order('entity_key', { ascending: true });

    if (loadRequestRef.current !== requestId) return;

    if (error) {
      setStatus(`Could not load approved worlds: ${error.message}`);
      setWorlds([]);
    } else {
      setWorlds(data || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadWorlds();
  }, [loadWorlds, refreshToken]);

  async function applyCoreArchive(setupId) {
    if (!supabase || busyAction) return;
    setBusyAction(`core:${setupId}`);
    setStatus('');
    const { data, error } = await supabase.rpc('apply_soccer_manager_core_archive', {
      target_setup_id: setupId,
    });

    if (error) {
      setStatus(`Archive apply failed for world ${setupId}: ${error.message}`);
    } else {
      const result = data || {};
      setStatus(
        `Applied world ${result.setupId || setupId}: ${result.clubs || 0} clubs, `
        + `${result.managers || 0} managers, ${result.assignments || 0} current assignments, `
        + `${result.seasons || 0} seasons, ${result.leagueTitles || 0} league titles and `
        + `${result.standingSnapshots || 0} new standing snapshots.`
        + (result.skippedAssignments ? ` ${result.skippedAssignments} assignment(s) were skipped because no approved club mapping existed.` : ''),
      );
    }
    setBusyAction(null);
  }

  async function applyPlayerTransferArchive(setupId) {
    if (!supabase || busyAction) return;
    setBusyAction(`players:${setupId}`);
    setStatus('');
    const { data, error } = await supabase.rpc('apply_soccer_manager_player_transfer_archive', {
      target_setup_id: setupId,
    });

    if (error) {
      setStatus(`Player/transfer archive apply failed for world ${setupId}: ${error.message}`);
    } else {
      const result = data || {};
      setStatus(
        `Applied player/transfer archive for world ${result.setupId || setupId}: `
        + `${result.squadPlayers || 0} squad players, ${result.squadMembershipsCleared || 0} stale squad membership(s) cleared, `
        + `${result.playerSnapshots || 0} new player snapshots, ${result.transfers || 0} transfers and `
        + `${result.playerChanges || 0} player-change events.`
        + (result.unmappedTransferClubs
          ? ` ${result.unmappedTransferClubs} transfer club reference(s) could not yet be mapped to Top 100 teams.`
          : ''),
      );
    }
    setBusyAction(null);
  }

  async function applyTacticsArchive(setupId) {
    if (!supabase || busyAction) return;
    setBusyAction(`tactics:${setupId}`);
    setStatus('');
    const { data, error } = await supabase.rpc('apply_soccer_manager_tactics_archive', {
      target_setup_id: setupId,
    });

    if (error) {
      setStatus(`Tactics archive apply failed for world ${setupId}: ${error.message}`);
    } else {
      const result = data || {};
      setStatus(
        `Applied tactics archive for world ${result.setupId || setupId}: `
        + `${result.tacticsSnapshots || 0} new tactical snapshot(s).`
        + (result.unmappedClubs
          ? ` ${result.unmappedClubs} club reference(s) could not yet be mapped to Top 100 teams.`
          : ''),
      );
    }
    setBusyAction(null);
  }

  async function applyMatchArchive(setupId) {
    if (!supabase || busyAction) return;
    setBusyAction(`matches:${setupId}`);
    setStatus('Preparing match archive batches…');
    let cursor = null;
    let batch = 0;
    const totals = { matchSnapshots: 0, matchPlayers: 0, matchEvents: 0, dominationMinutes: 0, worldScoreEvents: 0, unmappedClubs: 0 };
    try {
      while (true) {
        batch += 1;
        setStatus(`Applying match archive batch ${batch}… ${totals.matchSnapshots} new snapshots and ${totals.matchPlayers} player rows archived so far.`);
        const { data, error } = await supabase.rpc('apply_soccer_manager_match_archive_batch', {
          target_setup_id: setupId, target_after_entity_key: cursor, target_limit: 25,
        });
        if (error) throw error;
        const result = data || {};
        totals.matchSnapshots += Number(result.matchSnapshots || 0);
        totals.matchPlayers += Number(result.matchPlayers || 0);
        totals.matchEvents += Number(result.matchEvents || 0);
        totals.dominationMinutes += Number(result.dominationMinutes || 0);
        totals.worldScoreEvents += Number(result.worldScoreEvents || 0);
        totals.unmappedClubs += Number(result.unmappedClubs || 0);
        const nextCursor = result.lastEntityKey || null;
        if (!result.hasMore) break;
        if (!nextCursor || nextCursor === cursor) throw new Error('Batch cursor did not advance; archive apply stopped safely.');
        cursor = nextCursor;
      }
      setStatus(`Applied match archive for world ${setupId} in ${batch} batch${batch === 1 ? '' : 'es'}: ${totals.matchSnapshots} new match snapshot(s), ${totals.matchPlayers} player row(s), ${totals.matchEvents} event row(s), ${totals.dominationMinutes} domination minute(s) and ${totals.worldScoreEvents} game-world score event(s).${totals.unmappedClubs ? ` ${totals.unmappedClubs} match club reference(s) could not yet be mapped to Top 100 teams.` : ''}`);
    } catch (error) {
      setStatus(`Match archive apply stopped after ${Math.max(0, batch - 1)} completed batch(es) for world ${setupId}: ${error.message}. Completed batches are safe to keep; run Apply matches archive again to resume idempotently.`);
    } finally {
      setBusyAction(null);
    }
  }

  return <section className="card module-card">
    <div className="card-header">
      <p className="eyebrow">v0.4 · archive adapters</p>
      <h2>Apply approved data to the archive</h2>
    </div>
    <p>
      These steps are separate from sync review. They read only approved canonical Soccer Manager entities.
      The core adapter applies the world/club/manager/season spine; the player &amp; transfer adapter adds
      private player identities, versioned squad snapshots, transfer records and player-change events; the
      tactics adapter preserves approved tactical instructions and player-selection state as private snapshots; the
      match adapter stores approved completed-match replays as queryable private snapshots, events and minute-level domination.
    </p>
    <p className="muted">
      Stable Soccer Manager IDs are kept in a private source-to-archive map. Re-running the adapter is
      idempotent; a sync never writes to the public archive automatically.
    </p>

    {loading && <p className="status">Loading approved worlds…</p>}
    {!loading && !worlds.length && <p className="muted">No approved Soccer Manager world is available yet.</p>}

    {!!worlds.length && <div className="entrant-list">
      {worlds.map((world) => <div className="entrant-row" key={world.entity_key}>
        <div>
          <strong>World {world.entity_key}</strong>
          <span>{worldLabel(world)} · canonical v{world.version}</span>
        </div>
        <div className="button-row">
          <button
            type="button"
            onClick={() => applyCoreArchive(world.entity_key)}
            disabled={busyAction !== null}
          >
            {busyAction === `core:${world.entity_key}` ? 'Applying…' : 'Apply core archive'}
          </button>
          <button
            type="button"
            onClick={() => applyPlayerTransferArchive(world.entity_key)}
            disabled={busyAction !== null}
          >
            {busyAction === `players:${world.entity_key}` ? 'Applying…' : 'Apply players & transfers'}
          </button>
          <button
            type="button"
            onClick={() => applyTacticsArchive(world.entity_key)}
            disabled={busyAction !== null}
          >
            {busyAction === `tactics:${world.entity_key}` ? 'Applying…' : 'Apply tactics archive'}
          </button>
          <button
            type="button"
            onClick={() => applyMatchArchive(world.entity_key)}
            disabled={busyAction !== null}
          >
            {busyAction === `matches:${world.entity_key}` ? 'Applying…' : 'Apply matches archive'}
          </button>
        </div>
      </div>)}
    </div>}

    {status && <p className="status">{status}</p>}
  </section>;
}
