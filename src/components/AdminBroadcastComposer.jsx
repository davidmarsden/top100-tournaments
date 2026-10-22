import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Sends an announcement to every active Manager Portal account (or one game
// world). It lands in each manager's Top 100 app inbox and is pushed to devices
// that have notifications on.
export default function AdminBroadcastComposer() {
  const [worlds, setWorlds] = useState([]);
  const [form, setForm] = useState({ title: '', body: '', url: '', worldId: '' });
  const [status, setStatus] = useState({ state: 'idle', message: '' });

  useEffect(() => {
    supabase?.from('game_worlds').select('id, name').order('display_order').then(({ data }) => setWorlds(data || []));
  }, []);

  const update = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function send(event) {
    event.preventDefault();
    const audience = worlds.find((world) => String(world.id) === form.worldId)?.name || 'all game worlds';
    if (!window.confirm(`Send "${form.title.trim()}" to every active manager in ${audience}?`)) return;
    setStatus({ state: 'sending', message: '' });
    const { data, error } = await supabase.rpc('send_manager_broadcast', {
      p_title: form.title,
      p_body: form.body,
      p_url: form.url.trim() || null,
      p_game_world_id: form.worldId ? Number(form.worldId) : null,
    });
    if (error) { setStatus({ state: 'error', message: error.message }); return; }
    setForm({ title: '', body: '', url: '', worldId: form.worldId });
    setStatus({ state: 'sent', message: `Sent to ${data} manager account${data === 1 ? '' : 's'}.` });
  }

  return (
    <section className="manager-resource-hub admin-broadcast" aria-labelledby="admin-broadcast-heading">
      <div className="manager-resource-hub__intro">
        <p className="eyebrow">Top 100 app</p>
        <h2 id="admin-broadcast-heading">Send an announcement</h2>
        <p>Appears in every manager's notifications on manager.smtop100.blog and is pushed to devices with notifications on.</p>
      </div>
      <form onSubmit={send}>
        <label>Audience<select value={form.worldId} onChange={update('worldId')}><option value="">All game worlds</option>{worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}</select></label>
        <label>Title<input value={form.title} onChange={update('title')} minLength={3} maxLength={120} required /></label>
        <label>Message<textarea value={form.body} onChange={update('body')} maxLength={500} required /></label>
        <label>Link (optional, a smtop100.blog page)<input type="url" value={form.url} onChange={update('url')} placeholder="https://smtop100.blog/…" /></label>
        <div className="button-row"><button type="submit" disabled={status.state === 'sending'}>{status.state === 'sending' ? 'Sending…' : 'Send announcement'}</button></div>
        {status.message && <p className="status" role={status.state === 'error' ? 'alert' : 'status'}>{status.message}</p>}
      </form>
    </section>
  );
}
