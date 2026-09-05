export const isCompleted = (match) => match?.status === 'played' || match?.status === 'forfeit';

export function knockoutTieKey(match) {
  return [match?.bracket || 'Knockout', match?.round || 'Round', match?.match_order || 0].join('|');
}

export function isDoubleForfeit(match) {
  return match?.status === 'forfeit'
    && Number(match?.home_score) === 0
    && Number(match?.away_score) === 0
    && !match?.winner_entry_id
    && !match?.loser_entry_id;
}

export function normalTimeScore(match, side) {
  const normalKey = side === 'home' ? 'home_normal_time_score' : 'away_normal_time_score';
  const finalKey = side === 'home' ? 'home_score' : 'away_score';
  return Number(match?.[normalKey] ?? match?.[finalKey] ?? 0);
}

export function calculateFetFromStats({ homePossession, awayPossession, homeShotsOnTarget, awayShotsOnTarget } = {}) {
  const hp = Number(homePossession);
  const ap = Number(awayPossession);
  const hs = Number(homeShotsOnTarget);
  const as = Number(awayShotsOnTarget);
  const valid = [hp, ap, hs, as].every(Number.isFinite)
    && hp >= 0 && hp <= 100
    && ap >= 0 && ap <= 100
    && hs >= 0 && as >= 0;

  if (!valid) return { valid: false, homeGoals: 0, awayGoals: 0, steps: [], resolved: false };

  let homeGoals = 0;
  let awayGoals = 0;
  const steps = [];

  if (hp > ap) {
    homeGoals += 1;
    steps.push({ rule: 'possession', winner: 'home', homeValue: hp, awayValue: ap });
  } else if (ap > hp) {
    awayGoals += 1;
    steps.push({ rule: 'possession', winner: 'away', homeValue: hp, awayValue: ap });
  } else {
    steps.push({ rule: 'possession', winner: null, homeValue: hp, awayValue: ap });
  }

  if (hs > as) {
    homeGoals += 1;
    steps.push({ rule: 'shots_on_target', winner: 'home', homeValue: hs, awayValue: as });
  } else if (as > hs) {
    awayGoals += 1;
    steps.push({ rule: 'shots_on_target', winner: 'away', homeValue: hs, awayValue: as });
  } else {
    steps.push({ rule: 'shots_on_target', winner: null, homeValue: hs, awayValue: as });
  }

  if (homeGoals === awayGoals) {
    const homeCombined = hp + hs;
    const awayCombined = ap + as;
    if (homeCombined > awayCombined) {
      homeGoals += 1;
      steps.push({ rule: 'combined_tiebreak', winner: 'home', homeValue: homeCombined, awayValue: awayCombined });
    } else if (awayCombined > homeCombined) {
      awayGoals += 1;
      steps.push({ rule: 'combined_tiebreak', winner: 'away', homeValue: homeCombined, awayValue: awayCombined });
    } else {
      steps.push({ rule: 'combined_tiebreak', winner: null, homeValue: homeCombined, awayValue: awayCombined });
    }
  }

  return {
    valid: true,
    homeGoals,
    awayGoals,
    steps,
    resolved: homeGoals !== awayGoals,
    homeCombined: hp + hs,
    awayCombined: ap + as,
  };
}

