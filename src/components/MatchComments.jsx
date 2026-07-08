import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const emptyForm = { manager_name: '', club_name: '', comment: '' };

function clean(value = '') {
  return String(value || '').trim();
}

export default function MatchComments({ match, tournamentId, compact = false }) {
  const [comments, setComments] = useState([]);
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (hasSupabaseConfig && supabase && match?.id) loadComments();
  }, [match?.id]);

  const approvedCount = comments.length;
  const buttonLabel = approvedCount ? `View comments (${approvedCount})` : 'Add comment';

  async function loadComments() {
    const { data, error } = await supabase
      .from('match_comments')
      .select('id, manager_name, club_name, comment, created_at')
      .eq('match_id', match.id)
      .eq('status', 'approved')
      .order('created_at', { ascending: true });
    if (!error) setComments(data || []);
  }

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submitComment(event) {
    event.preventDefault();
    setStatus('');
    const managerName = clean(form.manager_name);
    const comment = clean(form.comment);
    const clubName = clean(form.club_name);
    if (managerName.length < 2) return setStatus('Add your manager name.');
    if (comment.length < 3) return setStatus('Write a short comment first.');
    if (comment.length > 500) return setStatus('Keep comments under 500 characters.');

    setLoading(true);
    const { error } = await supabase.from('match_comments').insert({
      match_id: match.id,
      tournament_id: tournamentId || match.tournament_id || null,
      manager_name: managerName,
      club_name: clubName || null,
      comment,
      status: 'pending',
    });
    setLoading(false);

    if (error) return setStatus('Could not submit comment: ' + error.message);
    setForm(emptyForm);
    setShowForm(false);
    setOpen(true);
    setStatus('Comment submitted for approval.');
  }

  if (!hasSupabaseConfig || !supabase || !match?.id) return null;

  return <div className={compact ? 'match-comments compact' : 'match-comments'}>
    <div className="match-comments-actions">
      <button type="button" className="comment-toggle" onClick={() => { setOpen((value) => !value); if (!approvedCount) setShowForm(true); }}>
        💬 {buttonLabel}
      </button>
      {approvedCount > 0 && <button type="button" className="comment-toggle secondary-comment" onClick={() => { setShowForm((value) => !value); setOpen(true); }}>Add yours</button>}
    </div>

    {open && <div className="match-comments-body">
      {comments.length > 0 && <div className="approved-comments">
        {comments.map((item) => <article key={item.id} className="match-comment">
          <strong>{item.manager_name}{item.club_name ? ` · ${item.club_name}` : ''}</strong>
          <p>{item.comment}</p>
        </article>)}
      </div>}

      {showForm && <form className="match-comment-form" onSubmit={submitComment}>
        <div className="mini-grid">
          <label>Manager name<input value={form.manager_name} maxLength={80} onChange={(event) => updateField('manager_name', event.target.value)} /></label>
          <label>Club <input value={form.club_name} maxLength={80} onChange={(event) => updateField('club_name', event.target.value)} /></label>
        </div>
        <label>Pre-match comment<textarea value={form.comment} maxLength={500} rows={3} placeholder="Prediction, warning, excuse, mind game..." onChange={(event) => updateField('comment', event.target.value)} /></label>
        <div className="button-row"><button type="submit" disabled={loading}>{loading ? 'Submitting...' : 'Submit for approval'}</button><button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button></div>
      </form>}

      {!comments.length && !showForm && <p className="muted">No approved comments yet.</p>}
      {status && <p className="status">{status}</p>}
    </div>}
  </div>;
}
