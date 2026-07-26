const completed = (match) => ['played', 'forfeit'].includes(match.status);
const teamName = (entry, fallback = 'TBC') => entry?.teams?.name || fallback || 'TBC';
const managerName = (entry) => entry?.managers?.display_name || entry?.managers?.name || 'TBC';
const number = (value) => value === null || value === undefined || value === '' ? null : Number(value);

export function slugifyFilename(value) {
  return String(value || 'tournament')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tournament';
}

export function buildTables(entries, matches) {
  const groups = entries.reduce((map, entry) => {
    const code = entry.group_code || 'Ungrouped';
    (map[code] ||= []).push(entry);
    return map;
  }, {});

  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([groupCode, groupEntries]) => {
      const rows = new Map(groupEntries.map((entry) => [String(entry.id), {
        entry_id: entry.id,
        group_code: groupCode,
        seed: number(entry.seed),
        rating: number(entry.rating),
        pot: number(entry.pot),
        team_name: teamName(entry),
        manager_name: managerName(entry),
        played: 0, wins: 0, draws: 0, losses: 0,
        goals_for: 0, goals_against: 0, goal_difference: 0, points: 0,
      }]));

      matches
        .filter((match) => match.stage === 'group' && (match.groups?.code || groupCode) === groupCode && completed(match))
        .forEach((match) => {
          const home = rows.get(String(match.home_entry_id));
          const away = rows.get(String(match.away_entry_id));
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
        .sort((a, b) => b.points - a.points || b.goal_difference - a.goal_difference || b.goals_for - a.goals_for || (a.seed || 9999) - (b.seed || 9999) || a.team_name.localeCompare(b.team_name))
        .map((row, index) => ({ ...row, group_position: index + 1 }));

      return { group_code: groupCode, rows: ordered };
    });
}

export function applyRoundDates(matches, roundDates) {
  const map = new Map((roundDates || []).map((row) => [`${row.bracket || 'Cup'}|${row.round || 'Round'}`, row]));
  return matches.map((match) => {
    if (match.fixture_date || match.stage !== 'knockout') return match;
    const row = map.get(`${match.bracket || 'Cup'}|${match.round || 'Round'}`);
    if (!row) return match;
    const fixtureDate = Number(match.leg || 1) === 2 ? (row.leg2_date || row.leg1_date) : row.leg1_date;
    return fixtureDate ? { ...match, fixture_date: fixtureDate } : match;
  });
}

function historicalManagerName(forfeit) {
  return forfeit?.responsible_manager?.display_name || forfeit?.responsible_manager?.name || null;
}

function normaliseForfeit(row) {
  return {
    id: row.id,
    match_id: row.match_id,
    forfeiting_entry_id: row.forfeiting_entry_id || row.forfeiting_entry?.id || null,
    forfeiting_team: row.forfeiting_entry?.teams?.name || null,
    manager_id: row.manager_id || row.responsible_manager?.id || null,
    responsible_manager: historicalManagerName(row),
    source: row.source || null,
    reason: row.reason || null,
    penalty: row.penalty || null,
    affects_prize_draw: row.affects_prize_draw ?? null,
  };
}

function normaliseComment(row) {
  return {
    id: row.id,
    match_id: row.match_id,
    manager_name: row.manager_name || 'Unknown manager',
    club_name: row.club_name || null,
    comment: String(row.comment || '').trim(),
    comment_type: row.comment_type || 'pre_match',
    contribution_type: row.contribution_type || 'statement',
    prediction_score: row.prediction_score || null,
    player_to_watch: row.player_to_watch || null,
    first_goalscorer: row.first_goalscorer || null,
    is_pinned: Boolean(row.is_pinned),
    editor_pick: Boolean(row.editor_pick),
    reactions: row.reactions || {},
    created_at: row.created_at || null,
  };
}

export function buildSnapshot({ tournament, entries, matches, groups, forfeits, roundDates, honours, comments = [] }) {
  const datedMatches = applyRoundDates(matches, roundDates);
  const tables = buildTables(entries, datedMatches);
  const entryById = new Map(entries.map((entry) => [String(entry.id), entry]));
  const normalisedForfeits = (forfeits || []).map(normaliseForfeit);
  const forfeitByMatch = new Map(normalisedForfeits.map((row) => [String(row.match_id), row]));

  const fixtures = datedMatches.map((match) => {
    const home = match.home_entry || entryById.get(String(match.home_entry_id));
    const away = match.away_entry || entryById.get(String(match.away_entry_id));
    const forfeit = forfeitByMatch.get(String(match.id));
    return {
      match_id: match.id,
      stage: match.stage,
      group: match.groups?.code || null,
      bracket: match.bracket || null,
      round: match.round || null,
      leg: number(match.leg),
      match_order: number(match.match_order),
      fixture_date: match.fixture_date || null,
      home_entry_id: match.home_entry_id,
      home_team: teamName(home, match.home_placeholder),
      home_manager: managerName(home),
      away_entry_id: match.away_entry_id,
      away_team: teamName(away, match.away_placeholder),
      away_manager: managerName(away),
      home_score: number(match.home_score),
      away_score: number(match.away_score),
      home_extra_time_score: number(match.home_extra_time_score),
      away_extra_time_score: number(match.away_extra_time_score),
      home_penalty_score: number(match.home_penalty_score),
      away_penalty_score: number(match.away_penalty_score),
      status: match.status,
      winner_entry_id: match.winner_entry_id || null,
      loser_entry_id: match.loser_entry_id || null,
      decided_by: match.decided_by || null,
      forfeiting_entry_id: forfeit?.forfeiting_entry_id || null,
      forfeiting_team: forfeit?.forfeiting_team || null,
      forfeit_manager_id: forfeit?.manager_id || null,
      forfeit_responsible_manager: forfeit?.responsible_manager || null,
      forfeit_source: forfeit?.source || null,
      forfeit_reason: forfeit?.reason || null,
      affects_prize_draw: forfeit?.affects_prize_draw ?? null,
    };
  });

  return {
    schema_version: 3,
    generated_at: new Date().toISOString(),
    tournament: {
      id: tournament.id,
      name: tournament.name,
      status: tournament.status,
      season_number: tournament.season_number || null,
      game_world: tournament.game_worlds?.name || 'Top 100',
      competition: tournament.competition_types?.name || 'Youth Cup',
      public_slug: tournament.public_slug || tournament.slug || null,
      max_entries: tournament.max_entries || null,
      actual_entries: tournament.actual_entries || entries.length,
      group_count: tournament.group_count || null,
      teams_per_group: tournament.teams_per_group || null,
      knockout_teams: tournament.knockout_teams || null,
      secondary_bracket_name: tournament.secondary_bracket_name || null,
    },
    entrants: entries.map((entry) => ({
      entry_id: entry.id,
      team_id: entry.teams?.id || entry.team_id || null,
      team: teamName(entry),
      manager_id: entry.managers?.id || entry.manager_id || null,
      manager: managerName(entry),
      seed: number(entry.seed),
      rating: number(entry.rating),
      pot: number(entry.pot),
      group: entry.group_code || null,
      prize_draw_eligible: entry.prize_draw_eligible ?? null,
    })),
    groups: (groups || []).map((group) => ({ id: group.id, code: group.code, name: group.name || `Group ${group.code}`, order: group.group_order || null })),
    fixtures,
    results: fixtures.filter((fixture) => ['played', 'forfeit'].includes(fixture.status)),
    tables: tables.flatMap((table) => table.rows),
    round_dates: roundDates || [],
    forfeits: normalisedForfeits,
    honours: honours || [],
    press_conferences: (comments || []).map(normaliseComment).filter((row) => row.comment),
  };
}

export function analyseMatchday(snapshot, round) {
  const selectedRound = round || latestCompletedRound(snapshot.fixtures);
  const matchesToRound = snapshot.fixtures.filter((fixture) => fixture.stage === 'group' && compareRounds(fixture.round, selectedRound) <= 0);
  const completedToRound = matchesToRound.filter((fixture) => ['played', 'forfeit'].includes(fixture.status));
  const tables = buildTablesFromSnapshot(snapshot.entrants, completedToRound);
  const allRows = tables.flatMap((table) => table.rows);
  const seedExpectation = expectedGroupPositions(snapshot.entrants);

  const rows = allRows.map((row) => ({
    ...row,
    expected_position: seedExpectation.get(String(row.entry_id)) || null,
    overachievement: (seedExpectation.get(String(row.entry_id)) || row.group_position) - row.group_position,
  }));

  const perfect = rows.filter((row) => row.played >= 2 && row.wins === row.played).sort((a, b) => b.goal_difference - a.goal_difference || b.goals_for - a.goals_for);
  const overachievers = rows.filter((row) => row.overachievement >= 2).sort((a, b) => b.overachievement - a.overachievement || b.points - a.points);
  const underachievers = rows.filter((row) => row.overachievement <= -2).sort((a, b) => a.overachievement - b.overachievement || a.points - b.points);
  const mountain = rows.filter((row) => row.played >= 2 && (row.points <= 1 || row.goal_difference <= -4)).sort((a, b) => a.points - b.points || a.goal_difference - b.goal_difference);
  const includedMatchIds = new Set(completedToRound.map((fixture) => String(fixture.match_id)));
  const matchById = new Map(completedToRound.map((fixture) => [String(fixture.match_id), fixture]));
  const pressComments = selectPressComments(snapshot.press_conferences || [], includedMatchIds, matchById);

  return { round: selectedRound, matches: completedToRound, tables, rows, perfect, overachievers, underachievers, mountain, pressComments };
}

function selectPressComments(comments, includedMatchIds, matchById) {
  const scored = comments
    .filter((comment) => includedMatchIds.has(String(comment.match_id)) && comment.comment)
    .map((comment) => {
      const reactionScore = Object.values(comment.reactions || {}).reduce((total, value) => total + Number(value || 0), 0);
      const score = (comment.is_pinned ? 100 : 0) + (comment.editor_pick ? 80 : 0) + (comment.comment_type === 'post_match' ? 20 : 0) + reactionScore;
      return { ...comment, match: matchById.get(String(comment.match_id)) || null, editorial_score: score };
    })
    .sort((a, b) => b.editorial_score - a.editorial_score || String(a.created_at || '').localeCompare(String(b.created_at || '')));

  const selected = [];
  const seenManagers = new Set();
  for (const comment of scored) {
    const managerKey = `${comment.manager_name}|${comment.club_name || ''}`.toLowerCase();
    if (seenManagers.has(managerKey) && selected.length < 4) continue;
    selected.push(comment);
    seenManagers.add(managerKey);
    if (selected.length === 6) break;
  }
  return selected;
}

function buildTablesFromSnapshot(entrants, fixtures) {
  const entries = entrants.map((entry) => ({ id: entry.entry_id, seed: entry.seed, rating: entry.rating, pot: entry.pot, group_code: entry.group, teams: { name: entry.team }, managers: { display_name: entry.manager } }));
  const matches = fixtures.map((fixture) => ({ ...fixture, group_code: fixture.group, groups: { code: fixture.group }, home_entry_id: fixture.home_entry_id, away_entry_id: fixture.away_entry_id }));
  return buildTables(entries, matches);
}

function expectedGroupPositions(entrants) {
  const groups = entrants.reduce((map, entrant) => { (map[entrant.group || 'Ungrouped'] ||= []).push(entrant); return map; }, {});
  const result = new Map();
  Object.values(groups).forEach((rows) => [...rows].sort((a, b) => (a.seed || 9999) - (b.seed || 9999)).forEach((row, index) => result.set(String(row.entry_id), index + 1)));
  return result;
}

function roundParts(round) {
  const text = String(round || '').trim();
  const match = text.match(/^MD(\d+)(?:L(\d+))?$/i);
  if (match) return [Number(match[1]), match[2] ? Number(match[2]) : 0, text.toLowerCase()];
  const numberMatch = text.match(/\d+/);
  return [numberMatch ? Number(numberMatch[0]) : 999, 999, text.toLowerCase()];
}

function compareRounds(a, b) {
  const left = roundParts(a);
  const right = roundParts(b);
  return left[0] - right[0] || left[1] - right[1] || left[2].localeCompare(right[2]);
}

export function groupRounds(snapshot) {
  return [...new Set(snapshot.fixtures.filter((fixture) => fixture.stage === 'group').map((fixture) => fixture.round).filter(Boolean))]
    .sort(compareRounds);
}

function latestCompletedRound(fixtures) {
  const rounds = groupRounds({ fixtures });
  return [...rounds].reverse().find((round) => {
    const rows = fixtures.filter((fixture) => fixture.stage === 'group' && fixture.round === round);
    return rows.length && rows.every((fixture) => ['played', 'forfeit'].includes(fixture.status));
  }) || rounds[0] || 'MD1';
}

export function generateMatchdayMarkdown(snapshot, analysis) {
  const titleRound = String(analysis.round || 'Matchday').replace(/^MD/i, 'Matchday ');
  const lines = [
    `# ${snapshot.tournament.name}: ${titleRound} — the group stage takes shape`,
    '',
    `${analysis.matches.length} group-stage results are in up to ${titleRound.toLowerCase()}, and the early shape of the tournament is becoming clearer. The strongest starters are separating themselves from the pack, while several highly seeded teams already have work to do.`,
    '',
    '## Looking unstoppable',
    '',
  ];

  if (analysis.perfect.length) analysis.perfect.slice(0, 8).forEach((row) => lines.push(`- **${row.team_name}** lead Group ${row.group_code} with ${row.points} points from ${row.played} games and a ${signed(row.goal_difference)} goal difference.`));
  else lines.push('No team has yet combined a perfect record with at least two completed matches.');

  lines.push('', '## The surprise packages', '');
  if (analysis.overachievers.length) analysis.overachievers.slice(0, 8).forEach((row) => lines.push(`- **${row.team_name}** were expected to sit around ${ordinal(row.expected_position)} in Group ${row.group_code} based on seedings, but currently occupy ${ordinal(row.group_position)}.`));
  else lines.push('The group tables are broadly following the original seedings so far — though that rarely lasts for long.');

  lines.push('', '## Falling short of expectations', '');
  if (analysis.underachievers.length) analysis.underachievers.slice(0, 8).forEach((row) => lines.push(`- **${row.team_name}** entered Group ${row.group_code} with an expected position of ${ordinal(row.expected_position)}, but currently sit ${ordinal(row.group_position)} with ${row.points} point${row.points === 1 ? '' : 's'}.`));
  else lines.push('None of the leading seeds have fallen dramatically below expectation yet.');

  lines.push('', '## Mountains to climb', '');
  if (analysis.mountain.length) analysis.mountain.slice(0, 10).forEach((row) => lines.push(`- **${row.team_name}** have ${row.points} point${row.points === 1 ? '' : 's'} and a ${signed(row.goal_difference)} goal difference in Group ${row.group_code}.`));
  else lines.push('Nobody is cut adrift yet.');

  if (analysis.pressComments.length) {
    lines.push('', '## From the press room', '');
    analysis.pressComments.forEach((comment) => {
      const fixture = comment.match ? `${comment.match.home_team} v ${comment.match.away_team}` : 'the group stage';
      const isPostMatch = comment.comment_type === 'post_match';
      const timing = isPostMatch ? 'post-match' : 'pre-match';
      const relation = isPostMatch ? 'after' : 'before';
      const attribution = comment.club_name ? `${comment.manager_name}, ${comment.club_name}` : comment.manager_name;
      lines.push(`> “${cleanQuote(comment.comment)}”`, '', `— **${attribution}**, ${timing} ${relation} ${fixture}`, '');
    });
  }

  lines.push('## What to watch next', '', 'The next matchday should tell us whether the surprise leaders can maintain their momentum, whether the strongest seeds can reassert themselves, and which struggling sides can keep their qualification hopes alive.', '', `[View every group table, fixture and result on the Top 100 Tournament Hub](https://youth-cup.smtop100.blog/#groups)`);
  return lines.join('\n');
}

export function csvFiles(snapshot) {
  return {
    'entrants.csv': toCsv(snapshot.entrants),
    'groups.csv': toCsv(snapshot.groups),
    'fixtures.csv': toCsv(snapshot.fixtures),
    'results.csv': toCsv(snapshot.results),
    'tables.csv': toCsv(snapshot.tables),
    'round-dates.csv': toCsv(snapshot.round_dates),
    'forfeits.csv': toCsv(snapshot.forfeits),
    'press-conferences.csv': toCsv(snapshot.press_conferences),
    'honours.csv': toCsv(snapshot.honours.map((row) => ({ id: row.id, honour: row.honour, position: row.position, tournament_id: row.tournament_id, team: row.entry?.teams?.name || null, manager: row.entry?.managers?.display_name || row.entry?.managers?.name || null }))),
  };
}

export function toCsv(rows) {
  if (!rows.length) return '';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const cell = (value) => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(','), ...rows.map((row) => headers.map((header) => cell(row[header])).join(','))].join('\n');
}

export function downloadText(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const cleanQuote = (value) => String(value || '').replace(/\s+/g, ' ').replace(/[“”]/g, '"').trim();
const signed = (value) => Number(value) > 0 ? `+${value}` : String(value);
const ordinal = (value) => value === 1 ? '1st' : value === 2 ? '2nd' : value === 3 ? '3rd' : `${value}th`;