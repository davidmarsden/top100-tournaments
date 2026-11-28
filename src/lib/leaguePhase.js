// World Club Cup league phase: one table of every club, Champions League style.
//
// Draw rules (default: 5 pots of 20, one pot per Division, 6 matchdays):
// - every club plays one club from each other pot and two from its own pot;
// - every club has 3 home and 3 away matches;
// - every club plays exactly once on each matchday;
// - no pairing repeats.
// The draw is a pure function of the pots and a seed string, so anyone can
// re-run it from the published seed and get the same fixtures.

export const LEAGUE_STAGE = 'league';
export const LEAGUE_BRACKET = 'League Stage';

export const DEFAULT_SPLIT = [
  { key: 'cup_r16', label: 'World Club Cup last 16', from: 1, to: 8 },
  { key: 'playoff', label: 'Knockout play-off', from: 9, to: 24 },
  { key: 'shield', label: 'Shield last 32', from: 25, to: 56 },
  { key: 'out', label: 'Eliminated', from: 57, to: Infinity },
];

// --- Seeded randomness -----------------------------------------------------

function hashSeed(text) {
  // cyrb53: a small, well-mixed string hash (deterministic in every JS engine).
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) * 4294967296 + (h1 >>> 0);
}

export function seededRandom(seed) {
  // mulberry32 seeded from the string hash.
  let state = hashSeed(String(seed)) >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, random) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// --- Pots ------------------------------------------------------------------

// Build pots from entries carrying a `pot` (1..n) or `division`. Within a pot,
// entries keep the order given (used only for display; the draw shuffles).
export function buildPots(entries = [], { potCount = 5, allowShortPot = false } = {}) {
  const pots = Array.from({ length: potCount }, () => []);
  for (const entry of entries) {
    const pot = Number(entry.pot ?? entry.division);
    if (!Number.isInteger(pot) || pot < 1 || pot > potCount) {
      throw new Error(`${entry.name || entry.id} has no pot between 1 and ${potCount}.`);
    }
    pots[pot - 1].push(entry);
  }
  const size = Math.max(...pots.map((pot) => pot.length));
  const short = pots.filter((pot) => pot.length !== size);
  const oneShort = allowShortPot && short.length === 1 && short[0].length === size - 1;
  if (short.length && !oneShort) {
    throw new Error(`Every pot needs the same number of clubs (now ${pots.map((pot) => pot.length).join(', ')}).`);
  }
  if (size < 4 || size % 2 !== 0) throw new Error('Each pot needs an even number of clubs, at least 4.');
  return pots;
}

// --- The draw --------------------------------------------------------------

// Round-robin schedule for the pots themselves (K5 for 5 pots). With an odd
// number of pots each pot sits out one "pot round"; in that round its clubs
// play one of their two own-pot matches. The last matchday is the other
// own-pot match for everyone. Pot-level home/away comes from a balanced
// orientation (each pot hosts half the other pots), which gives every club
// 2 home and 2 away cross-pot matches.
function potRounds(potCount) {
  if (potCount % 2 === 0) throw new Error('This draw supports an odd number of pots (5 by default).');
  const rounds = [];
  for (let r = 0; r < potCount; r += 1) {
    const pairs = [];
    for (let k = 1; k <= (potCount - 1) / 2; k += 1) {
      const a = (r + k) % potCount;
      const b = (r - k + potCount) % potCount;
      pairs.push([a, b]);
    }
    rounds.push({ resting: r, pairs });
  }
  return rounds;
}

// Balanced orientation for an odd complete graph: pot a hosts pot b when
// (b - a) mod n is in 1..(n-1)/2.
function potHosts(a, b, potCount) {
  const diff = (b - a + potCount) % potCount;
  return diff >= 1 && diff <= (potCount - 1) / 2;
}

