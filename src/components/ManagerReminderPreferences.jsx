import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const DEFAULTS = {
  youth_cup_enabled: false,
  fixture_assigned: true,
  day_before: true,
  deadline_day: true,
};

export default function ManagerReminderPreferences() {
  const [session, setSession] = useState(null);
  const [account, setAccount] = useState(null);
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setLoading(false); return undefined; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session || null); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session?.user?.id) { setAccount(null); setLoading(false); return; }
    loadPreferences();
  }, [session?.user?.id]);

  async function loadPreferences() {
    setLoading(true);
    const { data: accountRow, error: accountError } = await supabase
      .from('manager_portal_accounts')
      .select('id, email, active, game_worlds(slug)')
      .eq('auth_user_id', session.user.id)
      .eq('active', true)
      .maybeSingle();
    if (accountError || !accountRow) {
      setAccount(null);
      setLoading(false);
      return;
    }
    setAccount(accountRow);
    const { data, error } = await supabase
      .from('manager_reminder_preferences')
      .select('youth_cup_enabled, fixture_assigned, day_before, deadline_day')
      .eq('account_id', accountRow.id)
      .maybeSingle();
    if (error) setMessage('Reminder preferences are not available yet.');
    else setPrefs(data || DEFAULTS);
    setLoading(false);
  }

  async function save() {
    if (!account) return;
    setSaving(true); setMessage('Saving reminder preferences…');
    const payload = { account_id: account.id, ...prefs, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('manager_reminder_preferences').upsert(payload, { onConflict: 'account_id' });
    setMessage(error ? `Could not save reminders: ${error.message}` : prefs.youth_cup_enabled ? 'Youth Cup reminders are on.' : 'Youth Cup reminders are off.');
    setSaving(false);
  }

  if (loading || !account || account.game_worlds?.slug !== 'top-100') return null;

  return (
    <section className="manager-portal-shell" aria-labelledby="youth-cup-reminders-heading">
      <article className="card portal-panel">
        <div className="card-header">
          <p className="eyebrow">Never miss a thing</p>
          <h2 id="youth-cup-reminders-heading">Youth Cup reminders</h2>
        </div>
        <p>Opt in to email reminders for <strong>your club’s</strong> Youth Cup fixtures. They are tied to your approved Manager Portal identity, so there is no team to choose manually.</p>
        <p className="muted">Emails go to {account.email || session.user.email}. You can switch them off here at any time.</p>

        <label className="reminder-toggle">
          <input type="checkbox" checked={prefs.youth_cup_enabled} onChange={(event) => setPrefs((current) => ({ ...current, youth_cup_enabled: event.target.checked }))} />
          <span><strong>Enable Youth Cup reminders</strong><small>Turns on the reminder types selected below.</small></span>
        </label>

        <div className="reminder-options" aria-disabled={!prefs.youth_cup_enabled}>
          <label><input type="checkbox" disabled={!prefs.youth_cup_enabled} checked={prefs.fixture_assigned} onChange={(event) => setPrefs((current) => ({ ...current, fixture_assigned: event.target.checked }))} /> New fixture / next-round fixture assigned</label>
          <label><input type="checkbox" disabled={!prefs.youth_cup_enabled} checked={prefs.day_before} onChange={(event) => setPrefs((current) => ({ ...current, day_before: event.target.checked }))} /> Reminder the day before the fixture date</label>
          <label><input type="checkbox" disabled={!prefs.youth_cup_enabled} checked={prefs.deadline_day} onChange={(event) => setPrefs((current) => ({ ...current, deadline_day: event.target.checked }))} /> Fixture-day reminder if the result is still outstanding</label>
        </div>

        <button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save reminders'}</button>
        {message && <p className="status">{message}</p>}
      </article>
    </section>
  );
}