export function tieSnapshot(legs = [], scoreOverrides = new Map()) {
  const ordered = [...legs].sort((a, b) => Number(a.leg || 1) - Number(b.leg || 1));
  if (!ordered.length) return null;
  const first = ordered[0];
  const firstId = first.home_entry_id;
  const secondId = first.away_entry_id;
  if (!firstId || !secondId) return null;

  let firstAgg = 0;
  let secondAgg = 0;
  let firstAway = 0;
  let secondAway = 0;
  let completedCount = 0;

  ordered.forEach((leg) => {
    const override = scoreOverrides.get(leg.id);
    const storedHome = leg.home_normal_time_score ?? leg.home_score;
    const storedAway = leg.away_normal_time_score ?? leg.away_score;
    const hasScore = override
      ? Number.isFinite(Number(override.home_score)) && Number.isFinite(Number(override.away_score))
      : storedHome !== null && storedHome !== undefined && storedAway !== null && storedAway !== undefined;
    if (!hasScore) return;

    completedCount += 1;
    const home = Number(override?.home_score ?? storedHome ?? 0);
    const away = Number(override?.away_score ?? storedAway ?? 0);
    if (leg.home_entry_id === firstId) {
      firstAgg += home;
      secondAgg += away;
      secondAway += away;
    } else {
      firstAgg += away;
      secondAgg += home;
      firstAway += away;
    }
  });

  let winnerId = null;
  let loserId = null;
  let reason = 'incomplete';
  const complete = completedCount === ordered.length;
  if (complete) {
    if (firstAgg > secondAgg) {
      winnerId = firstId; loserId = secondId; reason = 'aggregate';
    } else if (secondAgg > firstAgg) {
      winnerId = secondId; loserId = firstId; reason = 'aggregate';
    } else if (ordered.length > 1 && firstAway > secondAway) {
      winnerId = firstId; loserId = secondId; reason = 'away_goals';
    } else if (ordered.length > 1 && secondAway > firstAway) {
      winnerId = secondId; loserId = firstId; reason = 'away_goals';
    } else {
      reason = 'fet_required';
    }
  }

  return { ordered, firstId, secondId, firstAgg, secondAgg, firstAway, secondAway, complete, winnerId, loserId, reason };
}

export function resolveTieWithFet(legs = []) {
  const ordered = [...legs].sort((a, b) => Number(a.leg || 1) - Number(b.leg || 1));
  if (!ordered.length) return { reason: 'incomplete' };
  if (ordered.some((leg) => !isCompleted(leg))) return { reason: 'incomplete' };
  if (ordered.every(isDoubleForfeit)) return { winnerId: null, loserId: null, reason: 'double_forfeit' };

  const snapshot = tieSnapshot(ordered);
  if (!snapshot) return { reason: 'incomplete' };
  if (snapshot.winnerId) return snapshot;

  const decidingLeg = [...ordered].reverse().find((leg) =>
    leg.home_extra_time_score !== null && leg.home_extra_time_score !== undefined
    && leg.away_extra_time_score !== null && leg.away_extra_time_score !== undefined);
  if (!decidingLeg) return { ...snapshot, reason: 'fet_required' };

  const homeFet = Number(decidingLeg.home_extra_time_score || 0);
  const awayFet = Number(decidingLeg.away_extra_time_score || 0);
  if (homeFet === awayFet) return { ...snapshot, reason: 'fet_unresolved' };

  const winnerId = homeFet > awayFet ? decidingLeg.home_entry_id : decidingLeg.away_entry_id;
  const loserId = homeFet > awayFet ? decidingLeg.away_entry_id : decidingLeg.home_entry_id;
  return { ...snapshot, winnerId, loserId, reason: 'fictional_extra_time', decidingLeg, homeFet, awayFet };
}

export function describeFetStep(step, homeName = 'Home', awayName = 'Away') {
  if (!step) return '';
  const winnerName = step.winner === 'home' ? homeName : step.winner === 'away' ? awayName : 'No goal';
  if (step.rule === 'possession') return `Possession ${step.homeValue}–${step.awayValue}: ${winnerName}${step.winner ? ' +1 FET goal' : ''}`;
  if (step.rule === 'shots_on_target') return `Shots on target ${step.homeValue}–${step.awayValue}: ${winnerName}${step.winner ? ' +1 FET goal' : ''}`;
  return `Possession + shots on target ${step.homeValue}–${step.awayValue}: ${winnerName}${step.winner ? ' +1 tiebreak goal' : ''}`;
}
