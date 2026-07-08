import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function fixtureTitle(row) {
  const match = row.matches;
  const home = match?.home_entry?.teams?.name || match?.home_placeholder || 'TBC';
  const away = match?.away_entry?.teams?.name || match?.away_placeholder || 'TBC';
  return `${home} v ${away}`;
}
function commentTypeLabel(type) {
  if (type === 'post_match') return 'Post-match reaction';
  if (type === 'admin_preview') return 'Admin preview';
  if (type === 'admin_report') return 'Match report';
  return 'Pre-match quote';
}

export default function CommentsModeration({ selectedTournament }) {
  const [comments, setComments] = useState([]);
  const [statusFilter, setStatusFilter] = useState('pending');
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedTournament?.id) loadComments();
  }, [selectedTournament?.id, statusFilter]);

  async function loadComments() {
    if (!hasSupabaseConfig || !supabase || !selectedTournament?.id) return;
    setLoading(true);
    setStatus('Loading comments...');
    let query = supabase
      .from('match_comments')
      .select('id, manager_name, club_name, comment, comment_type, prediction_score, player_to_watch, first_goalscorer, badge_label, is_pinned, editor_pick, reactions, status, created_at, matches(id, round, fixture_date, home_placeholder, away_placeholder, home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(id, name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(id, name)))')
      .eq('tournament_id', selectedTournament.id)
      .order('is_pinned', { ascending: false })
      .order('editor_pick', { ascending: false })
      .order('created_at', { ascending: false });
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    const { data, error } = await query;
    setLoading(false);
    if (error) return setStatus('Could not load comments: ' + error.message);
    setComments(data || []);
    setStatus(`${data?.length || 0} comments loaded.`);
  }

  async function updateComment(id, patch, message) {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const payload = patch.status ? { ...patch, moderated_at: new Date().toISOString(), moderated_by: userData?.user?.id || null } : patch;
    const { error } = await supabase.from('match_comments').update(payload).eq('id', id);
    setLoading(false);
    if (error) return setStatus('Update failed: ' + error.message);
    setComments((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row).filter((row) => statusFilter === 'all' || row.status === statusFilter));
    setStatus(message || 'Comment updated.');
  }

  function setCommentStatus(id, nextStatus) {
    updateComment(id, { status: nextStatus }, `Comment marked ${nextStatus}.`);
  }

  async function promptBadge(item) {
    const next = window.prompt('Badge label, e.g. 🏆 Current holder, ⭐ Top seed, 🛡️ Shield holder', item.badge_label || '');
    if (next === null) return;
    updateComment(item.id, { badge_label: next.trim() || null }, 'Badge updated.');
  }

  if (!selectedTournament) return <p className="muted">Select a tournament first.</p>;

  return <div className="comments-moderation">
    <div className="overview-actions bulk-toolbar">
      <p className="muted">Approve manager comments before they appear publicly. Pin one as the headline quote, mark an Editor's Pick, or add a badge.</p>
      <div className="status-filter-row">
        {['pending', 'approved', 'hidden', 'all'].map((value) => <button key={value} type="button" className={statusFilter === value ? 'status-filter active' : 'status-filter'} onClick={() => setStatusFilter(value)}>{value}</button>)}
      </div>
      <button type="button" className="secondary" onClick={loadComments} disabled={loading}>Refresh comments</button>
      <p className="status">{status}</p>
    </div>

    <div className="comment-moderation-list">
      {comments.map((item) => <article className={item.is_pinned || item.editor_pick ? 'comment-moderation-card featured-moderation-card' : 'comment-moderation-card'} key={item.id}>
        <div className="card-header row">
          <div>
            <p className="eyebrow">{item.status} · {commentTypeLabel(item.comment_type)} · {formatDate(item.created_at)}</p>
            <h3>{fixtureTitle(item)}</h3>
          </div>
          <span className={`status-pill status-${item.status}`}>{item.status}</span>
        </div>
        <p className="comment-quote">“{item.comment}”</p>
        <p className="muted"><strong>{item.manager_name}</strong>{item.club_name ? ` · ${item.club_name}` : ''}{item.badge_label ? ` · ${item.badge_label}` : ''}</p>
        {(item.prediction_score || item.player_to_watch || item.first_goalscorer) && <div className="prediction-strip moderation-predictions">
          {item.prediction_score && <span>🔮 {item.prediction_score}</span>}
          {item.player_to_watch && <span>⭐ {item.player_to_watch}</span>}
          {item.first_goalscorer && <span>⚽ {item.first_goalscorer}</span>}
        </div>}
        <div className="button-row">
          <button type="button" onClick={() => setCommentStatus(item.id, 'approved')} disabled={loading || item.status === 'approved'}>Approve</button>
          <button type="button" className="secondary" onClick={() => setCommentStatus(item.id, 'pending')} disabled={loading || item.status === 'pending'}>Pending</button>
          <button type="button" className="danger" onClick={() => setCommentStatus(item.id, 'hidden')} disabled={loading || item.status === 'hidden'}>Hide</button>
          <button type="button" className="secondary" onClick={() => updateComment(item.id, { is_pinned: !item.is_pinned }, item.is_pinned ? 'Unpinned.' : 'Pinned.')}>{item.is_pinned ? 'Unpin' : 'Pin'}</button>
          <button type="button" className="secondary" onClick={() => updateComment(item.id, { editor_pick: !item.editor_pick }, item.editor_pick ? 'Editor pick removed.' : 'Marked Editor pick.')}>{item.editor_pick ? 'Remove pick' : "Editor's Pick"}</button>
          <button type="button" className="secondary" onClick={() => promptBadge(item)}>Badge</button>
        </div>
      </article>)}
      {!comments.length && <p className="muted">No comments in this filter.</p>}
    </div>
  </div>;
}
