import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const DEFAULTS = {
  youth_cup_enabled: false,
  fixture_assigned: true,
  day_before: true,
  deadline_day: true,
};

const TERMINAL_MATCH_STATUSES = ['played', 'forfeit', 'voided', 'cancelled'];

function formatFixtureDate(value) {
  if (!value) return 'Date TBC';
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function formatDeliveryTime(value) {
  if (!value) return null;
  return new Date(value).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function ManagerReminderPreferences() {
  const [session, setSession] = useState(null);
  const [account, setAccount] = useState(null);
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [savedPrefs, setSavedPrefs] = useState(DEFAULTS);
  const [nextFixture, setNextFixture] = useState(null);
  const [lastDelivery, setLastDelivery] = useState(null);
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

  const enabledLabels = useMemo(() => {
    if (!savedPrefs.youth_cup_enabled) return [];
    return [
      savedPrefs.fixture_assigned && 'new fixtures',
      savedPrefs.day_before && 'day-before',
      savedPrefs.deadline_day && 'fixture-day',
    ].filter(Boolean);
  }, [savedPrefs]);

  async function loadFixtureStatus(accountRow) {
    if (accountRow.game_worlds?.slug !== 'top-100') return;

    const [{ data: competition }, { data: deliveries }] = await Promise.all([
      supabase.from('competition_types').select('id').eq('slug', 'youth-cup').maybeSingle(),
      supabase.from('manager_reminder_deliveries').select('sent_at, reminder_type').eq('account_id', accountRow.id).order('sent_at', { ascending: false }).limit(1),
    ]);
    setLastDelivery(deliveries?.[0] || null);
    if (!competition?.id) return;

    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('id, season_number')
      .eq('game_world_id', accountRow.game_world_id)
      .eq('competition_type_id', competition.id)
      .not('status', 'in', '(completed,archived)')
      .order('season_number', { ascending: false });
    const tournamentIds = (tournaments || []).map((row) => row.id);
    if (!tournamentIds.length) return;

    const { data: entries } = await supabase
      .from('tournament_entries')
      .select('id, tournament_id, teams(name)')
      .eq('manager_id', accountRow.manager_id)
      .in('tournament_id', tournamentIds);
    if (!entries?.length) return;

    const entryIds = entries.map((entry) => entry.id);
    const { data: matches } = await supabase
      .from('matches')
      .select('id, tournament_id, fixture_date, stage, round, status, home_entry_id, away_entry_id, home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(name))')
      .or(`home_entry_id.in.(${entryIds.join(',')}),away_entry_id.in.(${entryIds.join(',')})`)
      .not('status', 'in', `(${TERMINAL_MATCH_STATUSES.join(',')})`);

    const candidates = (matches || []).map((match) => {
      const ownEntry = entries.find((entry) => entry.tournament_id === match.tournament_id && (entry.id === match.home_entry_id || entry.id === match.away_entry_id));
      if (!ownEntry) return null;
      const isHome = match.home_entry_id === ownEntry.id;
      return {
        ...match,
        club: ownEntry.teams?.name || 'Your club',
        opponent: isHome ? (match.away_entry?.teams?.name || 'TBC') : (match.home_entry?.teams?.name || 'TBC'),
        venue: isHome ? 'Home' : 'Away',
      };
    }).filter(Boolean).sort((a, b) => String(a.fixture_date || '9999-99-99').localeCompare(String(b.fixture_date || '9999-99-99')));

    setNextFixture(candidates[0] || null);
  }

  async function loadPreferences() {
    setLoading(true);
    const { data: accountRow, error: accountError } = await supabase
      .from('manager_portal_accounts')
      .select('id, manager_id, game_world_id, email, active, game_worlds(slug)')
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
    else {
      const loaded = data || DEFAULTS;
      setPrefs(loaded);
      setSavedPrefs(loaded);
    }
    await loadFixtureStatus(accountRow);
    setLoading(false);
  }

  async function save() {
    if (!account) return;
    setSaving(true); setMessage('Saving reminder preferences…');
    const payload = { account_id: account.id, ...prefs, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('manager_reminder_preferences').upsert(payload, { onConflict: 'account_id' });
    if (error) setMessage(`Could not save reminders: ${error.message}`);
    else {
      setSavedPrefs(prefs);
      setMessage(prefs.youth_cup_enabled ? 'Youth Cup reminders are on.' : 'Youth Cup reminders are off.');
    }
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

        <div className="reminder-status" aria-live="polite">
          <p><strong>{savedPrefs.youth_cup_enabled ? 'Reminders on' : 'Reminders off'}</strong>{enabledLabels.length ? ` · ${enabledLabels.join(' · ')}` : ''}</p>
          {nextFixture ? <p><strong>Next fixture:</strong> {nextFixture.club} · {nextFixture.venue} v {nextFixture.opponent} · {formatFixtureDate(nextFixture.fixture_date)}</p> : <p className="muted">No outstanding Youth Cup fixture is currently attached to your account.</p>}
          {lastDelivery?.sent_at && <p className="muted">Last reminder sent {formatDeliveryTime(lastDelivery.sent_at)}.</p>}
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
