import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const isCompleted = (match) => match.status === 'played' || match.status === 'forfeit';
const teamName = (entry, fallback = 'TBC') => entry?.teams?.name || fallback;
const managerName = (entry) => entry?.managers?.display_name || entry?.managers?.name || 'TBC';
const groupCode = (match) => match.groups?.code || '—';

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

function tableSort(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
  if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
  return Number(a.seed || 9999) - Number(b.seed || 9999);
}

function buildTables(entries, matches) {
  const groups = new Map();
  entries.forEach((entry) => {
    const code = entry.group_code || 'Ungrouped';
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(entry);
  });

  return [...groups.entries()].map(([code, groupEntries]) => {
    const rows = new Map(groupEntries.map((entry) => [entry.id, {
      entry_id: entry.id,
      team_name: teamName(entry, 'Unknown team'),
      manager_name: managerName(entry),
      seed: entry.seed,
      points: 0,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals_for: 0,
      goals_against: 0,
      goal_difference: 0,
      group_code: code,
    }]));

    matches.filter((match) => match.stage === 'group' && groupCode(match) === code && isCompleted(match)).forEach((match) => {
      const home = rows.get(match.home_entry_id);
      const away = rows.get(match.away_entry_id);
      if (!home || !away) return;
      const hs = Number(match.home_score || 0);
      const as = Number(match.away_score || 0);
      home.played += 1; away.played += 1;
      home.goals_for += hs; home.goals_against += as;
      away.goals_for += as; away.goals_against += hs;
      if (hs > as) { home.wins += 1; home.points += 3; away.losses += 1; }
      else if (as > hs) { away.wins += 1; away.points += 3; home.losses += 1; }
      else { home.draws += 1; away.draws += 1; home.points += 1; away.points += 1; }
    });

    const ordered = [...rows.values()]
      .map((row) => ({ ...row, goal_difference: row.goals_for - row.goals_against }))
      .sort(tableSort)
      .map((row, index) => ({ ...row, group_position: index + 1 }));
    return { groupCode: code, rows: ordered };
  });
}

function reactionTotal(comment) {
  return Object.values(comment?.reactions || {}).reduce((total, value) => total + Number(value || 0), 0);
}

function latestCompletedMatchday(matches) {
  const completed = matches
    .filter((match) => isCompleted(match) && match.fixture_date)
    .sort((a, b) => (parseDate(b.fixture_date)?.getTime() || 0) - (parseDate(a.fixture_date)?.getTime() || 0));
  const date = completed[0]?.fixture_date;
  return date ? completed.filter((match) => match.fixture_date === date) : [];
}

function nextMatchday(matches) {
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const upcoming = matches
    .filter((match) => !isCompleted(match) && parseDate(match.fixture_date) && parseDate(match.fixture_date).getTime() >= todayUtc)
    .sort((a, b) => parseDate(a.fixture_date) - parseDate(b.fixture_date));
  const date = upcoming[0]?.fixture_date;
  return date ? upcoming.filter((match) => match.fixture_date === date) : [];
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
  const names = shown.map(({ match }) => {
    const winner = Number(match.home_score) > Number(match.away_score) ? teamName(match.home_entry, match.home_placeholder) : teamName(match.away_entry, match.away_placeholder);
    return winner;
  });
  const title = shown.length === 1 ? `${names[0]} lay down a marker` : `${shown.length} clubs lay down a marker`;
  return {
    id: 'roundup-big-wins',
    type: 'roundup',
    tag: 'Matchday round-up',
    title,
    meta: `${formatDate(shown[0].match.fixture_date)} · ${shown.length} emphatic result${shown.length === 1 ? '' : 's'}`,
    story: shown.map(({ match }) => resultLabel(match)).join(' · '),
    note: wins.some(({ match }) => match.status === 'forfeit') ? 'The official scorelines shape the tables, while manager sanctions are recorded separately under Fair Play.' : 'Those margins have already made goal difference part of the qualification picture.',
  };
}

