const GROUP_CODES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export function normaliseText(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function slugify(value) {
  return normaliseText(value)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function sortEntriesForSeeding(entries = []) {
  return [...entries].sort((a, b) => {
    const seedA = Number(a.seed ?? Number.MAX_SAFE_INTEGER);
    const seedB = Number(b.seed ?? Number.MAX_SAFE_INTEGER);
    if (seedA !== seedB) return seedA - seedB;

    const ratingA = Number(a.rating ?? 0);
    const ratingB = Number(b.rating ?? 0);
    if (ratingA !== ratingB) return ratingB - ratingA;

    return normaliseText(a.team_name || a.team?.name).localeCompare(
      normaliseText(b.team_name || b.team?.name)
    );
  });
}

export function calculateFormat(entryCount, options = {}) {
  const teamsPerGroup = Number(options.teamsPerGroup || 4);
  const requestedGroups = Number(options.groupCount || 0);
  const groupCount = requestedGroups || Math.ceil(entryCount / teamsPerGroup);
  const knockoutTeams = Number(options.knockoutTeams || nearestLowerPowerOfTwo(entryCount / 2));

  return {
    entryCount,
    groupCount,
    teamsPerGroup,
    knockoutTeams,
    hasSecondaryBracket: Boolean(options.secondaryBracketName),
    secondaryBracketName: options.secondaryBracketName || null,
  };
}

export function createSeedPots(entries = [], options = {}) {
  const sorted = sortEntriesForSeeding(entries);
  const groupCount = Number(options.groupCount || Math.ceil(sorted.length / 4));
  const pots = [];

  for (let index = 0; index < sorted.length; index += groupCount) {
    const potNumber = Math.floor(index / groupCount) + 1;
    pots.push(
      sorted.slice(index, index + groupCount).map((entry, potIndex) => ({
        ...entry,
        pot: entry.pot ?? potNumber,
        seed: entry.seed ?? index + potIndex + 1,
      }))
    );
  }

  return pots;
}

export function generateSeededGroups(entries = [], options = {}) {
  const groupCount = Number(options.groupCount || Math.ceil(entries.length / 4));
  const groupCodes = options.groupCodes || GROUP_CODES.slice(0, groupCount);
  const pots = createSeedPots(entries, { groupCount });

  const groups = groupCodes.map((code, index) => ({
    code,
    group_order: index + 1,
    entries: [],
  }));

  pots.forEach((pot, potIndex) => {
    const orderedPot = potIndex % 2 === 0 ? pot : [...pot].reverse();

    orderedPot.forEach((entry, index) => {
      const targetGroup = groups[index % groupCount];
      targetGroup.entries.push({
        ...entry,
        group_code: targetGroup.code,
        pot: entry.pot ?? potIndex + 1,
      });
    });
  });

  return groups;
}

export function generateGroupFixtures(groups = [], options = {}) {
  const legs = Number(options.legs || 2);
  const startOrder = Number(options.startOrder || 1);
  const fixtures = [];
  let matchOrder = startOrder;

  groups.forEach((group) => {
    const entries = group.entries || [];
    const pairings = roundRobinPairings(entries);

    pairings.forEach((roundPairings, roundIndex) => {
      for (let leg = 1; leg <= legs; leg += 1) {
        roundPairings.forEach(([home, away]) => {
          const reverse = leg % 2 === 0;
          fixtures.push({
            group_code: group.code,
            stage: 'group',
            round: `MD${roundIndex + 1}${legs > 1 ? `L${leg}` : ''}`,
            leg,
            match_order: matchOrder,
            home_entry_id: reverse ? away.id : home.id,
            away_entry_id: reverse ? home.id : away.id,
            home_placeholder: reverse ? entryLabel(away) : entryLabel(home),
            away_placeholder: reverse ? entryLabel(home) : entryLabel(away),
            status: 'scheduled',
          });
          matchOrder += 1;
        });
      }
    });
  });

  return fixtures;
}

export function roundRobinPairings(entries = []) {
  const teams = [...entries];
  if (teams.length % 2 === 1) teams.push({ id: null, bye: true, team_name: 'BYE' });

  const rounds = [];
  const roundsCount = teams.length - 1;
  const half = teams.length / 2;
  let rotating = [...teams];

  for (let round = 0; round < roundsCount; round += 1) {
    const pairings = [];

    for (let index = 0; index < half; index += 1) {
      const home = rotating[index];
      const away = rotating[rotating.length - 1 - index];
      if (!home.bye && !away.bye) {
        pairings.push(round % 2 === 0 ? [home, away] : [away, home]);
      }
    }

    rounds.push(pairings);
    rotating = [rotating[0], rotating[rotating.length - 1], ...rotating.slice(1, -1)];
  }

  return rounds;
}

export function calculateGroupTable(entries = [], matches = []) {
  const table = new Map();

  entries.forEach((entry) => {
    table.set(entry.id, emptyTableRow(entry));
  });

  matches
    .filter((match) => match.status === 'played' || match.status === 'forfeit')
    .forEach((match) => {
      const home = table.get(match.home_entry_id);
      const away = table.get(match.away_entry_id);
      if (!home || !away) return;

      const homeScore = Number(match.home_score || 0);
      const awayScore = Number(match.away_score || 0);

      home.played += 1;
      away.played += 1;
      home.goals_for += homeScore;
      home.goals_against += awayScore;
      away.goals_for += awayScore;
      away.goals_against += homeScore;

      if (homeScore > awayScore) {
        home.wins += 1;
        away.losses += 1;
        home.points += 3;
      } else if (awayScore > homeScore) {
        away.wins += 1;
        home.losses += 1;
        away.points += 3;
      } else {
        home.draws += 1;
        away.draws += 1;
        home.points += 1;
        away.points += 1;
      }
    });

  return [...table.values()]
    .map((row) => ({
      ...row,
      goal_difference: row.goals_for - row.goals_against,
    }))
    .sort(compareTableRows)
    .map((row, index) => ({ ...row, position: index + 1 }));
}

export function generateGroupTables(groups = [], matches = []) {
  return groups.map((group) => ({
    code: group.code,
    rows: calculateGroupTable(
      group.entries || [],
      matches.filter((match) => match.group_code === group.code)
    ),
  }));
}

export function selectKnockoutQualifiers(groupTables = [], options = {}) {
  const perGroup = Number(options.perGroup || 2);
  const maxTeams = Number(options.maxTeams || groupTables.length * perGroup);

  const automatic = groupTables.flatMap((group) =>
    group.rows.slice(0, perGroup).map((row) => ({ ...row, group_code: group.code }))
  );

  return automatic.slice(0, maxTeams);
}

export function generateKnockoutMatches(qualifiers = [], options = {}) {
  const bracket = options.bracket || 'Cup';
  const roundName = options.roundName || roundNameForSize(qualifiers.length);
  const ordered = [...qualifiers].sort((a, b) => {
    const seedA = Number(a.seed ?? a.position ?? Number.MAX_SAFE_INTEGER);
    const seedB = Number(b.seed ?? b.position ?? Number.MAX_SAFE_INTEGER);
    return seedA - seedB;
  });

  const matches = [];
  const size = ordered.length;

  for (let index = 0; index < Math.floor(size / 2); index += 1) {
    const home = ordered[index];
    const away = ordered[size - 1 - index];
    matches.push({
      bracket,
      stage: bracket.toLowerCase(),
      round: roundName,
      match_order: index + 1,
      home_entry_id: home.entry_id || home.id,
      away_entry_id: away.entry_id || away.id,
      home_seed: home.seed || index + 1,
      away_seed: away.seed || size - index,
      home_placeholder: entryLabel(home),
      away_placeholder: entryLabel(away),
      status: 'scheduled',
    });
  }

  return matches;
}

export function applyResult(match, result) {
  const homeScore = Number(result.home_score);
  const awayScore = Number(result.away_score);
  const decidedBy = result.decided_by || 'normal_time';
  let winner = null;
  let loser = null;

  if (homeScore > awayScore) {
    winner = match.home_entry_id;
    loser = match.away_entry_id;
  } else if (awayScore > homeScore) {
    winner = match.away_entry_id;
    loser = match.home_entry_id;
  } else if (result.winner_entry_id) {
    winner = result.winner_entry_id;
    loser = winner === match.home_entry_id ? match.away_entry_id : match.home_entry_id;
  }

  return {
    ...match,
    home_score: homeScore,
    away_score: awayScore,
    winner_entry_id: winner,
    loser_entry_id: loser,
    decided_by: decidedBy,
    status: result.status || 'played',
    played_at: result.played_at || new Date().toISOString(),
  };
}

export function buildPublicSlug(tournament) {
  return slugify(tournament?.name || `${tournament?.season_code || ''} ${tournament?.competition_name || ''}`);
}

function emptyTableRow(entry) {
  return {
    entry_id: entry.id,
    id: entry.id,
    seed: entry.seed,
    team_name: entry.team_name || entry.team?.name || entry.home_placeholder,
    manager_name: entry.manager_name || entry.manager?.name,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points: 0,
  };
}

function compareTableRows(a, b) {
  if (b.points !== a.points) return b.points - a.points;
  if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
  if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
  return normaliseText(a.team_name).localeCompare(normaliseText(b.team_name));
}

function roundNameForSize(size) {
  if (size >= 64) return 'R64';
  if (size >= 32) return 'R32';
  if (size >= 16) return 'R16';
  if (size >= 8) return 'QF';
  if (size >= 4) return 'SF';
  return 'Final';
}

function nearestLowerPowerOfTwo(value) {
  let power = 1;
  while (power * 2 <= value) power *= 2;
  return power;
}

function entryLabel(entry) {
  return entry.team_name || entry.team?.name || entry.name || entry.home_placeholder || 'TBC';
}
