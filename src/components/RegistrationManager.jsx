import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const filters = ['pending', 'approved', 'rejected', 'all'];

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function RegistrationManager({ selectedTournament, onTournamentUpdated }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState({ registration_status: 'closed', registration_opens_at: '', registration_closes_at: '' });
  const tournamentId = selectedTournament?.id;

  useEffect(() => {
    if (!tournamentId) return;
    setSettings({
      registration_status: selectedTournament.registration_status || 'closed',
      registration_opens_at: selectedTournament.registration_opens_at ? String(selectedTournament.registration_opens_at).slice(0, 16) : '',
      registration_closes_at: selectedTournament.registration_closes_at ? String(selectedTournament.registration_closes_at).slice(0, 16) : '',
    });
    loadRegistrations();
  }, [tournamentId]);

  const visible = useMemo(() => rows.filter((row) => filter === 'all' || row.status === filter), [rows, filter]);
  const counts = useMemo(() => rows.reduce((result, row) => ({ ...result, [row.status]: (result[row.status] || 0) + 1 }), {}), [rows]);

  async function loadRegistrations() {
    if (!tournamentId) return;
    setLoading(true);
    const { data, error } = await supabase.from('tournament_registrations')
      .select('id, tournament_id, manager_name, manager_email, club_name, rating, notes, status, duplicate_reason, submitted_at, reviewed_at, review_notes, promoted_entry_id, promoted_at')
      .eq('tournament_id', tournamentId)
      .order('submitted_at', { ascending: false });
    if (error) setStatus('Could not load registrations: ' + error.message);
    else { setRows(data || []); setStatus(`${data?.length || 0} registrations loaded.`); }
    setLoading(false);
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (!tournamentId) return;
    setLoading(true);
    setStatus('Saving registration settings...');
    const payload = {
      registration_status: settings.registration_status,
      registration_opens_at: settings.registration_opens_at ? new Date(settings.registration_opens_at).toISOString() : null,
      registration_closes_at: settings.registration_closes_at ? new Date(settings.registration_closes_at).toISOString() : null,
    };
    const { error } = await supabase.from('tournaments').update(payload).eq('id', tournamentId);
    if (error) setStatus('Could not save registration settings: ' + error.message);
    else {
      setStatus('Registration settings saved.');
      await onTournamentUpdated?.();
    }
    setLoading(false);
  }

  async function review(row, nextStatus) {
    setLoading(true);
    setStatus(`${nextStatus === 'approved' ? 'Approving' : 'Rejecting'} ${row.manager_name}...`);
    const { error } = await supabase.from('tournament_registrations').update({
      status: nextStatus,
      reviewed_at: new Date().toISOString(),
      review_notes: row.review_notes || null,
    }).eq('id', row.id);
    if (error) setStatus('Review failed: ' + error.message);
    else { await loadRegistrations(); setStatus(`Registration ${nextStatus}.`); }
    setLoading(false);
  }

  async function updateReviewNotes(row, reviewNotes) {
    setRows((current) => current.map((item) => item.id === row.id ? { ...item, review_notes: reviewNotes } : item));
  }

  async function promote(row) {
    setLoading(true);
    setStatus(`Promoting ${row.manager_name} / ${row.club_name} to entrants...`);
    const { data, error } = await supabase.rpc('promote_registration_to_entrant', { registration_id: row.id });
    if (error) setStatus('Promotion failed: ' + error.message);
    else {
      await loadRegistrations();
      await onTournamentUpdated?.();
      setStatus(`Promoted to tournament entry #${data}.`);
    }
    setLoading(false);
  }

  async function promoteAllApproved() {
    const approved = rows.filter((row) => row.status === 'approved' && !row.promoted_entry_id);
    if (!approved.length) return setStatus('No approved registrations are waiting to be promoted.');
    setLoading(true);
    setStatus(`Promoting ${approved.length} approved registrations...`);
    try {
      for (const row of approved) {
        const { error } = await supabase.rpc('promote_registration_to_entrant', { registration_id: row.id });
        if (error) throw error;
      }
      await loadRegistrations();
      await onTournamentUpdated?.();
      setStatus(`${approved.length} registrations promoted to entrants.`);
    } catch (error) {
      setStatus('Bulk promotion failed: ' + error.message);
    }
    setLoading(false);
  }

  if (!selectedTournament) return <p className="muted">Select a tournament first.</p>;

  return <div className="registration-manager">
    <section className="entrant-panel">
      <p className="eyebrow">Registration window</p>
      <h3>{selectedTournament.name}</h3>
      <form onSubmit={saveSettings}>
        <div className="mini-grid">
          <label>Status<select value={settings.registration_status} onChange={(event) => setSettings((current) => ({ ...current, registration_status: event.target.value }))}><option value="closed">Closed</option><option value="open">Open</option><option value="paused">Paused</option><option value="full">Full</option></select></label>
          <label>Opens<input type="datetime-local" value={settings.registration_opens_at} onChange={(event) => setSettings((current) => ({ ...current, registration_opens_at: event.target.value }))} /></label>
          <label>Closes<input type="datetime-local" value={settings.registration_closes_at} onChange={(event) => setSettings((current) => ({ ...current, registration_closes_at: event.target.value }))} /></label>
        </div>
        <div className="button-row"><button type="submit" disabled={loading}>Save registration window</button><a className="button secondary" href={`/${selectedTournament.game_worlds?.slug || 'top-100'}/${selectedTournament.competition_types?.slug || 'youth-cup'}/${selectedTournament.public_slug || `s${selectedTournament.season_number}`}/register`} target="_blank" rel="noreferrer">Open public form</a></div>
      </form>
    </section>

    <section className="entrant-panel">
      <div className="card-header row"><div><p className="eyebrow">Registration review</p><h3>Pending, approved and rejected</h3></div><div className="button-row"><button type="button" className="secondary" onClick={loadRegistrations} disabled={loading}>Refresh</button><button type="button" onClick={promoteAllApproved} disabled={loading}>Promote all approved</button></div></div>
      <div className="status-filter-row">{filters.map((item) => <button type="button" key={item} className={filter === item ? 'status-filter active' : 'status-filter'} onClick={() => setFilter(item)}>{item} <span>{item === 'all' ? rows.length : counts[item] || 0}</span></button>)}</div>
      <p className="status">{status}</p>
      {!visible.length ? <p className="muted">No registrations in this filter.</p> : <div className="entrant-list">{visible.map((row) => <article className="entrant-row registration-row" key={row.id}><div className="registration-details"><strong>{row.manager_name} · {row.club_name}</strong><span>{row.manager_email} · rating {row.rating ?? 'not supplied'} · submitted {formatDate(row.submitted_at)}</span>{row.notes && <p>{row.notes}</p>}{row.promoted_entry_id && <span>Entrant created #{row.promoted_entry_id} · {formatDate(row.promoted_at)}</span>}<label>Admin note<input value={row.review_notes || ''} onChange={(event) => updateReviewNotes(row, event.target.value)} /></label></div><div className="button-row"><button type="button" className="secondary" onClick={() => review(row, 'approved')} disabled={loading || row.status === 'approved'}>Approve</button><button type="button" className="danger" onClick={() => review(row, 'rejected')} disabled={loading || row.status === 'rejected'}>Reject</button><button type="button" onClick={() => promote(row)} disabled={loading || row.status !== 'approved' || Boolean(row.promoted_entry_id)}>Promote</button></div></article>)}</div>}
    </section>
  </div>;
}
