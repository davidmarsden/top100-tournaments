import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const emptyForm = {
  manager_name: '',
  club_name: '',
  comment: '',
  prediction_score: '',
  player_to_watch: '',
  first_goalscorer: '',
  comment_type: 'pre_match',
};
const reactionButtons = [
  ['like', '👍'],
  ['laugh', '😂'],
  ['eyes', '👀'],
  ['fire', '🔥'],
];

function clean(value = '') { return String(value || '').trim(); }
function isPlayed(match) { return match?.status === 'played' || match?.status === 'forfeit'; }
function reactionsFor(comment) { return comment?.reactions || {}; }
function commentTypeLabel(type) {
  if (type === 'post_match') return 'Post-match reaction';
  if (type === 'admin_report') return 'Match report';
  if (type === 'admin_preview') return 'Preview';
  return 'Pre-match quote';
}
function managerBadge(comment) {
  if (comment.badge_label) return comment.badge_label;
  const text = `${comment.manager_name || ''} ${comment.club_name || ''}`.toLowerCase();
  if (text.includes('holder') || text.includes('champion')) return '🏆 Champion voice';
  return '';
}

export default function MatchComments({ match, tournamentId, compact = false }) {
  const [comments, setComments] = useState([]);
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [reactingId, setReactingId] = useState(null);

  useEffect(() => {
    if (hasSupabaseConfig && supabase && match?.id) loadComments();
  }, [match?.id]);

  useEffect(() => {
    setForm((current) => ({ ...current, comment_type: isPlayed(match) ? 'post_match' : 'pre_match' }));
  }, [match?.status]);

  const approvedCount = comments.length;
  const pinnedComment = useMemo(() => comments.find((item) => item.is_pinned || item.editor_pick), [comments]);
  const buttonLabel = approvedCount ? `View comments (${approvedCount})` : 'Add comment';

  async function loadComments() {
    const { data, error } = await supabase
      .from('match_comments')
      .select('id, manager_name, club_name, comment, comment_type, prediction_score, player_to_watch, first_goalscorer, is_pinned, editor_pick, badge_label, reactions, created_at')
      .eq('match_id', match.id)
      .eq('status', 'approved')
      .order('is_pinned', { ascending: false })
      .order('editor_pick', { ascending: false })
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
    const predictionScore = clean(form.prediction_score);
    const playerToWatch = clean(form.player_to_watch);
    const firstGoalscorer = clean(form.first_goalscorer);
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
      prediction_score: predictionScore || null,
      player_to_watch: playerToWatch || null,
      first_goalscorer: firstGoalscorer || null,
      comment_type: form.comment_type || (isPlayed(match) ? 'post_match' : 'pre_match'),
      status: 'pending',
    });
    setLoading(false);

    if (error) return setStatus('Could not submit comment: ' + error.message);
    setForm({ ...emptyForm, comment_type: isPlayed(match) ? 'post_match' : 'pre_match' });
    setShowForm(false);
    setOpen(true);
    setStatus('Comment submitted for approval.');
  }

  async function react(commentId, reactionKey) {
    setReactingId(commentId + reactionKey);
    const { error } = await supabase.rpc('react_to_match_comment', { comment_id: commentId, reaction_key: reactionKey });
    setReactingId(null);
    if (error) return setStatus('Could not add reaction: ' + error.message);
    setComments((rows) => rows.map((row) => row.id === commentId ? { ...row, reactions: { ...reactionsFor(row), [reactionKey]: Number(reactionsFor(row)[reactionKey] || 0) + 1 } } : row));
  }

  if (!hasSupabaseConfig || !supabase || !match?.id) return null;

  return <div className={compact ? 'match-comments compact' : 'match-comments'}>
    {pinnedComment && !open && <article className="match-comment pinned-comment-preview">
      <strong>⭐ Editor's pick · {pinnedComment.manager_name}{pinnedComment.club_name ? ` · ${pinnedComment.club_name}` : ''}</strong>
      <p>{pinnedComment.comment}</p>
    </article>}

    <div className="match-comments-actions">
      <button type="button" className="comment-toggle" onClick={() => { setOpen((value) => !value); if (!approvedCount) setShowForm(true); }}>
        💬 {buttonLabel}
      </button>
      {approvedCount > 0 && <button type="button" className="comment-toggle secondary-comment" onClick={() => { setShowForm((value) => !value); setOpen(true); }}>Add yours</button>}
    </div>

    {open && <div className="match-comments-body">
      {comments.length > 0 && <div className="approved-comments">
        {comments.map((item) => {
          const badge = managerBadge(item);
          const reactions = reactionsFor(item);
          return <article key={item.id} className={item.is_pinned || item.editor_pick ? 'match-comment pinned-comment' : 'match-comment'}>
            <div className="comment-meta-line">
              <strong>{item.editor_pick ? '⭐ ' : ''}{item.manager_name}{item.club_name ? ` · ${item.club_name}` : ''}</strong>
              <span>{commentTypeLabel(item.comment_type)}</span>
            </div>
            {badge && <small className="manager-badge">{badge}</small>}
            <p>{item.comment}</p>
            {(item.prediction_score || item.player_to_watch || item.first_goalscorer) && <div className="prediction-strip">
              {item.prediction_score && <span>🔮 {item.prediction_score}</span>}
              {item.player_to_watch && <span>⭐ {item.player_to_watch}</span>}
              {item.first_goalscorer && <span>⚽ {item.first_goalscorer}</span>}
            </div>}
            <div className="reaction-row">
              {reactionButtons.map(([key, emoji]) => <button type="button" key={key} onClick={() => react(item.id, key)} disabled={reactingId === item.id + key}>{emoji} {Number(reactions[key] || 0)}</button>)}
            </div>
          </article>;
        })}
      </div>}

      {showForm && <form className="match-comment-form" onSubmit={submitComment}>
        <div className="mini-grid">
          <label>Manager name<input value={form.manager_name} maxLength={80} onChange={(event) => updateField('manager_name', event.target.value)} /></label>
          <label>Club <input value={form.club_name} maxLength={80} onChange={(event) => updateField('club_name', event.target.value)} /></label>
        </div>
        <label>Comment type<select value={form.comment_type} onChange={(event) => updateField('comment_type', event.target.value)}><option value="pre_match">Pre-match quote</option><option value="post_match">Post-match reaction</option></select></label>
        <label>{isPlayed(match) ? 'Post-match reaction' : 'Pre-match comment'}<textarea value={form.comment} maxLength={500} rows={3} placeholder="Prediction, warning, excuse, mind game..." onChange={(event) => updateField('comment', event.target.value)} /></label>
        <div className="mini-grid">
          <label>Score prediction<input value={form.prediction_score} maxLength={30} placeholder="2-1" onChange={(event) => updateField('prediction_score', event.target.value)} /></label>
          <label>Player to watch<input value={form.player_to_watch} maxLength={80} onChange={(event) => updateField('player_to_watch', event.target.value)} /></label>
          <label>First scorer<input value={form.first_goalscorer} maxLength={80} onChange={(event) => updateField('first_goalscorer', event.target.value)} /></label>
        </div>
        <div className="button-row"><button type="submit" disabled={loading}>{loading ? 'Submitting...' : 'Submit for approval'}</button><button type="button" className="secondary" onClick={() => setShowForm(false)}>Cancel</button></div>
      </form>}

      {!comments.length && !showForm && <p className="muted">No approved comments yet.</p>}
      {status && <p className="status">{status}</p>}
    </div>}
  </div>;
}
