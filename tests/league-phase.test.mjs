import test from 'node:test';
import assert from 'node:assert/strict';
import {
  drawLeaguePhase, validateLeagueDraw, calculateLeagueTable, leaguePhaseQualification, leaguePhaseCalendar, LEAGUE_STAGE,
} from '../src/lib/leaguePhase.js';

const clubs = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, name: `Club ${i + 1}`, division: Math.floor(i / 20) + 1 }));

test('the draw obeys every rule for many seeds', () => {
  for (let s = 0; s < 200; s += 1) {
    const { fixtures } = drawLeaguePhase(clubs, { seed: `S29-WCC-${s}` });
    assert.equal(fixtures.length, 300);
    const problems = validateLeagueDraw(clubs, fixtures.map((f) => ({ ...f, home: f.home.id, away: f.away.id })));
    assert.deepEqual(problems, [], `seed ${s}`);
  }
});

test('the same seed gives the same draw; a different seed a different one', () => {
  const key = (draw) => draw.fixtures.map((f) => `${f.matchday}:${f.home.id}-${f.away.id}`).join(',');
  assert.equal(key(drawLeaguePhase(clubs, { seed: 'abc' })), key(drawLeaguePhase(clubs, { seed: 'abc' })));
  assert.notEqual(key(drawLeaguePhase(clubs, { seed: 'abc' })), key(drawLeaguePhase(clubs, { seed: 'abd' })));
});

test('uneven pots and a missing seed are refused', () => {
  assert.throws(() => drawLeaguePhase(clubs.slice(1), { seed: 'x' }), /same number/);
  assert.throws(() => drawLeaguePhase(clubs), /seed/);
});

test('table: points, forfeits and double forfeits; tiebreakers', () => {
  const entries = [1, 2, 3, 4].map((id) => ({ id, name: `C${id}`, pot: 1 }));
  const m = (order, home, away, extra) => ({ stage: LEAGUE_STAGE, match_order: order, home_entry_id: home, away_entry_id: away, ...extra });
  const table = calculateLeagueTable(entries, [
    m(1, 1, 2, { status: 'played', home_score: 2, away_score: 0 }),
    m(2, 3, 4, { status: 'forfeit', forfeit: true, winner_entry_id: 4 }),
    m(3, 1, 3, { status: 'forfeit', decided_by: 'double_forfeit' }),
    m(4, 2, 4, { status: 'played', home_score: 1, away_score: 1 }),
    m(5, 2, 3, { status: 'scheduled' }),
  ]);
  const byId = Object.fromEntries(table.map((row) => [row.entryId, row]));
  assert.equal(byId[4].points, 4); assert.equal(byId[4].goalsFor, 4);
  assert.equal(byId[1].points, 3); assert.equal(byId[1].goalDifference, -1);
  assert.equal(byId[3].lost, 2); assert.equal(byId[3].goalsAgainst, 6);
  assert.equal(byId[2].played, 2);
  assert.deepEqual(table.map((row) => row.entryId), [4, 1, 2, 3]);
});

