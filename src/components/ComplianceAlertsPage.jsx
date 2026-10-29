import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import SquadLimitSection from './SquadLimitSection.jsx';
import ComplianceFollowUp from './ComplianceFollowUp.jsx';

// Administrators' alerts: squad limit (rule 4.1), Gold membership and logins.
// Gold and login readings come from raw Soccer Manager fields an administrator
// confirms below (see src/lib/managerSignals.js); until then nothing is alerted.

const date = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '–');
const SEVERITY = { critical: '🔴', warning: '🟠', info: '🟢' };

function RecentAlerts({ alerts, onAcknowledge }) {
  const open = alerts.filter((alert) => !alert.acknowledged_at);
  return (
    <section className="card">
      <h2>Gold and login alerts ({open.length} new)</h2>
      {alerts.length === 0 && <p>None yet. They start once the Gold and login fields are confirmed below.</p>}
      <ul>
        {alerts.map((alert) => (
          <li key={alert.id} style={{ opacity: alert.acknowledged_at ? 0.6 : 1 }}>
            {SEVERITY[alert.severity]} <strong>{alert.title}</strong> ({date(alert.created_at)}): {alert.body}
            {!alert.acknowledged_at && <> <button type="button" onClick={() => onAcknowledge(alert.id)}>Seen</button></>}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ManagerStatus({ rows }) {
  // Days left only mean something for a Gold member; Soccer Manager gives 0 for everyone else.
  const hasGoldDays = (row) => row.gold !== false && row.gold_days_left !== null && row.gold_days_left !== undefined;
  const goldEndingSoon = (row) => hasGoldDays(row) && Number(row.gold_days_left) <= 14;
  const flagged = rows.filter((row) => row.gold === false || Number(row.days_since_login) >= 7 || goldEndingSoon(row));
  const shown = flagged.length ? flagged : rows;
  return (
    <section className="card">
      <h2>Gold and logins</h2>
      {rows.length === 0 ? (
        <p>No readings yet: run Sync everything.</p>
      ) : (
        <>
          <p>{flagged.length ? `${flagged.length} manager(s) without Gold, with Gold ending within 14 days, or away for 7+ days.` : 'Every manager is Gold, with more than 14 days left, and logged in within the last 7 days.'}</p>
          <table>
            <thead><tr><th>Club</th><th>Manager</th><th>Gold</th><th>Gold left</th><th>Last login</th><th>Days</th><th>Worlds</th><th>Synced</th></tr></thead>
            <tbody>
              {shown.map((row) => (
                <tr key={`${row.club_name}-${row.sm_manager_id}`}>
                  <td>{row.club_name}</td>
                  <td>{row.manager_name || row.sm_manager_id}</td>
                  <td>{row.gold === null ? '?' : row.gold ? 'Yes' : <strong>No</strong>}{row.gold_changed_at ? ` (since ${date(row.gold_changed_at)})` : ''}</td>
                  <td>{!hasGoldDays(row) ? '–' : goldEndingSoon(row)
                    ? <strong>{row.gold_days_left} days ({date(row.gold_expires_on)})</strong>
                    : `${row.gold_days_left} days`}</td>
                  <td>{date(row.last_login_at)}</td>
                  <td>{row.days_since_login === null ? '?' : Number(row.days_since_login) >= 10 ? <strong>{row.days_since_login} ⚠</strong> : row.days_since_login}</td>
                  <td>{row.game_worlds ?? '?'}</td>
                  <td>{date(row.captured_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export default function ComplianceAlertsPage() {
  const [alerts, setAlerts] = useState([]);
  const [statusRows, setStatusRows] = useState([]);
  const [message, setMessage] = useState('Loading…');

  const load = useCallback(async () => {
    const [log, overview] = await Promise.all([
      supabase.from('admin_alert_log').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.rpc('manager_status_overview', { p_world_slug: 'top-100' }),
    ]);
    const error = log.error || overview.error;
    if (error) { setMessage(error.message); return; }
    setAlerts(log.data || []);
    // Days of Gold left and game worlds, from the managers' profiles; optional, so the page
    // still loads before that function exists.
    const profiles = await supabase.rpc('manager_profile_overview', { p_world_slug: 'top-100' });
    const byClub = new Map((profiles.error ? [] : profiles.data || []).map((row) => [row.club_name, row]));
    setStatusRows((overview.data || []).map((row) => ({ ...row, ...(byClub.get(row.club_name) || {}), captured_at: row.captured_at })));
    setMessage('');
  }, []);

  useEffect(() => { load(); }, [load]);

  const call = async (name, args) => {
    const { error } = await supabase.rpc(name, args);
    if (error) setMessage(error.message);
    else load();
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Top 100 · Admin team</p>
        <h1>Alerts</h1>
        <p>
          Squad limit breaches (rule 4.1) and the follow-up on rulings (squads back within 50, deals during bans,
          required sales), Gold membership and logins (Soccer Manager auto-sacks after ten days away).
          Every alert is also pushed to the admin team in the Top 100 app; managers are told about their own.
        </p>
      </section>
      {message && <p role="status">{message}</p>}
      <RecentAlerts alerts={alerts} onAcknowledge={(id) => call('acknowledge_admin_alert', { p_alert_id: id })} />
      <ManagerStatus rows={statusRows} />
      <h2>Squad limit</h2>
      <ComplianceFollowUp />
      <SquadLimitSection embedded />
    </main>
  );
}
