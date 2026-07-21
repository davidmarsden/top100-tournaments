import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const isCompleted = (match) => match.status === 'played' || match.status === 'forfeit';
const fullTeamName = (entry, fallback = 'TBC') => entry?.teams?.name || fallback;
const managerName = (entry) => entry?.managers?.display_name || entry?.managers?.name || 'Unknown manager';
const roundDateKey = (bracket, round) => `${bracket || 'Cup'}|${round || 'Round'}`;

const SHORT_CLUB_NAMES = {
  'Club Brugge NXT': 'Brugge NXT',
  'Espanyol Academy': 'Espanyol',
  'SC Internacional': 'Internacional',
  'Dynamo Kyiv Molodizhka': 'Dynamo Kyiv',
};

function shortClubName(value) {
  const name = String(value || 'TBC').trim();
  return SHORT_CLUB_NAMES[name] || name.replace(/ Academy$/i, '').trim();
}

function teamName(entry, fallback = 'TBC') {
  return shortClubName(fullTeamName(entry, fallback));
}

function parseDate(value) {
  if (!value) return null;
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  return date ? date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
}

function applyRoundDates(matches, roundDates) {
  const dateMap = new Map((roundDates || []).map((row) => [roundDateKey(row.bracket, row.round), row]));
  return matches.map((match) => {
    if (match.fixture_date || match.stage !== 'knockout') return match;
    const preset = dateMap.get(roundDateKey(match.bracket || 'Cup', match.round));
    if (!preset) return match;
    const fixtureDate = Number(match.leg || 1) === 2 ? (preset.leg2_date || preset.leg1_date) : preset.leg1_date;
    return fixtureDate ? { ...match, fixture_date: fixtureDate } : match;
  });
}

function latestCompletedMatchday(matches) {
  const completed = matches
    .filter((match) => isCompleted(match) && match.fixture_date)
    .sort((a, b) => (parseDate(b.fixture_date)?.getTime() || 0) - (parseDate(a.fixture_date)?.getTime() || 0));
  const date = completed[0]?.fixture_date;
  return date ? completed.filter((match) => match.fixture_date === date) : [];
}

function reactionTotal(comment) {
  return Object.values(comment?.reactions || {}).reduce((total, value) => total + Number(value || 0), 0);
}

