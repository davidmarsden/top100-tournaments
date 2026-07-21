import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const isCompleted = (match) => match.status === 'played' || match.status === 'forfeit';
const fullTeamName = (entry, fallback = 'TBC') => entry?.teams?.name || fallback;
const managerName = (entry) => entry?.managers?.display_name || entry?.managers?.name || 'Unknown manager';
const groupCode = (match) => match.groups?.code || '—';
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
      seed: entry.seed,
      points: 0,
      played: 0,
      goals_for: 0,
      goals_against: 0,
      goal_difference: 0,
      group_position: null,
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
      if (hs > as) home.points += 3;
      else if (as > hs) away.points += 3;
      else { home.points += 1; away.points += 1; }
    });

    return [...rows.values()]
      .map((row) => ({ ...row, goal_difference: row.goals_for - row.goals_against }))
      .sort(tableSort)
      .map((row, index) => ({ ...row, group_position: index + 1 }));
  });
}

function reactionTotal(comment) {
  return Object.values(comment?.reactions || {}).reduce((total, value) => total + Number(value || 0), 0);
}

function quoteExcerpt(value, maxLength = 112) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  const clipped = text.slice(0, maxLength - 1);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${clipped.slice(0, lastSpace > 70 ? lastSpace : clipped.length).replace(/[.,;:!?-]+$/, '')}…`;
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
  return {
    id: 'roundup-big-wins',
    type: 'roundup',
    tag: 'Matchday round-up',
    title: shown.length === 1 ? 'One club lays down a marker' : `${shown.length} clubs lay down a marker`,
    meta: formatDate(shown[0].match.fixture_date),
    results: shown.map(({ match }) => resultLabel(match)),
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
    tag: '🎙️ From the press room',
    title: quotes.length === 1 ? 'One voice cuts through the noise' : 'Managers have their say',
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

function nextFixturesStory(fixtures, tables) {
  if (!fixtures.length) return null;
  const rowsById = new Map(tables.flat().map((row) => [row.entry_id, row]));
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
    meta: formatDate(ranked[0].match.fixture_date),
    results: ranked.map(({ match }) => `${teamName(match.home_entry, match.home_placeholder)} v ${teamName(match.away_entry, match.away_placeholder)}`),
  };
}

function buildEditorialStories(matches, entries, comments, forfeits) {
  const tables = buildTables(entries, matches);
  const recentResults = latestCompletedMatchday(matches);
  const nextFixtures = nextMatchday(matches);
  return [
    bigWinsStory(recentResults),
    pressRoomStory(comments, recentResults, nextFixtures),
    fairPlayStory(recentResults, forfeits, matches, entries),
    nextFixturesStory(nextFixtures, tables),
  ].filter(Boolean).slice(0, 4);
}

function EditorialCard({ story }) {
  return <article className={`featured-match-card spotlight-match-card editorial-story-card spotlight-${story.type}`}>
    <span>{story.tag}</span>
    <strong className="editorial-story-headline">{story.title}</strong>
    {story.meta && <small>{story.meta}</small>}
    {story.results && <ul className="editorial-result-list">{story.results.map((result) => <li key={result}>{result}</li>)}</ul>}
    {story.quotes && <div className="editorial-quote-list">{story.quotes.map((quote) => <blockquote key={quote.id}><p>“{quote.text}”</p><small>{quote.byline}</small></blockquote>)}</div>}
    {story.forfeits && <ul className="editorial-forfeit-list">{story.forfeits.map((item) => <li key={item.id}><strong>{item.club}</strong><span>{item.manager}</span></li>)}</ul>}
    {story.note && <p className="editorial-story-note">{story.note}</p>}
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
