// Ranking clubs from different groups (best third-placed qualifiers, "best placed" tables).
// When the groups differ in size (e.g. 59 clubs: 14 groups of 4 and one of 3), clubs in the
// smaller group play fewer games, so compare per game: points, then goal difference, then
// goals scored per game played, then seed. Equal-sized groups keep the usual comparison.

export function groupsAreUneven(tables = []) {
  return new Set(tables.map((table) => (table.rows || []).length)).size > 1;
}

const perGame = (row, key) => (Number(row.played) > 0 ? Number(row[key] || 0) / Number(row.played) : 0);

export function comparePerGame(a, b) {
  return perGame(b, 'points') - perGame(a, 'points')
    || perGame(b, 'goal_difference') - perGame(a, 'goal_difference')
    || perGame(b, 'goals_for') - perGame(a, 'goals_for')
    || Number(a.seed || 999) - Number(b.seed || 999)
    || String(a.team_name || '').localeCompare(String(b.team_name || ''));
}

export function crossGroupCompare(tables, baseCompare) {
  return groupsAreUneven(tables) ? comparePerGame : baseCompare;
}

export const pointsPerGame = (row) => (Number(row.played) > 0 ? (Number(row.points || 0) / Number(row.played)).toFixed(2) : '–');