function quoteExcerpt(value, maxLength = 160) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;

  const firstSentence = text.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  if (firstSentence && firstSentence.length >= 45 && firstSentence.length <= maxLength) return firstSentence;

  const window = text.slice(0, maxLength + 1);
  let cutAt = -1;
  for (const punctuation of ['.', '!', '?', ';', ',']) {
    const index = window.lastIndexOf(punctuation);
    if (index >= 70) {
      cutAt = Math.max(cutAt, index + 1);
    }
  }

  if (cutAt >= 70) {
    const excerpt = window.slice(0, cutAt).trim();
    return /[.!?]$/.test(excerpt) ? excerpt : `${excerpt.replace(/[,;:]$/, '')}…`;
  }

  const clipped = text.slice(0, maxLength - 1);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, lastSpace > 80 ? lastSpace : clipped.length).replace(/[.,;:!?-]+$/, '')}…`;
}

function resultLabel(match) {
  return `${teamName(match.home_entry, match.home_placeholder)} ${match.home_score}–${match.away_score} ${teamName(match.away_entry, match.away_placeholder)}`;
}

function bigWinsStory(recentResults) {
  const wins = recentResults
    .filter((match) => Number(match.home_score) !== Number(match.away_score))
    .map((match) => ({ match, margin: Math.abs(Number(match.home_score) - Number(match.away_score)) }))
    .filter(({ match, margin }) => margin >= 3 || match.status === 'forfeit')
    .sort((a, b) => b.margin - a.margin);
  if (!wins.length) return null;
  const shown = wins.slice(0, 4);
  return {
    id: 'roundup-big-wins',
    type: 'roundup',
    tag: 'Matchday round-up',
    title: shown.length === 1 ? 'One club lays down a marker' : `${shown.length} clubs lay down a marker`,
    meta: formatDate(shown[0].match.fixture_date),
    results: shown.map(({ match }) => resultLabel(match)),
  };
}

function pressRoomStory(comments, recentResults) {
  const relevantIds = new Set(recentResults.map((match) => match.id));
  const quotes = comments
    .filter((comment) => relevantIds.has(comment.match_id))
    .sort((a, b) => Number(Boolean(b.is_pinned || b.editor_pick)) - Number(Boolean(a.is_pinned || a.editor_pick)) || reactionTotal(b) - reactionTotal(a) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 3);
  if (!quotes.length) return null;
  return {
    id: 'press-room-roundup',
    type: 'press',
    tag: '🎙️ From the press room',
    title: 'Managers have their say',
    quotes: quotes.map((quote) => ({
      id: quote.id,
      text: quoteExcerpt(quote.comment),
      byline: `${quote.manager_name || 'Anonymous'}${quote.club_name ? ` · ${shortClubName(quote.club_name)}` : ''}`,
    })),
  };
}

function fairPlayStory(recentResults, forfeits, matches, entries) {
  const recentIds = new Set(recentResults.map((match) => match.id));
  const matchesById = new Map(matches.map((match) => [match.id, match]));
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const recentForfeits = forfeits.filter((row) => recentIds.has(row.match_id));
  if (!recentForfeits.length) return null;

  const people = recentForfeits.map((row) => {
    const match = matchesById.get(row.match_id);
    const entry = entriesById.get(row.forfeiting_entry_id);
    let club = teamName(entry, 'Unknown team');
    if (!entry && match) {
      const homeLost = Number(match.home_score) < Number(match.away_score);
      club = homeLost ? teamName(match.home_entry, match.home_placeholder) : teamName(match.away_entry, match.away_placeholder);
    }
    return { id: row.id, club, manager: row.manager_name || managerName(entry) };
  });

  return {
    id: 'fair-play-watch',
    type: 'forfeit',
    tag: '⚠️ Fair Play watch',
    title: `${people.length} forfeit${people.length === 1 ? '' : 's'} recorded`,
    forfeits: people,
    note: 'Each responsible manager is excluded from the prize draw. Three group-stage forfeits also mean knockout ineligibility.',
  };
}

function buildEditorialStories(matches, entries, comments, forfeits) {
  const recentResults = latestCompletedMatchday(matches);
  return [
    bigWinsStory(recentResults),
    pressRoomStory(comments, recentResults),
    fairPlayStory(recentResults, forfeits, matches, entries),
  ].filter(Boolean);
}

const headlineStyle = { fontSize: 'clamp(1.55rem, 2.6vw, 2.25rem)', lineHeight: 1.08, marginTop: '6px' };
const listStyle = { listStyle: 'none', padding: 0, margin: '14px 0 0', display: 'grid', gap: '9px' };

function EditorialCard({ story }) {
  const fullWidth = story.type === 'forfeit';
  return <article className={`featured-match-card spotlight-match-card editorial-story-card spotlight-${story.type}`} style={{ alignContent: 'start', gap: '10px', padding: '22px', gridColumn: fullWidth ? '1 / -1' : undefined }}>
    <span>{story.tag}</span>
    <strong style={headlineStyle}>{story.title}</strong>
    {story.meta && <small>{story.meta}</small>}
    {story.results && <ul style={listStyle}>{story.results.map((result) => <li key={result} style={{ fontSize: '1.12rem', fontWeight: 850, color: '#334155' }}>{result}</li>)}</ul>}
    {story.quotes && <div style={{ display: 'grid', gap: '12px', marginTop: '8px' }}>{story.quotes.map((quote) => <blockquote key={quote.id} style={{ margin: 0, padding: '10px 0', borderBottom: '1px solid #e4ebf7' }}><p style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800, color: '#334155' }}>“{quote.text}”</p><small>{quote.byline}</small></blockquote>)}</div>}
    {story.forfeits && <ul style={listStyle}>{story.forfeits.map((item) => <li key={item.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '12px', paddingBottom: '8px', borderBottom: '1px solid #e4ebf7' }}><strong>{item.club}</strong><span style={{ color: '#5f6f8e', fontWeight: 750 }}>{item.manager}</span></li>)}</ul>}
    {story.note && <p style={{ marginTop: '10px', color: '#5f6f8e', fontWeight: 750 }}>{story.note}</p>}
  </article>;
}

export default function EditorialStorylinesPortal({ tournamentId }) {
  const [host, setHost] = useState(null);
  const [matches, setMatches] = useState([]);
  const [entries, setEntries] = useState([]);
  const [comments, setComments] = useState([]);
  const [forfeits, setForfeits] = useState([]);
  const [status, setStatus] = useState('Loading the editorial desk...');

  useEffect(() => {
    let portalHost = null;
    let originalGrid = null;
    let observer = null;
    const mount = () => {
      const section = document.getElementById('featured');
      if (!section || portalHost) return false;
      originalGrid = section.querySelector('.featured-match-grid');
      if (originalGrid) originalGrid.style.display = 'none';
      portalHost = document.createElement('div');
      portalHost.className = 'featured-match-grid editorial-story-grid';
      portalHost.style.gridTemplateColumns = 'repeat(auto-fit, minmax(min(100%, 480px), 1fr))';
      portalHost.style.gap = '18px';
      section.appendChild(portalHost);
      setHost(portalHost);
      return true;
    };
    if (!mount()) {
      observer = new MutationObserver(() => { if (mount()) observer?.disconnect(); });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    return () => {
      observer?.disconnect();
      if (originalGrid) originalGrid.style.display = '';
      portalHost?.remove();
      setHost(null);
    };
  }, [tournamentId]);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase || !tournamentId) return undefined;
    loadData();
    const channel = supabase
      .channel(`editorial-storylines-${tournamentId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `tournament_id=eq.${tournamentId}` }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tournament_round_dates', filter: `tournament_id=eq.${tournamentId}` }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_comments', filter: `tournament_id=eq.${tournamentId}` }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'forfeits' }, loadData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tournamentId]);

  async function loadData() {
    const [matchesResult, entriesResult, roundDatesResult] = await Promise.all([
      supabase.from('matches').select('id, stage, round, leg, fixture_date, status, home_entry_id, away_entry_id, home_score, away_score, bracket, home_placeholder, away_placeholder, groups(code), home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(name), managers(name, display_name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(name), managers(name, display_name))').eq('tournament_id', tournamentId),
      supabase.from('tournament_entries').select('id, seed, group_code, teams(name), managers(name, display_name)').eq('tournament_id', tournamentId),
      supabase.from('tournament_round_dates').select('id, bracket, round, leg1_date, leg2_date').eq('tournament_id', tournamentId),
    ]);
    if (matchesResult.error || entriesResult.error || roundDatesResult.error) {
      setStatus(`Could not build storylines: ${matchesResult.error?.message || entriesResult.error?.message || roundDatesResult.error?.message}`);
      return;
    }

    const matchRows = applyRoundDates(matchesResult.data || [], roundDatesResult.data || []);
    const matchIds = matchRows.map((match) => match.id);
    let commentRows = [];
    let forfeitRows = [];
    if (matchIds.length) {
      const [commentsResult, forfeitsResult] = await Promise.all([
        supabase.from('match_comments').select('id, match_id, manager_name, club_name, comment, is_pinned, editor_pick, reactions, created_at').in('match_id', matchIds).eq('status', 'visible'),
        supabase.from('forfeits').select('id, match_id, forfeiting_entry_id, manager_id, affects_prize_draw').in('match_id', matchIds),
      ]);
      if (!commentsResult.error) commentRows = commentsResult.data || [];
      if (!forfeitsResult.error) {
        const rawForfeits = forfeitsResult.data || [];
        const managerIds = [...new Set(rawForfeits.map((row) => row.manager_id).filter(Boolean))];
        let profiles = [];
        if (managerIds.length) {
          const managersResult = await supabase.from('managers').select('id, name, display_name').in('id', managerIds);
          if (!managersResult.error) profiles = managersResult.data || [];
        }
        const profilesById = new Map(profiles.map((profile) => [profile.id, profile]));
        forfeitRows = rawForfeits.map((row) => {
          const profile = profilesById.get(row.manager_id);
          return { ...row, manager_name: profile?.display_name || profile?.name || null };
        });
      }
    }

    setMatches(matchRows);
    setEntries(entriesResult.data || []);
    setComments(commentRows);
    setForfeits(forfeitRows);
    setStatus('');
  }

  const stories = useMemo(() => buildEditorialStories(matches, entries, comments, forfeits), [matches, entries, comments, forfeits]);
  if (!host) return null;
  return createPortal(<>{status && <p className="status">{status}</p>}{!status && !stories.length && <p className="muted">No storylines are ready yet.</p>}{stories.map((story) => <EditorialCard key={story.id} story={story} />)}</>, host);
}
