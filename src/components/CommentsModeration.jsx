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
function conferenceLabel(type) {
  if (type === 'post_match') return 'Post-match press conference';
  if (type === 'admin_preview') return 'Press preview';
  if (type === 'admin_report') return 'Match report';
  return 'Pre-match press conference';
}
function contributionLabel(type) {
  if (type === 'question') return 'Question';
  if (type === 'comment') return 'Media comment';
  return 'Manager statement';
}
function normaliseComment(item) {
  return {
    comment_type: 'pre_match', contribution_type: 'statement', prediction_score: null,
    player_to_watch: null, first_goalscorer: null, badge_label: null, is_pinned: false,
    editor_pick: false, reactions: {}, ...item,
  };
}

export default function CommentsModeration({ selectedTournament }) {
  const [comments, setComments] = useState([]);
  const [reports, setReports] = useState([]);
  const [statusFilter, setStatusFilter] = useState('visible');
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedTournament?.id) loadEverything();
  }, [selectedTournament?.id, statusFilter]);

  const unresolvedReports = useMemo(() => reports.filter((report) => report.status === 'unresolved'), [reports]);
  const reportsByComment = useMemo(() => {
    const map = new Map();
    unresolvedReports.forEach((report) => {
      const rows = map.get(report.content_id) || [];
      rows.push(report);
      map.set(report.content_id, rows);
    });
    return map;
  }, [unresolvedReports]);

  async function loadEverything() {
    if (!hasSupabaseConfig || !supabase || !selectedTournament?.id) return;
    setLoading(true);
    setStatus('Loading press room moderation...');

    let commentsQuery = supabase
      .from('match_comments')
      .select('id, manager_name, club_name, comment, comment_type, contribution_type, prediction_score, player_to_watch, first_goalscorer, badge_label, is_pinned, editor_pick, reactions, status, created_at, matches(id, round, fixture_date, home_placeholder, away_placeholder, home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(id, name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(id, name)))')
      .eq('tournament_id', selectedTournament.id)
      .order('created_at', { ascending: false });
    if (statusFilter !== 'all') commentsQuery = commentsQuery.eq('status', statusFilter);

    const commentsResult = await commentsQuery;
    const reportsResult = await supabase
      .from('content_reports')
      .select('id, content_type, content_id, reporter_id, reason, status, created_at, resolved_at, resolution_note')
      .eq('content_type', 'match_comment')
      .order('created_at', { ascending: false });

    setLoading(false);
    if (commentsResult.error) return setStatus('Could not load press conference contributions: ' + commentsResult.error.message);
    if (reportsResult.error) return setStatus('Could not load content reports: ' + reportsResult.error.message);
    setComments((commentsResult.data || []).map(normaliseComment));
    setReports(reportsResult.data || []);
    setStatus(`${commentsResult.data?.length || 0} contributions loaded · ${reportsResult.data?.filter((item) => item.status === 'unresolved').length || 0} unresolved reports.`);
  }

  async function updateComment(id, patch, message) {
    setLoading(true);
    const { error } = await supabase.from('match_comments').update(patch).eq('id', id);
    setLoading(false);
    if (error) return setStatus('Update failed: ' + error.message);
    setComments((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row).filter((row) => statusFilter === 'all' || row.status === statusFilter));
    setStatus(message || 'Contribution updated.');
  }

  async function moderate(item, nextStatus) {
    const action = nextStatus === 'visible' ? 'restore' : nextStatus === 'hidden' ? 'hide' : 'permanently remove';
    const note = nextStatus === 'visible' ? null : window.prompt(`Reason to ${action} this contribution?`, '');
    if (nextStatus !== 'visible' && note === null) return;
    if (nextStatus === 'removed' && !window.confirm('Permanently remove this contribution from public view? The moderation record will be retained.')) return;
    setLoading(true);
    const { error } = await supabase.rpc('moderate_match_comment', {
      target_comment_id: item.id,
      target_status: nextStatus,
      moderation_note: note || null,
    });
    setLoading(false);
    if (error) return setStatus('Moderation failed: ' + error.message);
    setStatus(`Contribution marked ${nextStatus}.`);
    await loadEverything();
  }

  async function resolveReport(report, nextStatus) {
    const note = window.prompt(nextStatus === 'dismissed' ? 'Why is this report being dismissed?' : 'Resolution note?', '');
    if (note === null) return;
    const { data: userData } = await supabase.auth.getUser();
    setLoading(true);
    const { error } = await supabase.from('content_reports').update({
      status: nextStatus,
      resolved_at: new Date().toISOString(),
      resolved_by: userData?.user?.id || null,
      resolution_note: note.trim() || null,
    }).eq('id', report.id);
    setLoading(false);
    if (error) return setStatus('Could not update report: ' + error.message);
    setStatus(`Report ${nextStatus}.`);
    await loadEverything();
  }

  async function promptBadge(item) {
    const next = window.prompt('Badge label, e.g. 🏆 Current holder, ⭐ Top seed, 🛡️ Shield holder', item.badge_label || '');
    if (next === null) return;
    updateComment(item.id, { badge_label: next.trim() || null }, 'Badge updated.');
  }

  if (!selectedTournament) return <p className="muted">Select a tournament first.</p>;

  return <div className="comments-moderation">
    <div className="overview-actions bulk-toolbar">
      <p className="muted">Press conference contributions publish immediately. Review reports, hide or restore content, permanently remove serious breaches, and feature the best contributions.</p>
      <div className="status-filter-row">
        {['visible', 'hidden', 'removed', 'all'].map((value) => <button key={value} type="button" className={statusFilter === value ? 'status-filter active' : 'status-filter'} onClick={() => setStatusFilter(value)}>{value}</button>)}
      </div>
      <button type="button" className="secondary" onClick={loadEverything} disabled={loading}>Refresh press room</button>
      <p className="status">{status}</p>
    </div>

    <section className="card module-card">
      <div className="card-header"><p className="eyebrow">Moderation queue</p><h3>Unresolved reports ({unresolvedReports.length})</h3></div>
      {!unresolvedReports.length && <p className="muted">No unresolved reports.</p>}
      <div className="comment-moderation-list">
        {unresolvedReports.map((report) => {
          const item = comments.find((comment) => comment.id === report.content_id);
          return <article className="comment-moderation-card" key={report.id}>
            <p className="eyebrow">Reported {formatDate(report.created_at)} · {report.content_type}</p>
            <h3>{item ? fixtureTitle(item) : `Contribution #${report.content_id}`}</h3>
            {item && <p className="comment-quote">“{item.comment}”</p>}
            <p><strong>Reason:</strong> {report.reason}</p>
            <div className="button-row">
              {item?.status === 'visible' && <button type="button" className="danger" onClick={() => moderate(item, 'hidden')} disabled={loading}>Hide content</button>}
              {item?.status === 'hidden' && <button type="button" onClick={() => moderate(item, 'visible')} disabled={loading}>Restore content</button>}
              {item?.status !== 'removed' && <button type="button" className="danger" onClick={() => moderate(item, 'removed')} disabled={loading}>Remove permanently</button>}
              <button type="button" className="secondary" onClick={() => resolveReport(report, 'resolved')} disabled={loading}>Resolve report</button>
              <button type="button" className="secondary" onClick={() => resolveReport(report, 'dismissed')} disabled={loading}>Dismiss report</button>
            </div>
          </article>;
        })}
      </div>
    </section>

    <div className="comment-moderation-list">
      {comments.map((item) => {
        const itemReports = reportsByComment.get(item.id) || [];
        return <article className={item.is_pinned || item.editor_pick ? 'comment-moderation-card featured-moderation-card' : 'comment-moderation-card'} key={item.id}>
          <div className="card-header row">
            <div>
              <p className="eyebrow">{item.status} · {conferenceLabel(item.comment_type)} · {contributionLabel(item.contribution_type)} · {formatDate(item.created_at)}</p>
              <h3>{fixtureTitle(item)}</h3>
            </div>
            <span className={`status-pill status-${item.status}`}>{item.status}</span>
          </div>
          <p className="comment-quote">“{item.comment}”</p>
          <p className="muted"><strong>{item.manager_name}</strong>{item.club_name ? ` · ${item.club_name}` : ''}{item.badge_label ? ` · ${item.badge_label}` : ''}</p>
          {itemReports.length > 0 && <p className="status">🚩 {itemReports.length} unresolved report{itemReports.length === 1 ? '' : 's'}</p>}
          {(item.prediction_score || item.player_to_watch || item.first_goalscorer) && <div className="prediction-strip moderation-predictions">
            {item.prediction_score && <span>🔮 {item.prediction_score}</span>}
            {item.player_to_watch && <span>⭐ {item.player_to_watch}</span>}
            {item.first_goalscorer && <span>⚽ {item.first_goalscorer}</span>}
          </div>}
          <div className="button-row">
            {item.status !== 'visible' && <button type="button" onClick={() => moderate(item, 'visible')} disabled={loading}>Restore</button>}
            {item.status === 'visible' && <button type="button" className="danger" onClick={() => moderate(item, 'hidden')} disabled={loading}>Hide</button>}
            {item.status !== 'removed' && <button type="button" className="danger" onClick={() => moderate(item, 'removed')} disabled={loading}>Remove permanently</button>}
            {item.status === 'visible' && <button type="button" className="secondary" onClick={() => updateComment(item.id, { is_pinned: !item.is_pinned }, item.is_pinned ? 'Headline quote removed.' : 'Set as headline quote.')}>{item.is_pinned ? 'Unpin' : 'Headline quote'}</button>}
            {item.status === 'visible' && <button type="button" className="secondary" onClick={() => updateComment(item.id, { editor_pick: !item.editor_pick }, item.editor_pick ? 'Editor pick removed.' : 'Marked Editor pick.')}>{item.editor_pick ? 'Remove pick' : "Editor's Pick"}</button>}
            {item.status === 'visible' && <button type="button" className="secondary" onClick={() => promptBadge(item)}>Badge</button>}
          </div>
        </article>;
      })}
      {!comments.length && <p className="muted">No press conference contributions in this filter.</p>}
    </div>
  </div>;
}
