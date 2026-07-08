import { useEffect, useMemo, useState } from 'react';
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
      .select('id, manager_name, club_name, comment, status, created_at, matches(id, round, fixture_date, home_placeholder, away_placeholder, home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(id, name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(id, name)))')
      .eq('tournament_id', selectedTournament.id)
      .order('created_at', { ascending: false });
    if (statusFilter !== 'all') query = query.eq('status', statusFilter);
    const { data, error } = await query;
    setLoading(false);
    if (error) return setStatus('Could not load comments: ' + error.message);
    setComments(data || []);
    setStatus(`${data?.length || 0} comments loaded.`);
  }

  async function setCommentStatus(id, nextStatus) {
    setLoading(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from('match_comments')
      .update({ status: nextStatus, moderated_at: new Date().toISOString(), moderated_by: userData?.user?.id || null })
      .eq('id', id);
    setLoading(false);
    if (error) return setStatus('Update failed: ' + error.message);
    setComments((rows) => rows.map((row) => row.id === id ? { ...row, status: nextStatus } : row).filter((row) => statusFilter === 'all' || row.status === statusFilter));
    setStatus(`Comment marked ${nextStatus}.`);
  }

  if (!selectedTournament) return <p className="muted">Select a tournament first.</p>;

  return <div className="comments-moderation">
    <div className="overview-actions bulk-toolbar">
      <p className="muted">Approve manager comments before they appear publicly under match cards.</p>
      <div className="status-filter-row">
        {['pending', 'approved', 'hidden', 'all'].map((value) => <button key={value} type="button" className={statusFilter === value ? 'status-filter active' : 'status-filter'} onClick={() => setStatusFilter(value)}>{value}</button>)}
      </div>
      <button type="button" className="secondary" onClick={loadComments} disabled={loading}>Refresh comments</button>
      <p className="status">{status}</p>
    </div>

    <div className="comment-moderation-list">
      {comments.map((item) => <article className="comment-moderation-card" key={item.id}>
        <div className="card-header row">
          <div>
            <p className="eyebrow">{item.status} · {formatDate(item.created_at)}</p>
            <h3>{fixtureTitle(item)}</h3>
          </div>
          <span className={`status-pill status-${item.status}`}>{item.status}</span>
        </div>
        <p className="comment-quote">“{item.comment}”</p>
        <p className="muted"><strong>{item.manager_name}</strong>{item.club_name ? ` · ${item.club_name}` : ''}</p>
        <div className="button-row">
          <button type="button" onClick={() => setCommentStatus(item.id, 'approved')} disabled={loading || item.status === 'approved'}>Approve</button>
          <button type="button" className="secondary" onClick={() => setCommentStatus(item.id, 'pending')} disabled={loading || item.status === 'pending'}>Pending</button>
          <button type="button" className="danger" onClick={() => setCommentStatus(item.id, 'hidden')} disabled={loading || item.status === 'hidden'}>Hide</button>
        </div>
      </article>)}
      {!comments.length && <p className="muted">No comments in this filter.</p>}
    </div>
  </div>;
}
