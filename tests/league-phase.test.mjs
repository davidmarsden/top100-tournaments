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
