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

function cardKey(card) {
  const teams = [...card.querySelectorAll('.fixture-teams > strong')].map((node) => normalise(node.textContent));
  const date = normalise(card.querySelector('.public-fixture-date')?.textContent);
  return teams.length === 2 ? `${date}|${teams[0]}|${teams[1]}` : '';
}

function addBadge(card, forfeitingTeam) {
  const score = card.querySelector('.fixture-score');
  if (!score || score.querySelector('.forfeit-result-pill')) return;

  const pill = document.createElement('span');
  pill.className = 'forfeit-result-pill';
  pill.textContent = 'F';
  pill.title = `Forfeit by ${forfeitingTeam}`;
  pill.setAttribute('aria-label', `Forfeit by ${forfeitingTeam}`);
  score.appendChild(pill);
}

async function loadForfeitMatches() {
  if (!hasSupabaseConfig || !supabase) return [];

  const forfeitsResult = await supabase
    .from('forfeits')
    .select('match_id, forfeiting_entry_id');

  if (forfeitsResult.error || !forfeitsResult.data?.length) return [];

  const forfeits = forfeitsResult.data;
  const matchIds = [...new Set(forfeits.map((row) => row.match_id).filter(Boolean))];
  if (!matchIds.length) return [];

  const matchesResult = await supabase
    .from('matches')
    .select('id, fixture_date, home_entry_id, away_entry_id, home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(name))')
    .in('id', matchIds);

  if (matchesResult.error) return [];

  const forfeitByMatch = new Map(forfeits.map((row) => [String(row.match_id), row.forfeiting_entry_id]));
  return (matchesResult.data || []).map((match) => {
    const forfeitingEntryId = forfeitByMatch.get(String(match.id));
    const homeName = match.home_entry?.teams?.name || '';
    const awayName = match.away_entry?.teams?.name || '';
    const forfeitingTeam = String(forfeitingEntryId) === String(match.home_entry_id) ? homeName : awayName;
    return {
      key: `${normalise(formatDate(match.fixture_date))}|${normalise(homeName)}|${normalise(awayName)}`,
      forfeitingTeam,
    };
  }).filter((row) => row.key && row.forfeitingTeam);
}

let cachedRows = null;
let applying = false;

async function applyForfeitBadges() {
  if (applying || !document.querySelector('.tournament-hub')) return;
  applying = true;
  try {
    cachedRows ||= await loadForfeitMatches();
    if (!cachedRows.length) return;
    const lookup = new Map(cachedRows.map((row) => [row.key, row.forfeitingTeam]));
    document.querySelectorAll('.tournament-hub .fixture-card').forEach((card) => {
      const forfeitingTeam = lookup.get(cardKey(card));
      if (forfeitingTeam) addBadge(card, forfeitingTeam);
    });
  } finally {
    applying = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', applyForfeitBadges, { once: true });
  const observer = new MutationObserver(() => window.requestAnimationFrame(applyForfeitBadges));
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
