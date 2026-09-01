import { useEffect, useMemo, useState } from 'react';

const ratings = Array.from({ length: 26 }, (_, index) => 65 + index);

function routeParts() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const registerIndex = parts.indexOf('register');
  const base = registerIndex >= 0 ? parts.slice(0, registerIndex) : parts;
  return {
    worldSlug: base[0] || 'top-100',
    competitionSlug: base[1] || 'youth-cup',
    seasonSlug: base[2] || null,
  };
}

function formatDate(value) {
  if (!value) return 'No closing date set';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

function statusLabel(row) {
  if (row.promoted_entry_id) return 'Confirmed entrant';
  if (row.status === 'approved') return 'Confirmed';
  return 'Registered';
}

export default function PublicRegistrationPage() {
  const route = useMemo(routeParts, []);
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ managerName: '', clubId: '', rating: '' });
  const [status, setStatus] = useState('Loading registration...');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(null);

  useEffect(() => { loadConfig(); }, []);

  async function request(body = null) {
    const query = new URLSearchParams({ worldSlug: route.worldSlug, competitionSlug: route.competitionSlug });
    if (route.seasonSlug) query.set('seasonSlug', route.seasonSlug);
    const response = await fetch(`/.netlify/functions/registration?${query.toString()}`, body ? {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, ...route }),
    } : undefined);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || `Registration request failed (${response.status})`);
    return payload;
  }

  async function loadConfig() {
    try {
      const payload = await request();
      setConfig(payload);
      setStatus(payload.window.open ? 'Registration is open.' : payload.window.reason);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setStatus('Submitting registration...');
    try {
      const payload = await request(form);
      setSubmitted(payload.registration);
      setStatus('Registration received.');
      setForm({ managerName: '', clubId: '', rating: '' });
      await loadConfig();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  const tournament = config?.tournament;
  const open = Boolean(config?.window?.open);
  const selectedClub = (config?.clubs || []).find((club) => String(club.id) === String(form.clubId));
  const tournamentPath = `/${route.worldSlug}/${route.competitionSlug}/${route.seasonSlug || tournament?.public_slug || ''}`.replace(/\/$/, '');

  return <main className="app-shell public-archive tournament-hub">
    <section className="hero tournament-hero">
      <p className="eyebrow">Tournament registration</p>
      <h1>{tournament?.name || 'Register for the tournament'}</h1>
      <p>{tournament?.game_worlds?.name || 'Top 100'} · {tournament?.competition_types?.name || 'Competition'}</p>
    </section>

    <section className="card registration-summary">
      <div className="overview-metrics">
        <article><span>Status</span><strong>{open ? 'Open' : 'Closed'}</strong></article>
        <article><span>Final field</span><strong>{config?.capacityDecided ? tournament?.max_entries : 'TBC'}</strong></article>
        <article><span>Registered</span><strong>{config?.registrationsReceived ?? '—'}</strong></article>
        <article><span>Closes</span><strong>{formatDate(tournament?.registration_closes_at)}</strong></article>
      </div>
      <p className="status">{status}</p>
    </section>

    {submitted ? <section className="card registration-card registration-success">
      <p className="eyebrow">Registration confirmed</p>
      <h2>You’re registered!</h2>
      <p><strong>{submitted.club_name}</strong> is now on the registration list for {tournament?.name}.</p>
      <div className="overview-metrics">
        <article><span>Manager</span><strong>{submitted.manager_name}</strong></article>
        <article><span>Average rating</span><strong>{submitted.rating}</strong></article>
        <article><span>Reference</span><strong>#{submitted.id}</strong></article>
        <article><span>Status</span><strong>Registered</strong></article>
      </div>
      <div className="button-row"><a className="button" href={tournamentPath}>View tournament</a><a className="button secondary" href="/manager">Create a Manager Portal account</a><button type="button" className="secondary" onClick={() => setSubmitted(null)}>Register another club</button></div>
      <p className="muted">A Portal account is optional, but it gives you one place for registrations, fixtures and result submissions.</p>
    </section> : <section className="card registration-card">
      <p className="eyebrow">Your entry</p>
      <h2>Register your club</h2>
      <p className="muted">No account or email address is required. Your registration appears in the live list below as soon as it is submitted.</p>
      <form onSubmit={submit}>
        <div className="mini-grid">
          <label>Manager name<input required value={form.managerName} onChange={(event) => update('managerName', event.target.value)} autoComplete="name" /></label>
          <label>Club<select required value={form.clubId} onChange={(event) => update('clubId', event.target.value)}><option value="">Choose your club</option>{(config?.clubs || []).map((club) => <option key={club.id} value={club.id}>{club.club_name}</option>)}</select></label>
          <label>Average team rating<select required value={form.rating} onChange={(event) => update('rating', event.target.value)}><option value="">Choose rating</option>{ratings.map((rating) => <option key={rating} value={rating}>{rating}</option>)}</select></label>
        </div>
        {selectedClub?.current_manager_name && <p className="muted">Current manager listed for {selectedClub.club_name}: <strong>{selectedClub.current_manager_name}</strong>. Your manager name must match this directory entry.</p>}
        <button type="submit" disabled={loading || !open}>{loading ? 'Submitting...' : 'Submit registration'}</button>
      </form>
    </section>}

    <section className="card" id="registered-teams">
      <div className="public-section-toolbar"><div><p className="eyebrow">Live registration list</p><h2>{config?.registrationsReceived || 0} teams registered</h2></div><a className="public-link-button" href={tournamentPath}>Tournament page</a></div>
      {!config?.registrations?.length ? <p className="muted">No registrations yet.</p> : <div className="entrant-list">{config.registrations.map((row) => <article className="entrant-row registration-row" key={row.id}><div className="registration-details"><strong>{row.club_name}</strong><span>{row.manager_name} · rating {row.rating}</span></div><span className="status-pill">{statusLabel(row)}</span></article>)}</div>}
    </section>
  </main>;
}