function pressRoomStory(comments, recentResults, nextFixtures) {
  const relevantIds = new Set([...recentResults, ...nextFixtures].map((match) => match.id));
  const quotes = comments
    .filter((comment) => relevantIds.has(comment.match_id))
    .sort((a, b) => Number(Boolean(b.is_pinned || b.editor_pick)) - Number(Boolean(a.is_pinned || a.editor_pick)) || reactionTotal(b) - reactionTotal(a) || String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .slice(0, 3);
  if (!quotes.length) return null;
  return {
    id: 'press-room-roundup',
    type: 'press',
    tag: '🎙️ Press conference round-up',
    title: quotes.length === 1 ? 'One voice cuts through the noise' : `${quotes.length} voices from the press room`,
    meta: quotes.some((quote) => quote.is_pinned || quote.editor_pick) ? 'Featuring headline quotes' : 'Managers, questions and mind games',
    quotes: quotes.map((quote) => ({
      id: quote.id,
      text: quote.comment,
      byline: `${quote.manager_name || 'Anonymous'}${quote.club_name ? ` · ${quote.club_name}` : ''}`,
      reactions: reactionTotal(quote),
    })),
  };
}

function leadersStory(tables) {
  const leaders = tables.map((table) => table.rows[0]).filter((row) => row?.played > 0).sort(tableSort);
  if (!leaders.length) return null;
  const strongest = leaders.slice(0, 4);
  return {
    id: 'group-leaders',
    type: 'leaders',
    tag: '📈 Early group picture',
    title: `${leaders.length} group leader${leaders.length === 1 ? '' : 's'} emerge`,
    meta: 'Sorted by points, goal difference and goals scored',
    story: strongest.map((row) => `${row.team_name} (Group ${row.group_code}, ${row.points} pts, ${row.goal_difference > 0 ? '+' : ''}${row.goal_difference} GD)`).join(' · '),
    note: leaders.length > strongest.length ? `${leaders.length - strongest.length} more group leader${leaders.length - strongest.length === 1 ? '' : 's'} complete the early picture.` : 'The qualification lines will sharpen with every matchday.',
  };
}

function fairPlayStory(recentResults, forfeits) {
  const recentIds = new Set(recentResults.map((match) => match.id));
  const recentForfeits = forfeits.filter((row) => recentIds.has(row.match_id));
  if (!recentForfeits.length) return null;
  return {
    id: 'fair-play-watch',
    type: 'forfeit',
    tag: '⚠️ Fair Play watch',
    title: `${recentForfeits.length} forfeit${recentForfeits.length === 1 ? '' : 's'} recorded`,
    meta: 'Manager discipline and prize-draw consequences',
    story: 'The clubs keep the official forfeited results in their group records. Responsibility stays with the managers involved.',
    note: 'Any manager who forfeits is ineligible for the end-of-season prize draw; three group-stage forfeits also mean exclusion from the knockout draw.',
  };
}

function nextFixturesStory(fixtures, tables) {
  if (!fixtures.length) return null;
  const rowsById = new Map(tables.flatMap((table) => table.rows).map((row) => [row.entry_id, row]));
  const ranked = fixtures.map((match) => {
    const home = rowsById.get(match.home_entry_id);
    const away = rowsById.get(match.away_entry_id);
    const pressure = home && away ? Math.max(0, 6 - Math.abs(home.points - away.points)) + (home.group_position <= 2 && away.group_position <= 2 ? 10 : 0) : 0;
    return { match, pressure };
  }).sort((a, b) => b.pressure - a.pressure).slice(0, 3);
  return {
    id: 'next-matchday',
    type: 'stakes',
    tag: '🔭 Next matchday',
    title: ranked.some((item) => item.pressure >= 10) ? 'Group leads go on the line' : 'The next set of tests',
    meta: `${formatDate(ranked[0].match.fixture_date)} · ${fixtures.length} fixture${fixtures.length === 1 ? '' : 's'}`,
    story: ranked.map(({ match }) => `${teamName(match.home_entry, match.home_placeholder)} v ${teamName(match.away_entry, match.away_placeholder)}${match.stage === 'group' ? ` (Group ${groupCode(match)})` : ''}`).join(' · '),
    note: 'The storylines will update again as soon as the next results are recorded.',
  };
}

function buildEditorialStories(matches, entries, comments, forfeits) {
  const tables = buildTables(entries, matches);
  const recentResults = latestCompletedMatchday(matches);
  const nextFixtures = nextMatchday(matches);
  const stories = [
    bigWinsStory(recentResults),
    pressRoomStory(comments, recentResults, nextFixtures),
    leadersStory(tables),
    fairPlayStory(recentResults, forfeits),
    nextFixturesStory(nextFixtures, tables),
  ].filter(Boolean);
  return stories.slice(0, 4);
}

function EditorialCard({ story }) {
  return <article className={`featured-match-card spotlight-match-card spotlight-${story.type}`}>
    <span>{story.tag}</span>
    <strong>{story.title}</strong>
    {story.meta && <small>{story.meta}</small>}
    {story.story && <p>{story.story}</p>}
    {story.quotes && <div className="editorial-quote-list">{story.quotes.map((quote) => <blockquote key={quote.id}><p>“{quote.text}”</p><small>{quote.byline}{quote.reactions ? ` · ${quote.reactions} reaction${quote.reactions === 1 ? '' : 's'}` : ''}</small></blockquote>)}</div>}
    {story.note && <p className="muted">{story.note}</p>}
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'match_comments', filter: `tournament_id=eq.${tournamentId}` }, loadData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'forfeits' }, loadData)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [tournamentId]);

  async function loadData() {
    const [matchesResult, entriesResult] = await Promise.all([
      supabase.from('matches').select('id, stage, round, fixture_date, status, home_entry_id, away_entry_id, home_score, away_score, bracket, home_placeholder, away_placeholder, groups(code), home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(name), managers(name, display_name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(name), managers(name, display_name))').eq('tournament_id', tournamentId),
      supabase.from('tournament_entries').select('id, seed, group_code, teams(name), managers(name, display_name)').eq('tournament_id', tournamentId),
    ]);
    if (matchesResult.error || entriesResult.error) {
      setStatus(`Could not build storylines: ${matchesResult.error?.message || entriesResult.error?.message}`);
      return;
    }

    const matchRows = matchesResult.data || [];
    const matchIds = matchRows.map((match) => match.id);
    let commentRows = [];
    let forfeitRows = [];
    if (matchIds.length) {
      const [commentsResult, forfeitsResult] = await Promise.all([
        supabase.from('match_comments').select('id, match_id, manager_name, club_name, comment, is_pinned, editor_pick, reactions, created_at').in('match_id', matchIds).eq('status', 'visible'),
        supabase.from('forfeits').select('id, match_id, manager_id, affects_prize_draw').in('match_id', matchIds),
      ]);
      if (!commentsResult.error) commentRows = commentsResult.data || [];
      if (!forfeitsResult.error) forfeitRows = forfeitsResult.data || [];
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