export function drawLeaguePhase(entries = [], { seed, potCount = 5 } = {}) {
  if (!seed) throw new Error('A draw seed is required, so the draw can be checked later.');
  const random = seededRandom(seed);
  const pots = buildPots(entries, { potCount });
  // Random relabelling of which pot hosts which, so it isn't always Division 1 at home to Division 2.
  const potOrder = shuffle(pots.map((_, index) => index), random);
  const position = new Map(potOrder.map((pot, index) => [pot, index]));
  const shuffledPots = pots.map((pot) => shuffle(pot, random));
  const size = shuffledPots[0].length;

  const fixtures = [];
  const add = (matchday, home, away, kind) => fixtures.push({ matchday, home, away, kind });

  // Cross-pot matchings: for each pot pair a random perfect matching.
  const crossMatchings = new Map();
  for (let a = 0; a < potCount; a += 1) {
    for (let b = a + 1; b < potCount; b += 1) {
      crossMatchings.set(`${a}-${b}`, shuffle([...Array(size).keys()], random));
    }
  }

  // Own-pot: a random Hamiltonian cycle (even length), split into two
  // perfect matchings; the cycle direction gives each club 1 home, 1 away.
  const ownMatchings = shuffledPots.map((pot) => {
    const cycle = shuffle(pot, random);
    const first = [];
    const second = [];
    for (let i = 0; i < cycle.length; i += 1) {
      const home = cycle[i];
      const away = cycle[(i + 1) % cycle.length];
      (i % 2 === 0 ? first : second).push([home, away]);
    }
    return [first, second];
  });

  const rounds = potRounds(potCount);
  const matchdayOrder = shuffle([...Array(potCount + 1).keys()], random).map((value) => value + 1);

  rounds.forEach((round, roundIndex) => {
    const matchday = matchdayOrder[roundIndex];
    for (const [pa, pb] of round.pairs) {
      const a = potOrder[pa];
      const b = potOrder[pb];
      const [lo, hi] = a < b ? [a, b] : [b, a];
      const matching = crossMatchings.get(`${lo}-${hi}`);
      const loHosts = potHosts(position.get(lo), position.get(hi), potCount);
      for (let i = 0; i < size; i += 1) {
        const loClub = shuffledPots[lo][i];
        const hiClub = shuffledPots[hi][matching[i]];
        if (loHosts) add(matchday, loClub, hiClub, 'cross');
        else add(matchday, hiClub, loClub, 'cross');
      }
    }
    const resting = potOrder[round.resting];
    for (const [home, away] of ownMatchings[resting][0]) add(matchday, home, away, 'own');
  });

  const lastMatchday = matchdayOrder[potCount];
  ownMatchings.forEach((matchings) => {
    for (const [home, away] of matchings[1]) add(lastMatchday, home, away, 'own');
  });

  fixtures.sort((x, y) => x.matchday - y.matchday);
  return { seed: String(seed), pots: shuffledPots.map((pot) => pot.map((entry) => entry.id)), fixtures };
}

// --- Any field: equal pots, or one club short --------------------------------
//
// Equal pots (e.g. 60 = 5 x 12) use drawLeaguePhase unchanged: 6 matchdays.
// A field one club short of equal pots (59 = 12+12+12+12+11) is drawn with a
// placeholder "rest week" club in the short pot. Its six opponents each get a
// rest week instead (one per matchday), and meet each other in three make-up
// matches on an extra matchday (7). So every club still plays six matches,
// three at home and three away, and rests on exactly one matchday: the six on
// their rest week, everyone else on matchday 7.
// Make-up pairs: a club that lost a home match hosts one that lost an away
// match, never a repeat. The two own-pot neighbours of the rest-week club stay
// together (same pot, never yet met), so pot balance changes only for the
// clubs from the other pots, who are listed in potExceptions.
export const REST_WEEK_ID = '__rest_week__';

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

