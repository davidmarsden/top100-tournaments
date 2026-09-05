import { hasSupabaseConfig, supabase } from './lib/supabaseClient';

const normalise = (value) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const formatDate = (dateString) => {
  if (!dateString) return '';
  const [year, month, day] = String(dateString).slice(0, 10).split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
};

const roundDateKey = (bracket, round) => `${bracket || 'Cup'}|${round || 'Round'}`;

function renderedCardKey(card) {
  const teams = [...card.querySelectorAll('.fixture-teams > strong')]
    .map((node) => normalise(node.textContent));
  const date = normalise(card.querySelector('.public-fixture-date')?.textContent);
  return teams.length === 2 ? `${date}|${teams[0]}|${teams[1]}` : '';
}

function matchRenderKey(match) {
  const homeName = match.home_entry?.teams?.name || '';
  const awayName = match.away_entry?.teams?.name || '';
  return `${normalise(formatDate(match.rendered_fixture_date))}|${normalise(homeName)}|${normalise(awayName)}`;
}

function restoreScore(score) {
  const original = score.dataset.originalScore;
  if (original !== undefined && score.querySelector('.forfeit-score-layout')) {
    score.textContent = original;
  }
}

function removeTeamPills(card) {
  card.querySelectorAll('.forfeit-team-pill').forEach((pill) => pill.remove());
}

function addBadge(card, forfeit) {
  const score = card.querySelector('.fixture-score');
  if (!score || !forfeit) return;

  const rawScore = score.dataset.originalScore || score.textContent.trim();
  const scoreMatch = rawScore.match(/^\s*(-?\d+)\s*-\s*(-?\d+)\s*$/);
  if (!scoreMatch) return;

  score.dataset.originalScore = rawScore;
  score.textContent = '';

  const layout = document.createElement('span');
  layout.className = 'forfeit-score-layout';

  const home = document.createElement('span');
  home.className = 'forfeit-score-side forfeit-score-home';
  home.textContent = scoreMatch[1];

  const separator = document.createElement('span');
  separator.className = 'forfeit-score-separator';
  separator.textContent = '–';

  const away = document.createElement('span');
  away.className = 'forfeit-score-side forfeit-score-away';
  away.textContent = scoreMatch[2];

  const pill = document.createElement('span');
  pill.className = 'forfeit-result-pill';
  pill.textContent = 'F';
  pill.title = `Forfeit by ${forfeit.team}`;
  pill.setAttribute('aria-label', `Forfeit by ${forfeit.team}`);

  if (forfeit.side === 'home') {
    home.appendChild(pill);
  } else {
    away.appendChild(pill);
  }

  layout.append(home, separator, away);
  score.appendChild(layout);
}

function addDoubleForfeitBadges(card, forfeits) {
  const teams = [...card.querySelectorAll('.fixture-teams > strong')];
  if (teams.length !== 2) return;

  const bySide = new Map(forfeits.map((forfeit) => [forfeit.side, forfeit]));
  [['home', teams[0]], ['away', teams[1]]].forEach(([side, teamNode]) => {
    const forfeit = bySide.get(side);
    if (!forfeit) return;

    const pill = document.createElement('span');
    pill.className = 'forfeit-result-pill forfeit-team-pill';
    pill.textContent = 'F';
    pill.title = `Forfeit by ${forfeit.team}`;
    pill.setAttribute('aria-label', `Forfeit by ${forfeit.team}`);
    teamNode.appendChild(pill);
  });

  const note = [...card.querySelectorAll('p.muted')]
    .find((node) => node.textContent.trim().toLowerCase().startsWith('double forfeit'));
  if (note) note.textContent = 'Double forfeit - both teams disqualified';
}

async function resolveDisplayedTournamentId() {
  const heroName = document.querySelector('.tournament-hub .tournament-hero h1')?.textContent?.trim();
  const pathSlug = decodeURIComponent(window.location.pathname.split('/').filter(Boolean).pop() || '');

  const result = await supabase
    .from('tournaments')
    .select('id, name, public_slug, slug, is_public');

  if (result.error) return null;
  const rows = result.data || [];

  const slugMatch = pathSlug
    ? rows.find((row) => row.public_slug === pathSlug || row.slug === pathSlug)
    : null;
  if (slugMatch) return slugMatch.id;

  const nameMatches = rows.filter((row) => row.name === heroName);
  return (nameMatches.find((row) => row.is_public) || nameMatches[0])?.id || null;
}

