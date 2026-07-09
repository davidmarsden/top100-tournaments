export function slugify(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function seasonNumberFromCode(value = '') {
  const match = String(value || '').match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

export function seasonSlugFromCode(value = '') {
  const number = seasonNumberFromCode(value);
  return number ? `s${number}` : slugify(value);
}

export function publicTournamentPath(tournament) {
  const world = tournament?.game_worlds?.slug || tournament?.game_world_slug || 'top-100';
  const competition = tournament?.competition_types?.slug || tournament?.competition_slug || 'youth-cup';
  const season = tournament?.public_slug || (tournament?.season_number ? `s${tournament.season_number}` : tournament?.slug);
  return `/${world}/${competition}${season ? `/${season}` : ''}`;
}

export function liveTournamentPath(tournament) {
  const world = tournament?.game_worlds?.slug || tournament?.game_world_slug || 'top-100';
  const competition = tournament?.competition_types?.slug || tournament?.competition_slug || 'youth-cup';
  return `/${world}/${competition}`;
}