export function drawLeagueField(entries = [], { seed, potCount = 5 } = {}) {
  if (!seed) throw new Error('A draw seed is required, so the draw can be checked later.');
  const pots = buildPots(entries, { potCount, allowShortPot: true });
  const size = Math.max(...pots.map((pot) => pot.length));
  const shortIndex = pots.findIndex((pot) => pot.length < size);
  if (shortIndex < 0) {
    const draw = drawLeaguePhase(entries, { seed, potCount });
    return { ...draw, matchdays: potCount + 1, makeUp: [], restWeeks: [], potExceptions: [] };
  }
  const restPot = shortIndex + 1;
  const ghost = { id: REST_WEEK_ID, name: 'Rest week', pot: restPot };
  const potOf = new Map(entries.map((entry) => [entry.id, Number(entry.pot ?? entry.division)]));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const draw = drawLeaguePhase([...entries, ghost], { seed: attempt ? `${seed}#${attempt}` : String(seed), potCount });
    const isGhost = (f) => f.home.id === REST_WEEK_ID || f.away.id === REST_WEEK_ID;
    const restWeeks = draw.fixtures.filter(isGhost).map((f) => {
      const ghostHome = f.home.id === REST_WEEK_ID;
      return { club: ghostHome ? f.away : f.home, matchday: f.matchday, lost: ghostHome ? 'away' : 'home', kind: f.kind };
    });
    const met = new Set(draw.fixtures.filter((f) => !isGhost(f)).map((f) => [f.home.id, f.away.id].sort().join('|')));
    const hosts = restWeeks.filter((r) => r.lost === 'home');
    const guests = restWeeks.filter((r) => r.lost === 'away');
    let best = null;
    for (const order of permutations(guests)) {
      const pairs = hosts.map((host, index) => [host, order[index]]);
      if (pairs.some(([a, b]) => met.has([a.club.id, b.club.id].sort().join('|')))) continue;
      // Keep the own-pot neighbours together; otherwise pair the closest pots.
      const cost = pairs.reduce((sum, [a, b]) => sum + Math.abs((potOf.get(a.club.id) || 0) - (potOf.get(b.club.id) || 0)) + (a.kind !== b.kind ? 10 : 0), 0);
      if (!best || cost < best.cost) best = { pairs, cost };
    }
    // Prefer a draw where the own-pot neighbours stay together (fewer pot exceptions);
    // the next seed variant (seed#1, seed#2 ...) is tried otherwise, deterministically.
    if (!best || (best.cost >= 10 && attempt < 49)) continue;
    const makeUpDay = potCount + 2;
    const makeUp = best.pairs.map(([host, guest]) => ({ matchday: makeUpDay, home: host.club, away: guest.club, kind: 'make-up' }));
    const potExceptions = best.pairs.flatMap(([a, b]) => (potOf.get(a.club.id) === restPot && potOf.get(b.club.id) === restPot ? [] : [a.club.id, b.club.id]));
    return {
      seed: String(seed),
      attempt,
      pots: draw.pots.map((pot) => pot.filter((id) => id !== REST_WEEK_ID)),
      fixtures: [...draw.fixtures.filter((f) => !isGhost(f)), ...makeUp],
      matchdays: makeUpDay,
      makeUp,
      restWeeks: restWeeks.map((r) => ({ clubId: r.club.id, matchday: r.matchday })),
      potExceptions,
    };
  }
  throw new Error('Could not complete the draw for this seed; try another seed.');
}

// Checks every rule of the draw; returns a list of problems (empty when valid).
export function validateLeagueDraw(entries, fixtures, { potCount = 5, potExceptions = [] } = {}) {
  const problems = [];
  const potOf = new Map(entries.map((entry) => [entry.id, Number(entry.pot ?? entry.division)]));
  // Every club plays potCount + 1 matches (6), whatever the number of matchdays (7 with an odd field).
  const matchdays = potCount + 1;
  const excepted = new Set(potExceptions);
  const pairs = new Set();
  const stats = new Map(entries.map((entry) => [entry.id, { home: 0, away: 0, days: new Set(), pots: new Map() }]));
  for (const fixture of fixtures) {
    const home = fixture.home.id ?? fixture.home;
    const away = fixture.away.id ?? fixture.away;
    if (home === away) problems.push(`${home} plays itself.`);
    const key = [home, away].sort().join('|');
    if (pairs.has(key)) problems.push(`${home} and ${away} meet twice.`);
    pairs.add(key);
    for (const [club, opponent, side] of [[home, away, 'home'], [away, home, 'away']]) {
      const s = stats.get(club);
      if (!s) { problems.push(`${club} is not an entrant.`); continue; }
      s[side] += 1;
      if (s.days.has(fixture.matchday)) problems.push(`${club} plays twice on matchday ${fixture.matchday}.`);
      s.days.add(fixture.matchday);
      const pot = potOf.get(opponent);
      s.pots.set(pot, (s.pots.get(pot) || 0) + 1);
    }
  }
  for (const [club, s] of stats) {
    if (s.home + s.away !== matchdays) problems.push(`${club} has ${s.home + s.away} matches, not ${matchdays}.`);
    if (s.home !== matchdays / 2) problems.push(`${club} has ${s.home} home matches.`);
    for (let pot = 1; pot <= potCount && !excepted.has(club); pot += 1) {
      const expected = pot === potOf.get(club) ? 2 : 1;
      if ((s.pots.get(pot) || 0) !== expected) problems.push(`${club} plays ${s.pots.get(pot) || 0} clubs from pot ${pot}, not ${expected}.`);
    }
  }
  return problems;
}

