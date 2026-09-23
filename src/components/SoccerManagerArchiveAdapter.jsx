import { useCallback, useEffect, useState } from 'react';
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
  const [busySetupId, setBusySetupId] = useState(null);
  const [status, setStatus] = useState('');

  const loadWorlds = useCallback(async () => {
    if (!supabase) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('soccer_manager_canonical_entities')
      .select('entity_key, data, version, last_approved_at')
      .eq('entity_type', 'world')
      .order('entity_key', { ascending: true });

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
    if (!supabase || busySetupId) return;
    setBusySetupId(setupId);
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
    setBusySetupId(null);
  }

  return <section className="card module-card">
    <div className="card-header">
      <p className="eyebrow">v0.4 · archive adapters</p>
      <h2>Apply approved data to the archive</h2>
    </div>
    <p>
      This step is separate from sync review. It reads only approved canonical Soccer Manager entities
      and applies the core archive spine: world, clubs, managers, current manager assignments, season
      history, league titles and versioned standing snapshots.
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
        <button
          type="button"
          onClick={() => applyCoreArchive(world.entity_key)}
          disabled={busySetupId !== null}
        >
          {busySetupId === world.entity_key ? 'Applying…' : 'Apply core archive'}
        </button>
      </div>)}
    </div>}

    {status && <p className="status">{status}</p>}
  </section>;
}