async function loadForfeitMatches() {
  if (!hasSupabaseConfig || !supabase) return null;

  const tournamentId = await resolveDisplayedTournamentId();
  if (!tournamentId) return null;

  const [matchesResult, roundDatesResult] = await Promise.all([
    supabase
      .from('matches')
      .select('id, stage, round, bracket, leg, fixture_date, home_entry_id, away_entry_id, home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(name))')
      .eq('tournament_id', tournamentId),
    supabase
      .from('tournament_round_dates')
      .select('bracket, round, leg1_date, leg2_date')
      .eq('tournament_id', tournamentId),
  ]);

  if (matchesResult.error) return { tournamentId, matches: [], forfeitsByMatch: new Map() };

  const roundDates = new Map((roundDatesResult.data || []).map((row) => [
    roundDateKey(row.bracket, row.round),
    row,
  ]));

  const matches = (matchesResult.data || []).map((match) => {
    let renderedFixtureDate = match.fixture_date;
    if (!renderedFixtureDate && match.stage === 'knockout') {
      const row = roundDates.get(roundDateKey(match.bracket, match.round));
      renderedFixtureDate = Number(match.leg || 1) === 2
        ? (row?.leg2_date || row?.leg1_date)
        : row?.leg1_date;
    }
    return { ...match, rendered_fixture_date: renderedFixtureDate || null };
  });

  const matchIds = matches.map((match) => match.id).filter(Boolean);
  if (!matchIds.length) return { tournamentId, matches, forfeitsByMatch: new Map() };

  const forfeitsResult = await supabase
    .from('forfeits')
    .select('match_id, forfeiting_entry_id')
    .in('match_id', matchIds);

  const matchById = new Map(matches.map((match) => [String(match.id), match]));
  const forfeitsByMatch = new Map();

  if (!forfeitsResult.error) {
    (forfeitsResult.data || []).forEach((row) => {
      const match = matchById.get(String(row.match_id));
      if (!match || row.forfeiting_entry_id === null || row.forfeiting_entry_id === undefined) return;

      const forfeitingId = String(row.forfeiting_entry_id);
      let forfeit = null;
      if (forfeitingId === String(match.home_entry_id)) {
        forfeit = { side: 'home', team: match.home_entry?.teams?.name || '' };
      } else if (forfeitingId === String(match.away_entry_id)) {
        forfeit = { side: 'away', team: match.away_entry?.teams?.name || '' };
      }

      if (!forfeit?.team) return;
      const key = String(match.id);
      const existing = forfeitsByMatch.get(key) || [];
      if (!existing.some((item) => item.side === forfeit.side)) existing.push(forfeit);
      forfeitsByMatch.set(key, existing);
    });
  }

  return { tournamentId, matches, forfeitsByMatch };
}

let cachedPayload = null;
let cachedHeroName = '';
let applying = false;
let observer = null;

async function applyForfeitBadges() {
  const hub = document.querySelector('.tournament-hub');
  if (applying || !hub) return;

  applying = true;
  observer?.disconnect();

  try {
    const heroName = hub.querySelector('.tournament-hero h1')?.textContent?.trim() || '';
    if (!cachedPayload || cachedHeroName !== heroName) {
      cachedPayload = await loadForfeitMatches();
      cachedHeroName = heroName;
    }
    if (!cachedPayload) return;

    const matchesByRenderKey = new Map();
    cachedPayload.matches.forEach((match) => {
      const key = matchRenderKey(match);
      if (!key) return;
      if (!matchesByRenderKey.has(key)) matchesByRenderKey.set(key, []);
      matchesByRenderKey.get(key).push(String(match.id));
    });

    hub.querySelectorAll('.fixture-card').forEach((card) => {
      const score = card.querySelector('.fixture-score');
      if (score) restoreScore(score);
      removeTeamPills(card);
      card.removeAttribute('data-match-id');

      const candidates = matchesByRenderKey.get(renderedCardKey(card));
      const matchId = candidates?.shift();
      if (!matchId) return;

      card.dataset.matchId = matchId;
      const forfeits = cachedPayload.forfeitsByMatch.get(matchId) || [];
      if (forfeits.length >= 2) addDoubleForfeitBadges(card, forfeits);
      else if (forfeits.length === 1) addBadge(card, forfeits[0]);
    });
  } finally {
    applying = false;
    observer?.observe(document.documentElement, { childList: true, subtree: true });
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', applyForfeitBadges, { once: true });
  observer = new MutationObserver(() => window.requestAnimationFrame(applyForfeitBadges));
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