// --- Results and the table -------------------------------------------------

// What a league match counts as. A one-sided forfeit is a 3-0 win for the
// side that tried; a double forfeit (notes or decided_by 'double_forfeit')
// is a 0-3 defeat for both.
export function leagueOutcome(match) {
  const homeId = match.home_entry_id;
  const awayId = match.away_entry_id;
  // The app's existing convention for a double forfeit: status forfeit, 0-0, no winner or loser.
  const doubleForfeit = match.decided_by === 'double_forfeit'
    || (match.status === 'forfeit' && Number(match.home_score) === 0 && Number(match.away_score) === 0 && !match.winner_entry_id && !match.loser_entry_id);
  if (doubleForfeit) {
    return { counted: true, home: { goalsFor: 0, goalsAgainst: 3, points: 0, result: 'L' }, away: { goalsFor: 0, goalsAgainst: 3, points: 0, result: 'L' }, homeId, awayId };
  }
  if (match.status === 'forfeit' || match.forfeit || match.walkover) {
    const winner = match.winner_entry_id;
    if (!winner) return { counted: false, homeId, awayId };
    const homeWins = winner === homeId;
    const win = { goalsFor: 3, goalsAgainst: 0, points: 3, result: 'W' };
    const loss = { goalsFor: 0, goalsAgainst: 3, points: 0, result: 'L' };
    return { counted: true, home: homeWins ? win : loss, away: homeWins ? loss : win, homeId, awayId };
  }
  if (match.status !== 'played' || match.home_score == null || match.away_score == null) return { counted: false, homeId, awayId };
  const hs = Number(match.home_score);
  const as = Number(match.away_score);
  const result = (a, b) => (a > b ? 'W' : a < b ? 'L' : 'D');
  const points = (a, b) => (a > b ? 3 : a === b ? 1 : 0);
  return {
    counted: true,
    homeId,
    awayId,
    home: { goalsFor: hs, goalsAgainst: as, points: points(hs, as), result: result(hs, as) },
    away: { goalsFor: as, goalsAgainst: hs, points: points(as, hs), result: result(as, hs) },
  };
}