test('qualification: top 8 through, 9 v 24 play-off, 25 v 56 Shield, rest out', () => {
  const table = clubs.map((club, i) => ({ entryId: club.id, position: i + 1 }));
  const q = leaguePhaseQualification(table);
  assert.deepEqual(q.cupDirect, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(q.playoffTies.length, 8);
  assert.deepEqual(q.playoffTies[0], { tie: 1, higher: 9, lower: 24, higherPosition: 9, lowerPosition: 24 });
  assert.equal(q.shieldTies.length, 16);
  assert.deepEqual([q.shieldTies[0].higher, q.shieldTies[0].lower], [25, 56]);
  assert.equal(q.eliminated.length, 44);
});

test('calendar from 9 December: 6 matchdays then two-legged rounds; 16 Wednesdays', () => {
  const calendar = leaguePhaseCalendar('2026-12-09');
  assert.equal(calendar.length, 16);
  assert.equal(calendar[0].date, '2026-12-09');
  assert.equal(calendar[5].date, '2027-01-13');
  assert.deepEqual(calendar.at(-1), { stage: 'Knockout', round: 'Final', leg: 2, date: '2027-03-24' });
  assert.throws(() => leaguePhaseCalendar('2026-12-08'), /not a Wednesday/);
});

import { bracketOrder, buildPostLeagueRounds, buildCupRoundOf16, knockoutRoundDates } from '../src/lib/leaguePhase.js';

test('bracket order keeps the top seeds apart', () => {
  assert.deepEqual(bracketOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  assert.equal(bracketOrder(16).length, 16);
  assert.deepEqual(bracketOrder(16).slice(0, 4), [1, 16, 8, 9]);
});

test('knockout dates: play-off and Shield R32 on Wednesdays 7-8, finals 15-16', () => {
  const dates = knockoutRoundDates('2026-12-09');
  const find = (b, r) => dates.find((d) => d.bracket === b && d.round === r);
  assert.deepEqual(find('Cup', 'Play-off'), { bracket: 'Cup', round: 'Play-off', leg1_date: '2027-01-20', leg2_date: '2027-01-27' });
  assert.equal(find('Shield', 'R32').leg1_date, '2027-01-20');
  assert.equal(find('Shield', 'R16').leg1_date, find('Cup', 'R16').leg1_date);
  assert.deepEqual([find('Cup', 'Final').leg1_date, find('Cup', 'Final').leg2_date], ['2027-03-17', '2027-03-24']);
});

test('post-league rounds: 8 play-off ties, 16 Shield ties, higher club at home in leg 2', () => {
  const table = clubs.map((club, i) => ({ entryId: club.id, name: club.name, position: i + 1, played: 6 }));
  const { rows, incomplete, cupDirect } = buildPostLeagueRounds(table, { tournamentId: 7, roundDates: knockoutRoundDates('2026-12-09') });
  assert.equal(incomplete, 0);
  assert.deepEqual(cupDirect, [1, 2, 3, 4, 5, 6, 7, 8]);
  const playoff = rows.filter((r) => r.round === 'Play-off');
  const shield = rows.filter((r) => r.bracket === 'Shield');
  assert.equal(playoff.length, 16); assert.equal(shield.length, 32);
  const tie1 = playoff.filter((r) => r.match_order === 1);
  assert.deepEqual(tie1.map((r) => [r.leg, r.home_entry_id, r.away_entry_id]), [[1, 24, 9], [2, 9, 24]]);
  assert.equal(tie1[0].fixture_date, '2027-01-20');
  const shieldFirst = shield.filter((r) => r.match_order === 1 && r.leg === 2)[0];
  assert.deepEqual([shieldFirst.home_entry_id, shieldFirst.away_entry_id], [25, 56]);
  const shieldSecond = shield.filter((r) => r.match_order === 2 && r.leg === 2)[0];
  assert.deepEqual([shieldSecond.home_entry_id, shieldSecond.away_entry_id], [40, 41], 'seed 16 (40 v 41) is in seed 1\'s half');
  assert.equal(new Set(shield.flatMap((r) => [r.home_entry_id, r.away_entry_id])).size, 32);
});

test('cup last 16: seed 1 v winner of 16 v 17, seed 8 v winner of 9 v 24', () => {
  const table = clubs.map((club, i) => ({ entryId: club.id, name: club.name, position: i + 1, played: 6 }));
  const winners = new Map([[1, 24], [2, 10], [3, 11], [4, 12], [5, 13], [6, 14], [7, 15], [8, 17]]);
  const rows = buildCupRoundOf16(table, winners, { tournamentId: 7 });
  const leg2 = rows.filter((r) => r.leg === 2).map((r) => [r.match_order, r.home_entry_id, r.away_entry_id]);
  assert.deepEqual(leg2[0], [1, 1, 17]);
  assert.deepEqual(leg2[1], [2, 8, 24]);
  assert.throws(() => buildCupRoundOf16(table, new Map([[1, 9]]), {}), /without a winner/);
});

import { matchdayHighlights, latestPlayedMatchday } from '../src/lib/leaguePhase.js';

test('highlights: upset of the week, biggest win, climbers', () => {
  const entries = [
    { id: 1, name: 'Giant', pot: 1 }, { id: 2, name: 'Minnow', pot: 5 },
    { id: 3, name: 'Mid', pot: 3 }, { id: 4, name: 'Other', pot: 2 },
  ];
  const m = (md, h, a, hs, as) => ({ stage: 'league', round: `Matchday ${md}`, match_order: md * 1000 + h, status: 'played', home_entry_id: h, away_entry_id: a, home_score: hs, away_score: as });
  const matches = [m(1, 1, 3, 1, 0), m(1, 4, 2, 2, 0), m(2, 1, 2, 0, 1), m(2, 3, 4, 5, 0)];
  assert.equal(latestPlayedMatchday(matches), 2);
  const h = matchdayHighlights(entries, matches, 2);
  assert.equal(h.upset.winner.name, 'Minnow');
  assert.equal(h.upset.gap, 4);
  assert.equal(h.biggestWin.winner.name, 'Mid');
  assert.ok(h.climbers.some((row) => row.name === 'Mid'));
});

// --- Youth Cup fields: 60 clubs (5 pots of 12) and 59 (one pot one short) -----
import { drawLeagueField, REST_WEEK_ID } from '../src/lib/leaguePhase.js';

const youth = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `Y${i + 1}`, pot: Math.floor(i / 12) + 1 }));

