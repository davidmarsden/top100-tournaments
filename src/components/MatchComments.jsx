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
  contribution_type: 'statement',
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
function conferenceLabel(type) {
  if (type === 'post_match') return 'Post-match press conference';
  if (type === 'admin_report') return 'Match report';
  if (type === 'admin_preview') return 'Press preview';
  return 'Pre-match press conference';
}
function contributionLabel(type) {
  if (type === 'question') return 'Question';
  if (type === 'comment') return 'Media comment';
  return 'Manager statement';
}
function contributionIcon(type) {
  if (type === 'question') return '❓';
  if (type === 'comment') return '💬';
  return '🎙️';
}
function managerBadge(comment) {
  if (comment.badge_label) return comment.badge_label;
  const text = `${comment.manager_name || ''} ${comment.club_name || ''}`.toLowerCase();
  if (text.includes('holder') || text.includes('champion')) return '🏆 Champion voice';
  return '';
}
function normaliseComment(item) {
  return {
    comment_type: 'pre_match',
    contribution_type: 'statement',
    prediction_score: null,
    player_to_watch: null,
    first_goalscorer: null,
    is_pinned: false,
    editor_pick: false,
    badge_label: null,
    reactions: {},
    ...item,
  };
}

function ConferenceSection({ title, subtitle, comments, onReact, reactingId }) {
  return <section className="press-conference-section">
    <div className="press-conference-heading">
      <div><p className="eyebrow">🎙️ Press room</p><h4>{title}</h4><p>{subtitle}</p></div>
      <span>{comments.length} contribution{comments.length === 1 ? '' : 's'}</span>
    </div>
    {comments.length ? <div className="approved-comments">{comments.map((item) => {
      const badge = managerBadge(item);
      const reactions = reactionsFor(item);
      return <article key={item.id} className={item.is_pinned || item.editor_pick ? 'match-comment pinned-comment' : 'match-comment'}>
        <div className="comment-meta-line">
          <strong>{item.editor_pick ? '⭐ ' : ''}{item.manager_name}{item.club_name ? ` · ${item.club_name}` : ''}</strong>
          <span>{contributionIcon(item.contribution_type)} {contributionLabel(item.contribution_type)}</span>
        </div>
        {badge && <small className="manager-badge">{badge}</small>}
        <p>{item.comment}</p>
        {(item.prediction_score || item.player_to_watch || item.first_goalscorer) && <div className="prediction-strip">
          {item.prediction_score && <span>🔮 {item.prediction_score}</span>}
          {item.player_to_watch && <span>⭐ {item.player_to_watch}</span>}
          {item.first_goalscorer && <span>⚽ {item.first_goalscorer}</span>}
        </div>}
        <div className="reaction-row">
          {reactionButtons.map(([key, emoji]) => <button type="button" key={key} onClick={() => onReact(item.id, key)} disabled={reactingId === item.id + key}>{emoji} {Number(reactions[key] || 0)}</button>)}
        </div>
      </article>;
    })}</div> : <p className="muted press-room-empty">The press room is quiet so far.</p>}
  </section>;
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
  const preMatchComments = useMemo(() => comments.filter((item) => item.comment_type !== 'post_match' && item.comment_type !== 'admin_report'), [comments]);
  const postMatchComments = useMemo(() => comments.filter((item) => item.comment_type === 'post_match' || item.comment_type === 'admin_report'), [comments]);
  const buttonLabel = approvedCount ? `Open press conferences (${approvedCount})` : 'Open press conference';

  async function loadComments() {
    const full = await supabase
      .from('match_comments')
      .select('id, manager_name, club_name, comment, comment_type, contribution_type, prediction_score, player_to_watch, first_goalscorer, is_pinned, editor_pick, badge_label, reactions, created_at')
      .eq('match_id', match.id)
      .eq('status', 'approved')
      .order('is_pinned', { ascending: false })
      .order('editor_pick', { ascending: false })
      .order('created_at', { ascending: true });

    if (!full.error) {
      setComments((full.data || []).map(normaliseComment));
      return;
    }

    const legacy = await supabase
      .from('match_comments')
      .select('id, manager_name, club_name, comment, created_at')
      .eq('match_id', match.id)
      .eq('status', 'approved')
      .order('created_at', { ascending: true });

    if (!legacy.error) setComments((legacy.data || []).map(normaliseComment));
    else setStatus('Could not load press conference: ' + legacy.error.message);
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
    if (comment.length < 3) return setStatus('Say something before leaving the microphone.');
    if (comment.length > 500) return setStatus('Keep press conference contributions under 500 characters.');

    setLoading(true);
    const fullInsert = await supabase.from('match_comments').insert({
      match_id: match.id,
      tournament_id: tournamentId || match.tournament_id || null,
      manager_name: managerName,
      club_name: clubName || null,
      comment,
      prediction_score: predictionScore || null,
      player_to_watch: playerToWatch || null,
      first_goalscorer: firstGoalscorer || null,
      comment_type: form.comment_type || (isPlayed(match) ? 'post_match' : 'pre_match'),
      contribution_type: form.contribution_type || 'statement',
      status: 'pending',
    });

    if (fullInsert.error) {
      const legacyInsert = await supabase.from('match_comments').insert({
        match_id: match.id,
        tournament_id: tournamentId || match.tournament_id || null,
        manager_name: managerName,
        club_name: clubName || null,
        comment,
        status: 'pending',
      });
      setLoading(false);
      if (legacyInsert.error) return setStatus('Could not submit contribution: ' + legacyInsert.error.message);
    } else {
      setLoading(false);
    }

    setForm({ ...emptyForm, comment_type: isPlayed(match) ? 'post_match' : 'pre_match' });
    setShowForm(false);
    setOpen(true);
    setStatus('Press conference contribution submitted for approval.');
  }

  async function react(commentId, reactionKey) {
    setReactingId(commentId + reactionKey);
    const { error } = await supabase.rpc('react_to_match_comment', { comment_id: commentId, reaction_key: reactionKey });
    setReactingId(null);
    if (error) return setStatus('Reactions will work after the comments SQL update is run.');
    setComments((rows) => rows.map((row) => row.id === commentId ? { ...row, reactions: { ...reactionsFor(row), [reactionKey]: Number(reactionsFor(row)[reactionKey] || 0) + 1 } } : row));
  }

  if (!hasSupabaseConfig || !supabase || !match?.id) return null;

  return <div className={compact ? 'match-comments press-conferences compact' : 'match-comments press-conferences'}>
    {pinnedComment && !open && <article className="match-comment pinned-comment-preview">
      <strong>⭐ Headline quote · {pinnedComment.manager_name}{pinnedComment.club_name ? ` · ${pinnedComment.club_name}` : ''}</strong>
      <p>{pinnedComment.comment}</p>
    </article>}

    <div className="match-comments-actions">
      <button type="button" className="comment-toggle" onClick={() => { setOpen((value) => !value); if (!approvedCount) setShowForm(true); }}>
        🎙️ {buttonLabel}
      </button>
      {approvedCount > 0 && <button type="button" className="comment-toggle secondary-comment" onClick={() => { setShowForm((value) => !value); setOpen(true); }}>Take the microphone</button>}
    </div>

    {open && <div className="match-comments-body">
      <ConferenceSection title="Pre-match press conference" subtitle="Statements, predictions, questions and mind games before kickoff." comments={preMatchComments} onReact={react} reactingId={reactingId} />
      {(isPlayed(match) || postMatchComments.length > 0) && <ConferenceSection title="Post-match press conference" subtitle="Manager reactions, awkward questions and the final word after the whistle." comments={postMatchComments} onReact={react} reactingId={reactingId} />}

      {showForm && <form className="match-comment-form press-conference-form" onSubmit={submitComment}>
        <div className="press-form-header"><div><p className="eyebrow">🎤 Your turn</p><h4>Enter the press room</h4></div><span>{conferenceLabel(form.comment_type)}</span></div>
        <div className="mini-grid">
          <label>Manager name<input value={form.manager_name} maxLength={80} onChange={(event) => updateField('manager_name', event.target.value)} /></label>
          <label>Club<input value={form.club_name} maxLength={80} onChange={(event) => updateField('club_name', event.target.value)} /></label>
        </div>
        <div className="mini-grid">
          <label>Press conference<select value={form.comment_type} onChange={(event) => updateField('comment_type', event.target.value)}><option value="pre_match">Pre-match</option><option value="post_match">Post-match</option></select></label>
          <label>Contribution<select value={form.contribution_type} onChange={(event) => updateField('contribution_type', event.target.value)}><option value="statement">Manager statement</option><option value="question">Ask a question</option><option value="comment">Media comment</option></select></label>
        </div>
        <label>{form.contribution_type === 'question' ? 'Your question' : form.contribution_type === 'comment' ? 'Your comment' : 'Your statement'}<textarea value={form.comment} maxLength={500} rows={3} placeholder={form.contribution_type === 'question' ? 'Ask the managers something...' : 'Prediction, warning, excuse, mind game...'} onChange={(event) => updateField('comment', event.target.value)} /></label>
        {form.comment_type === 'pre_match' && <div className="mini-grid">
          <label>Score prediction<input value={form.prediction_score} maxLength={30} placeholder="2-1" onChange={(event) => updateField('prediction_score', event.target.value)} /></label>
          <label>Player to watch<input value={form.player_to_watch} maxLength={80} onChange={(event) => updateField('player_to_watch', event.target.value)} /></label>
          <label>First scorer<input value={form.first_goalscorer} maxLength={80} onChange={(event) => updateField('first_goalscorer', event.target.value)} /></label>
        </div>}
        <div className="button-row"><button type="submit" disabled={loading}>{loading ? 'Submitting...' : 'Submit for approval'}</button><button type="button" className="secondary" onClick={() => setShowForm(false)}>Leave press room</button></div>
      </form>}

      {status && <p className="status">{status}</p>}
    </div>}
  </div>;
}