// Tiebreakers: points, goal difference, goals scored, wins, then the total
// points of the opponents played (as in the Champions League), then away
// goals, then pot (lower first), then name.
export function calculateLeagueTable(entries = [], matches = [], { split = DEFAULT_SPLIT } = {}) {
  const rows = new Map(entries.map((entry) => [entry.id, {
    entryId: entry.id,
    name: entry.name,
    managerName: entry.managerName || null,
    pot: Number(entry.pot ?? entry.division) || null,
    played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, awayGoals: 0, points: 0,
    form: [],
    opponents: [],
  }]));

  const ordered = [...matches].filter((match) => match.stage === LEAGUE_STAGE || match.bracket === LEAGUE_BRACKET)
    .sort((a, b) => (Number(a.match_order) || 0) - (Number(b.match_order) || 0));

  for (const match of ordered) {
    const home = rows.get(match.home_entry_id);
    const away = rows.get(match.away_entry_id);
    if (home) home.opponents.push(match.away_entry_id);
    if (away) away.opponents.push(match.home_entry_id);
    const outcome = leagueOutcome(match);
    if (!outcome.counted) continue;
    for (const [row, side, isAway] of [[home, outcome.home, false], [away, outcome.away, true]]) {
      if (!row) continue;
      row.played += 1;
      row.goalsFor += side.goalsFor;
      row.goalsAgainst += side.goalsAgainst;
      if (isAway) row.awayGoals += side.goalsFor;
      row.points += side.points;
      if (side.result === 'W') row.won += 1;
      else if (side.result === 'D') row.drawn += 1;
      else row.lost += 1;
      row.form.push(side.result);
    }
  }

  const list = [...rows.values()].map((row) => ({ ...row, goalDifference: row.goalsFor - row.goalsAgainst }));
  const pointsOf = new Map(list.map((row) => [row.entryId, row.points]));
  for (const row of list) row.opponentPoints = row.opponents.reduce((sum, id) => sum + (pointsOf.get(id) || 0), 0);

  list.sort((a, b) => b.points - a.points
    || b.goalDifference - a.goalDifference
    || b.goalsFor - a.goalsFor
    || b.won - a.won
    || b.opponentPoints - a.opponentPoints
    || b.awayGoals - a.awayGoals
    || (a.pot ?? 99) - (b.pot ?? 99)
    || String(a.name).localeCompare(String(b.name)));

  return list.map((row, index) => {
    const position = index + 1;
    const zone = split.find((band) => position >= band.from && position <= band.to) || null;
    return { ...row, position, zone: zone?.key || null, zoneLabel: zone?.label || null, form: row.form.slice(-5) };
  });
}

// --- After the league phase ------------------------------------------------

// Seeded two-legged pairings: best against worst within a band (9 v 24,
// 10 v 23, ...). The higher-placed club plays the second leg at home.
export function bandPairings(table, from, to) {
  const band = table.filter((row) => row.position >= from && row.position <= to);
  const ties = [];
  for (let i = 0; i < band.length / 2; i += 1) {
    const higher = band[i];
    const lower = band[band.length - 1 - i];
    ties.push({ tie: i + 1, higher: higher.entryId, lower: lower.entryId, higherPosition: higher.position, lowerPosition: lower.position });
  }
  return ties;
}

// Everything the league table decides, in one place.
export function leaguePhaseQualification(table, split = DEFAULT_SPLIT) {
  const band = (key) => split.find((item) => item.key === key);
  const cup = band('cup_r16');
  const playoff = band('playoff');
  const shield = band('shield');
  return {
    cupDirect: table.filter((row) => row.position >= cup.from && row.position <= cup.to).map((row) => row.entryId),
    playoffTies: bandPairings(table, playoff.from, playoff.to),
    shieldTies: bandPairings(table, shield.from, shield.to),
    eliminated: table.filter((row) => row.position > shield.to).map((row) => row.entryId),
  };
}

// Calendar: one matchday a week (Wednesdays for the World Club Cup, Saturdays
// for the Youth Cup), then one week per knockout leg: two for a two-legged
// round, one for a single match. Dates are ISO yyyy-mm-dd strings.
export const KNOCKOUT_SLOTS = ['Knockout play-off', 'Last 16', 'Quarter-finals', 'Semi-finals', 'Final'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function leaguePhaseCalendar(firstMatchday, { matchdays = 6, weekday = 3, knockoutRounds = KNOCKOUT_SLOTS, singleLegSlots = [] } = {}) {
  const start = new Date(`${firstMatchday}T12:00:00Z`);
  if (Number.isNaN(start.getTime())) throw new Error('The first matchday must be a date (yyyy-mm-dd).');
  if (start.getUTCDay() !== weekday) throw new Error(`${firstMatchday} is not a ${WEEKDAY_NAMES[weekday]}.`);
  const week = (n) => new Date(start.getTime() + n * 7 * 86400000).toISOString().slice(0, 10);
  const calendar = [];
  for (let i = 0; i < matchdays; i += 1) calendar.push({ stage: 'League stage', round: `Matchday ${i + 1}`, date: week(i) });
  let next = matchdays;
  knockoutRounds.forEach((round) => {
    const legs = singleLegSlots.includes(round) ? 1 : 2;
    for (let leg = 1; leg <= legs; leg += 1) {
      calendar.push({ stage: 'Knockout', round, leg, date: week(next) });
      next += 1;
    }
  });
  return calendar;
}

// --- Knockout rounds built from the table ----------------------------------

export const WCC_ROUNDS = {
  Cup: ['Play-off', 'R16', 'QF', 'SF', 'Final'],
  Shield: ['R32', 'R16', 'QF', 'SF', 'Final'],
};

// Standard bracket order: seed 1 and seed 2 can only meet in the final.
export function bracketOrder(size) {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, next - seed]);
  }
  return order;
}

