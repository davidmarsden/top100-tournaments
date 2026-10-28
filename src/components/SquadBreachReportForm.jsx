import { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Report a Top 100 club over the 50-player limit (rule 4.1). An administrator's report
// counts as confirmed and the club's manager is told at once; a manager's report goes to
// the administrators, and the club's manager is told only if they uphold it.
export default function SquadBreachReportForm({ clubs = [], official = false, onReported }) {
  const [form, setForm] = useState({ club: '', players: 51, observedOn: new Date().toISOString().slice(0, 10), note: '' });
  const [status, setStatus] = useState('');
  const [sending, setSending] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setSending(true);
    setStatus('');
    const { error } = await supabase.rpc('report_squad_cap_breach', {
      p_club_name: form.club,
      p_players: Number(form.players),
      p_observed_on: form.observedOn,
      p_note: form.note || null,
    });
    setSending(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    setStatus(official ? `Recorded. ${form.club}'s manager has been notified.` : 'Thanks: the admin team has been told and will check it.');
    setForm({ ...form, club: '', note: '' });
    onReported?.();
  }

  const set = (key) => (event) => setForm({ ...form, [key]: event.target.value });
  return (
    <form onSubmit={submit}>
      <label>
        Club{' '}
        <input list="squad-breach-clubs" value={form.club} onChange={set('club')} required placeholder="e.g. US Sassuolo" />
        <datalist id="squad-breach-clubs">{clubs.map((club) => <option key={club} value={club} />)}</datalist>
      </label>{' '}
      <label>Players <input type="number" min="51" max="99" value={form.players} onChange={set('players')} required /></label>{' '}
      <label>On <input type="date" value={form.observedOn} max={new Date().toISOString().slice(0, 10)} onChange={set('observedOn')} required /></label>{' '}
      <label>What you saw <input value={form.note} onChange={set('note')} placeholder="e.g. 52 on their squad page after turn 36" /></label>{' '}
      <button type="submit" disabled={sending}>{sending ? 'Sending…' : 'Report'}</button>
      {status && <p role="status">{status}</p>}
    </form>
  );
}
