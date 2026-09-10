import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function ManagerLifecycleManager() {
  const [managers, setManagers] = useState([]);
  const [query, setQuery] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [newName, setNewName] = useState('');
  const [status, setStatus] = useState('Loading managers...');
  const [loading, setLoading] = useState(false);

  useEffect(() => { loadManagers(); }, []);

  async function loadManagers() {
    setLoading(true);
    const { data, error } = await supabase.rpc('admin_list_manager_lifecycle');
    if (error) setStatus('Could not load managers: ' + error.message);
    else {
      setManagers(data || []);
      setStatus(`${(data || []).filter((row) => row.active).length} active managers.`);
    }
    setLoading(false);
  }

  async function createManager(event) {
    event.preventDefault();
    const clean = newName.trim();
    if (!clean) return;
    setLoading(true);
    const { error } = await supabase.rpc('admin_create_manager', {
      manager_name: clean,
      manager_display_name: clean,
    });
    if (error) setStatus('Could not add manager: ' + error.message);
    else {
      setNewName('');
      setStatus(`${clean} added as an active Top 100 manager.`);
      await loadManagers();
    }
    setLoading(false);
  }

  async function setActive(manager, active) {
    const verb = active ? 'reactivate' : 'mark inactive';
    const promptText = active
      ? `Reason for reactivating ${manager.display_name || manager.name}:`
      : `Reason ${manager.display_name || manager.name} is leaving/inactive:`;
    const reason = window.prompt(promptText, active ? 'Returned to Top 100' : 'Left Top 100');
    if (reason === null) return;
    if (!window.confirm(`${verb[0].toUpperCase()}${verb.slice(1)} ${manager.display_name || manager.name}?`)) return;

    setLoading(true);
    const { error } = await supabase.rpc('admin_set_manager_active', {
      target_manager_id: manager.manager_id,
      target_active: active,
      reason,
    });
    if (error) setStatus('Manager update failed: ' + error.message);
    else {
      setStatus(active
        ? `${manager.display_name || manager.name} reactivated. Existing Manager Portal access has been restored where available.`
        : `${manager.display_name || manager.name} marked inactive. Manager Portal, Voting and Awards access are now disabled.`);
      await loadManagers();
    }
    setLoading(false);
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return managers
      .filter((manager) => showInactive || manager.active)
      .filter((manager) => !needle || `${manager.name} ${manager.display_name || ''} ${(manager.account_emails || []).join(' ')}`.toLowerCase().includes(needle));
  }, [managers, query, showInactive]);

  return <div className="registration-manager">
    <section className="entrant-panel">
      <div className="card-header row">
        <div>
          <p className="eyebrow">Top 100 roster</p>
          <h3>Manager lifecycle</h3>
          <p className="muted">This is the canonical active-manager list used by Manager Portal, future Voting electorates and Manager Awards. Managers are deactivated, never deleted, so historical records remain intact.</p>
        </div>
        <button type="button" className="secondary" onClick={loadManagers} disabled={loading}>Refresh</button>
      </div>

      <form onSubmit={createManager} className="mini-grid">
        <label>Add new manager
          <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Manager name" />
        </label>
        <div className="button-row" style={{ alignItems: 'end' }}>
          <button type="submit" disabled={loading || !newName.trim()}>Add manager</button>
        </div>
      </form>

      <div className="mini-grid">
        <label>Search managers
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or account email" />
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
          Show inactive managers
        </label>
      </div>

      <p className="status">{status}</p>

      <div className="entrant-list">
        {filtered.map((manager) => <article className={`entrant-row ${manager.active ? 'selected' : ''}`} key={manager.manager_id}>
          <div>
            <strong>{manager.display_name || manager.name}</strong>
            <span>{manager.active ? 'Active Top 100 manager' : 'Inactive / historical manager'}</span>
            <span>{Number(manager.account_count || 0) > 0
              ? `${manager.active_account_count || 0}/${manager.account_count} active Manager Portal account(s) · ${(manager.account_emails || []).join(', ')}`
              : 'No Manager Portal account claimed yet'}</span>
          </div>
          <div className="button-row">
            {manager.active
              ? <button type="button" className="danger" onClick={() => setActive(manager, false)} disabled={loading}>Mark inactive</button>
              : <button type="button" onClick={() => setActive(manager, true)} disabled={loading}>Reactivate</button>}
          </div>
        </article>)}
      </div>
    </section>

    <section className="entrant-panel">
      <p className="eyebrow">Voting behaviour</p>
      <h3>What these controls affect</h3>
      <p className="muted">Deactivating a manager disables any linked Manager Portal account immediately and excludes them from future poll and Awards electorates. Reactivating restores an existing linked account where available. Open votes keep their frozen electorate; changing that remains a separate audited voting correction.</p>
    </section>
  </div>;
}
