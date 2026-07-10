import { useEffect, useMemo, useState } from 'react';

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

export default function PublicRegistrationPage() {
  const route = useMemo(routeParts, []);
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ managerName: '', managerEmail: '', clubName: '', rating: '', notes: '' });
  const [status, setStatus] = useState('Loading registration...');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

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
      setSubmitted(true);
      setStatus(payload.message);
      setForm({ managerName: '', managerEmail: '', clubName: '', rating: '', notes: '' });
      await loadConfig();
    } catch (error) {
      setStatus(error.message);
    } finally {
      setLoading(false);
    }
  }

  const tournament = config?.tournament;
  const open = Boolean(config?.window?.open);

  return <main className="app-shell public-archive tournament-hub">
    <section className="hero tournament-hero">
      <p className="eyebrow">Tournament registration</p>
      <h1>{tournament?.name || 'Register for the tournament'}</h1>
      <p>{tournament?.game_worlds?.name || 'Top 100'} · {tournament?.competition_types?.name || 'Competition'}</p>
    </section>

    <section className="card registration-summary">
      <div className="overview-metrics">
        <article><span>Status</span><strong>{open ? 'Open' : 'Closed'}</strong></article>
        <article><span>Places remaining</span><strong>{config?.placesRemaining ?? '—'}</strong></article>
        <article><span>Registrations received</span><strong>{config?.registrationsReceived ?? '—'}</strong></article>
        <article><span>Closes</span><strong>{formatDate(tournament?.registration_closes_at)}</strong></article>
      </div>
      <p className="status">{status}</p>
    </section>

    <section className="card registration-card">
      <p className="eyebrow">Your entry</p>
      <h2>{submitted ? 'Registration received' : 'Register your club'}</h2>
      <p className="muted">Registrations are checked by an admin before they become tournament entrants. Duplicate manager, email and club registrations are blocked automatically.</p>
      <form onSubmit={submit}>
        <div className="mini-grid">
          <label>Manager name<input required value={form.managerName} onChange={(event) => update('managerName', event.target.value)} autoComplete="name" /></label>
          <label>Email address<input required type="email" value={form.managerEmail} onChange={(event) => update('managerEmail', event.target.value)} autoComplete="email" /></label>
          <label>Club name<input required value={form.clubName} onChange={(event) => update('clubName', event.target.value)} /></label>
          <label>Average rating<input type="number" step="0.1" value={form.rating} onChange={(event) => update('rating', event.target.value)} placeholder="Optional" /></label>
        </div>
        <label>Anything the admin should know?<textarea rows="4" value={form.notes} onChange={(event) => update('notes', event.target.value)} maxLength="1000" /></label>
        <button type="submit" disabled={loading || !open}>{loading ? 'Submitting...' : 'Submit registration'}</button>
      </form>
    </section>
  </main>;
}