// Dates per bracket round from the calendar: the league matchdays, then one
// or two weeks per round. Cup play-off and Shield last 32 share the first
// slot, Cup and Shield last 16 the second. A single-match round has no leg2_date.
const SLOT_OF = { 'Play-off': 'Knockout play-off', R32: 'Knockout play-off', R16: 'Last 16', QF: 'Quarter-finals', SF: 'Semi-finals', Final: 'Final' };
export function knockoutRoundDates(firstMatchday, { matchdays = 6, weekday = 3, singleLegRounds = [] } = {}) {
  const singleLegSlots = [...new Set(singleLegRounds.map((round) => SLOT_OF[round]).filter(Boolean))];
  const calendar = leaguePhaseCalendar(firstMatchday, { matchdays, weekday, singleLegSlots });
  const knockout = calendar.filter((item) => item.stage === 'Knockout');
  const dates = (slot) => {
    const legs = knockout.filter((item) => item.round === slot);
    return { leg1_date: legs[0].date, leg2_date: legs[1]?.date || null };
  };
  const rows = [];
  for (const bracket of ['Cup', 'Shield']) {
    WCC_ROUNDS[bracket].forEach((round) => rows.push({ bracket, round, ...dates(SLOT_OF[round]) }));
  }
  return rows;
}

// One match (higher-placed club at home) or two legs (higher-placed club at home in leg 2).
function tieRows({ singleLeg, ...args }) {
  if (!singleLeg) return twoLegs(args);
  const { tournamentId, bracket, round, order, higher, lower, dates, names } = args;
  return [{ tournament_id: tournamentId, stage: 'knockout', bracket, round, match_order: order, status: 'scheduled', leg: 1, home_entry_id: higher, away_entry_id: lower, home_placeholder: names(higher), away_placeholder: names(lower), fixture_date: dates?.leg1_date || null }];
}

function twoLegs({ tournamentId, bracket, round, order, higher, lower, dates, names }) {
  // The higher-placed club plays the second leg at home.
  const base = { tournament_id: tournamentId, stage: 'knockout', bracket, round, match_order: order, status: 'scheduled' };
  return [
    { ...base, leg: 1, home_entry_id: lower, away_entry_id: higher, home_placeholder: names(lower), away_placeholder: names(higher), fixture_date: dates?.leg1_date || null },
    { ...base, leg: 2, home_entry_id: higher, away_entry_id: lower, home_placeholder: names(higher), away_placeholder: names(lower), fixture_date: dates?.leg2_date || null },
  ];
}

// Cup play-off (9-24) and Shield last 32 (25-56) once the league stage is complete.
export function buildPostLeagueRounds(table, { tournamentId, roundDates = [], split = DEFAULT_SPLIT, singleLegRounds = [] } = {}) {
  const incomplete = table.filter((row) => row.played < 6);
  const names = (id) => table.find((row) => row.entryId === id)?.name || null;
  const dateOf = (bracket, round) => roundDates.find((row) => row.bracket === bracket && row.round === round);
  const q = leaguePhaseQualification(table, split);
  const rows = [];
  q.playoffTies.forEach((tie) => rows.push(...tieRows({ singleLeg: singleLegRounds.includes('Play-off'), tournamentId, bracket: 'Cup', round: 'Play-off', order: tie.tie, higher: tie.higher, lower: tie.lower, dates: dateOf('Cup', 'Play-off'), names })));
  const order = bracketOrder(q.shieldTies.length);
  order.forEach((seed, index) => {
    const tie = q.shieldTies[seed - 1];
    rows.push(...tieRows({ singleLeg: singleLegRounds.includes('R32'), tournamentId, bracket: 'Shield', round: 'R32', order: index + 1, higher: tie.higher, lower: tie.lower, dates: dateOf('Shield', 'R32'), names }));
  });
  return { rows, incomplete: incomplete.length, cupDirect: q.cupDirect };
}

