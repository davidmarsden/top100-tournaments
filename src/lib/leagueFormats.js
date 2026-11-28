// Per-competition settings for league-phase tournaments.
//
// World Club Cup: every club in the game world, pots are the five Divisions,
// Wednesdays, every knockout tie over two legs.
// Youth Cup: the clubs that registered, pots by registered rating, Saturdays,
// single matches up to the last 16 and two legs from the quarter-finals.
// The tournament's league_matchday_weekday (3 or 6) and league_single_leg_rounds
// columns hold the choice; the rest follows from it.
import { DEFAULT_SPLIT } from './leaguePhase.js';

export const YOUTH_SINGLE_LEG_ROUNDS = ['Play-off', 'R32', 'R16'];

export function leagueFormat(tournament) {
  const youth = Number(tournament?.league_matchday_weekday) === 6;
  const singleLegRounds = Array.isArray(tournament?.league_single_leg_rounds) ? tournament.league_single_leg_rounds : [];
  if (youth) {
    return {
      key: 'youth',
      cupName: 'Youth Cup',
      short: 'YC',
      weekday: 6,
      weekdayName: 'Saturday',
      defaultFirstMatchday: '2026-12-12',
      potsByRating: true,
      potLabel: 'Pot',
      potTitle: (pot) => `Pot ${pot}`,
      singleLegRounds: singleLegRounds.length ? singleLegRounds : YOUTH_SINGLE_LEG_ROUNDS,
    };
  }
  return {
    key: 'wcc',
    cupName: 'World Club Cup',
    short: 'WCC',
    weekday: 3,
    weekdayName: 'Wednesday',
    defaultFirstMatchday: '2026-12-09',
    potsByRating: false,
    potLabel: 'Division',
    potTitle: (pot) => `Division ${pot}`,
    singleLegRounds,
  };
}

// League matchdays for a field drawn from 5 pots: 6 when the pots are equal,
// 7 when the field is one club short (a rest week each, see drawLeagueField).
export function leagueMatchdayCount(entryCount, potCount = 5) {
  return entryCount > 0 && entryCount % potCount !== 0 ? potCount + 2 : potCount + 1;
}

// The table's qualification bands, named for the competition.
export function leagueSplit(format) {
  return DEFAULT_SPLIT.map((band) => (band.key === 'cup_r16' ? { ...band, label: `${format.cupName} last 16` } : band));
}