test('60 clubs: 5 pots of 12, six matchdays, every rule kept', () => {
  for (let s = 0; s < 100; s += 1) {
    const draw = drawLeagueField(youth(60), { seed: `S29-YC-${s}` });
    assert.equal(draw.matchdays, 6);
    assert.equal(draw.fixtures.length, 180);
    assert.deepEqual(validateLeagueDraw(youth(60), draw.fixtures.map((f) => ({ ...f, home: f.home.id, away: f.away.id }))), [], `seed ${s}`);
  }
});

test('59 clubs: seven matchdays, six matches each, one rest week each, no repeats', () => {
  for (let s = 0; s < 300; s += 1) {
    const clubs = youth(59);
    const draw = drawLeagueField(clubs, { seed: `S29-YC-${s}` });
    assert.equal(draw.matchdays, 7);
    assert.equal(draw.fixtures.length, 177);
    assert.equal(draw.makeUp.length, 3);
    assert.ok(draw.fixtures.every((f) => f.home.id !== REST_WEEK_ID && f.away.id !== REST_WEEK_ID));
    const problems = validateLeagueDraw(clubs, draw.fixtures.map((f) => ({ ...f, home: f.home.id, away: f.away.id })), { potExceptions: draw.potExceptions });
    assert.deepEqual(problems, [], `seed ${s}`);
    // Every club rests exactly once over the seven matchdays.
    for (const club of clubs) {
      const days = new Set(draw.fixtures.filter((f) => f.home.id === club.id || f.away.id === club.id).map((f) => f.matchday));
      assert.equal(days.size, 6, `club ${club.id} seed ${s}`);
    }
    assert.ok(draw.potExceptions.length <= 4);
  }
});

test('the 59-club draw is reproducible from its seed', () => {
  const key = (draw) => draw.fixtures.map((f) => `${f.matchday}:${f.home.id}-${f.away.id}`).join(',');
  assert.equal(key(drawLeagueField(youth(59), { seed: 'yc' })), key(drawLeagueField(youth(59), { seed: 'yc' })));
});

test('Youth Cup calendar: Saturdays, single matches to the last 16, then two legs', () => {
  const dates = knockoutRoundDates('2026-12-12', { matchdays: 7, weekday: 6, singleLegRounds: ['Play-off', 'R32', 'R16'] });
  const at = (bracket, round) => dates.find((row) => row.bracket === bracket && row.round === round);
  assert.deepEqual(at('Cup', 'Play-off'), { bracket: 'Cup', round: 'Play-off', leg1_date: '2027-01-30', leg2_date: null });
  assert.deepEqual(at('Shield', 'R32'), { bracket: 'Shield', round: 'R32', leg1_date: '2027-01-30', leg2_date: null });
  assert.deepEqual(at('Cup', 'R16'), { bracket: 'Cup', round: 'R16', leg1_date: '2027-02-06', leg2_date: null });
  assert.deepEqual(at('Cup', 'QF'), { bracket: 'Cup', round: 'QF', leg1_date: '2027-02-13', leg2_date: '2027-02-20' });
  assert.deepEqual(at('Cup', 'Final'), { bracket: 'Cup', round: 'Final', leg1_date: '2027-03-13', leg2_date: '2027-03-20' });
  assert.throws(() => knockoutRoundDates('2026-12-09', { weekday: 6 }), /not a Saturday/);
});

test('single-match play-off: one fixture, higher-placed club at home', () => {
  const table = Array.from({ length: 59 }, (_, i) => ({ entryId: i + 1, name: `Y${i + 1}`, position: i + 1, played: 6 }));
  const { rows } = buildPostLeagueRounds(table, { tournamentId: 1, singleLegRounds: ['Play-off', 'R32', 'R16'] });
  const playoff = rows.filter((r) => r.round === 'Play-off');
  assert.equal(playoff.length, 8);
  assert.ok(playoff.every((r) => r.leg === 1));
  assert.deepEqual([playoff[0].home_entry_id, playoff[0].away_entry_id], [9, 24]);
  assert.equal(rows.filter((r) => r.round === 'R32').length, 16);
});