// Cup last 16: league 1-8 against the play-off winners. Seed 1 meets the
// winner of the 16 v 17 tie, seed 8 the winner of 9 v 24.
// playoffWinners: Map(tie number -> winning entry id).
export function buildCupRoundOf16(table, playoffWinners, { tournamentId, roundDates = [], singleLegRounds = [] } = {}) {
  const names = (id) => table.find((row) => row.entryId === id)?.name || null;
  const seeds = table.filter((row) => row.position >= 1 && row.position <= 8).map((row) => row.entryId);
  const missing = [1, 2, 3, 4, 5, 6, 7, 8].filter((tie) => !playoffWinners.get(tie));
  if (missing.length) throw new Error(`Play-off ties without a winner yet: ${missing.join(', ')}.`);
  const dates = roundDates.find((row) => row.bracket === 'Cup' && row.round === 'R16');
  const rows = [];
  bracketOrder(8).forEach((seed, index) => {
    const higher = seeds[seed - 1];
    const lower = playoffWinners.get(9 - seed);
    rows.push(...tieRows({ singleLeg: singleLegRounds.includes('R16'), tournamentId, bracket: 'Cup', round: 'R16', order: index + 1, higher, lower, dates, names }));
  });
  return rows;
}

// --- Weekly talking points -------------------------------------------------

export function matchdayOf(match) {
  const found = /Matchday\s+(\d+)/i.exec(match?.round || '');
  return found ? Number(found[1]) : null;
}

// The latest league matchday with at least one counted result.
export function latestPlayedMatchday(matches = []) {
  return matches.filter((m) => m.stage === LEAGUE_STAGE && leagueOutcome(m).counted && m.status === 'played')
    .reduce((max, m) => Math.max(max, matchdayOf(m) || 0), 0) || null;
}

// Upset of the week: the biggest Division gap between a winner and the club
// it beat (lower Division beating higher), then the winning margin.
// Biggest win: the largest margin. Climbers: positions gained on the matchday.
export function matchdayHighlights(entries = [], matches = [], matchday) {
  if (!matchday) return { upset: null, biggestWin: null, climbers: [] };
  const byId = new Map(entries.map((e) => [e.id, e]));
  const onDay = matches.filter((m) => m.stage === LEAGUE_STAGE && matchdayOf(m) === matchday && m.status === 'played' && m.home_score != null);
  const decorate = (m) => {
    const home = byId.get(m.home_entry_id);
    const away = byId.get(m.away_entry_id);
    const homeWon = m.home_score > m.away_score;
    const winner = homeWon ? home : away;
    const loser = homeWon ? away : home;
    return { match: m, home, away, winner, loser, margin: Math.abs(m.home_score - m.away_score), gap: (Number(winner?.pot) || 0) - (Number(loser?.pot) || 0) };
  };
  const decided = onDay.filter((m) => m.home_score !== m.away_score).map(decorate);
  const upset = decided.filter((d) => d.gap >= 1).sort((a, b) => b.gap - a.gap || b.margin - a.margin)[0] || null;
  const biggestWin = [...decided].sort((a, b) => b.margin - a.margin || (b.match.home_score + b.match.away_score) - (a.match.home_score + a.match.away_score))[0] || null;
  const before = calculateLeagueTable(entries, matches.filter((m) => m.stage !== LEAGUE_STAGE || (matchdayOf(m) || 0) < matchday));
  const after = calculateLeagueTable(entries, matches.filter((m) => m.stage !== LEAGUE_STAGE || (matchdayOf(m) || 0) <= matchday));
  const was = new Map(before.map((row) => [row.entryId, row.position]));
  const climbers = after.map((row) => ({ ...row, gained: (was.get(row.entryId) || row.position) - row.position }))
    .filter((row) => row.gained > 0).sort((a, b) => b.gained - a.gained || a.position - b.position).slice(0, 3);
  return { upset, biggestWin, climbers };
}
