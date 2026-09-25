const HAMBURG_BACKFILL_KIND = 'hamburgSeasonMatchBackfill';
const WORLD_BACKFILL_KIND = 'worldSeasonMatchBackfill';

function text(value) {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out || null;
}

function number(value) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function valueAt(value, index) {
  if (Array.isArray(value)) return value[index];
  if (value && typeof value === 'object') return value[index] ?? value[String(index)] ?? null;
  return null;
}

function sideValue(raw, side, suffix) {
  return raw?.[`${side}${suffix}`];
}

function playerRows(raw, side) {
  const ids = sideValue(raw, side, '_playerid');
  if (!Array.isArray(ids)) return [];
  const dataIds = sideValue(raw, side, '_playerdataid');
  const forenames = sideValue(raw, side, '_playerForename');
  const surnames = sideValue(raw, side, '_playerSurname');
  const ages = sideValue(raw, side, '_playerAge');
  const feet = sideValue(raw, side, '_playerFoot');
  const positions = sideValue(raw, side, '_playerPos');
  const positionDescriptions = sideValue(raw, side, '_playerPosDesc');
  const ratings = sideValue(raw, side, '_playerRating') ?? sideValue(raw, side, '_playerrating');
  const overallRatings = raw?.[side === 'h' ? 'HomePlayerRating' : 'AwayPlayerRating'];
  const matchRatings = raw?.[`${side}_rating`];
  return ids.map((id, index) => ({
    playerId: text(id),
    playerDataId: text(valueAt(dataIds, index)),
    teamSide: side === 'h' ? 'h' : 'a',
    name: [text(valueAt(forenames, index)), text(valueAt(surnames, index))].filter(Boolean).join(' ') || null,
    age: number(valueAt(ages, index)),
    foot: text(valueAt(feet, index)),
    position: text(valueAt(positions, index)),
    positionDescription: text(valueAt(positionDescriptions, index)),
    rating: number(valueAt(ratings, index)),
    overallRating: number(overallRatings?.[index] ?? valueAt(ratings, index)),
    matchRating: number(valueAt(matchRatings, index)) === 12 ? null : number(valueAt(matchRatings, index)),
    rawMatchRating: number(valueAt(matchRatings, index)),
  })).filter((row) => row.playerId);
}

function eventMap(raw, field, timeField) {
  const values = raw?.[field];
  const times = raw?.[timeField];
  if (!values || typeof values !== 'object' || Array.isArray(values)) return [];
  return Object.entries(values).flatMap(([playerId, count]) => {
    const total = Math.max(1, number(count) || 1);
    const rawTime = times && typeof times === 'object' ? times[playerId] : null;
    return Array.from({ length: total }, (_, index) => ({ playerId: text(playerId), minute: number(Array.isArray(rawTime) ? rawTime[index] : rawTime), occurrence: index }));
  });
}

function structuredEvents(raw) {
  const rows = [];
  let sequence = 0;
  const add = (type, playerId, minute, extra = {}) => {
    if (!playerId) return;
    rows.push({ sequence: sequence++, minute: number(minute), type, clubSide: null, playerId: text(playerId), secondaryPlayerId: null, ...extra });
  };
  for (const row of eventMap(raw, 'YellowCards', 'YellowCardsTime')) add('yellow', row.playerId, row.minute);
  for (const row of eventMap(raw, 'RedCards', 'RedCardsTime')) add('red', row.playerId, row.minute);
  const scorers = raw?.GoalScorers;
  if (scorers && typeof scorers === 'object' && !Array.isArray(scorers)) {
    for (const [playerId, count] of Object.entries(scorers)) {
      const total = Math.max(1, number(count) || 1);
      const goalTimes = [...(Array.isArray(raw?.HomeGS_PlayerID) ? raw.HomeGS_PlayerID.map((id, i) => [id, valueAt(raw.HomeGS_GoalTimes, i), 'h']) : []), ...(Array.isArray(raw?.AwayGS_PlayerID) ? raw.AwayGS_PlayerID.map((id, i) => [id, valueAt(raw.AwayGS_GoalTimes, i), 'a']) : [])]
        .filter(([id]) => text(id) === text(playerId));
      for (let i = 0; i < total; i += 1) add('goal', playerId, goalTimes[i]?.[1], { clubSide: goalTimes[i]?.[2] || null });
    }
  }
  return rows.sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999)).map((row, index) => ({ ...row, sequence: index }));
}

function substitutions(raw) {
  const on = Array.isArray(raw?.SubsOn) ? raw.SubsOn : [];
  const homeIds = new Set((Array.isArray(raw?.h_playerid) ? raw.h_playerid : []).map(text).filter(Boolean));
  const awayIds = new Set((Array.isArray(raw?.a_playerid) ? raw.a_playerid : []).map(text).filter(Boolean));
  const teamSide = (onId, offId) => {
    if (homeIds.has(onId) || homeIds.has(offId)) return 'h';
    if (awayIds.has(onId) || awayIds.has(offId)) return 'a';
    return null;
  };
  const off = Array.isArray(raw?.SubsOff) ? raw.SubsOff : [];
  const times = Array.isArray(raw?.subTime) ? raw.subTime : [];
  return on.map((playerId, index) => {
    const onId = text(playerId);
    const offId = text(off[index]);
    return {
    sequence: index,
    minute: number(times[index]),
    teamSide: teamSide(onId, offId),
    type: 'substitution',
    onPlayerIds: [onId].filter(Boolean),
    offPlayerIds: [offId].filter(Boolean),
  };
  }).filter((row) => row.onPlayerIds.length || row.offPlayerIds.length);
}

function tacticValue(raw, side, names) {
  for (const name of names) {
    const value = raw?.[`${side}_${name}`];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function tactics(raw, side) {
  const fields = {
    formation: ['formationNames', 'formation', 'Formation'],
    mentality: ['attackingStyleName', 'mentality', 'Mentality'],
    passing: ['passingStyleName', 'passing', 'Passing'],
    attackingStyle: ['focusPassingName', 'attackingstyle', 'attackingStyle', 'AttackingStyle'],
    tempo: ['tempoName', 'tempo', 'Tempo'],
    pressing: ['pressingName', 'pressing', 'Pressing'],
    counterAttack: ['counterattack', 'counterAttack', 'CounterAttack'],
    menBehindBall: ['menbehindball', 'menBehindBall', 'MenBehindBall'],
    tightMarking: ['tightmarking', 'tightMarking', 'TightMarking'],
    offsideTrap: ['offside', 'offsidetrap', 'offsideTrap', 'OffsideTrap'],
    width: ['width', 'Width'],
    creativity: ['creativity', 'Creativity'],
    aggression: ['aggressionName', 'aggression', 'Aggression'],
    shooting: ['shooting', 'Shooting'],
    crossing: ['crossing', 'Crossing'],
    defensiveLine: ['backlineName', 'defensiveline', 'defensiveLine', 'DefensiveLine'],
    sweeperKeeper: ['sweeperkeeper', 'sweeperKeeper', 'SweeperKeeper'],
  };
  const instructions = {};
  for (const [key, names] of Object.entries(fields)) {
    const value = tacticValue(raw, side, names);
    if (value !== null && value !== undefined) instructions[key] = value;
  }
  return {
    instructions,
    actionTimeline: tacticValue(raw, side, ['tacticActions']),
    formationIds: tacticValue(raw, side, ['formationId']),
    formationNames: tacticValue(raw, side, ['formationNames']),
    playerRoles: tacticValue(raw, side, ['PlayerRole']),
    arrows: tacticValue(raw, side, ['ArrowData']),
    captainSlot: tacticValue(raw, side, ['captain']),
    penaltyTakerSlot: tacticValue(raw, side, ['penaltyTaker']),
    deadballTakerSlot: tacticValue(raw, side, ['deadballTaker']),
    cornerTakerSlot: tacticValue(raw, side, ['cornerTaker']),
    playMakerSlot: tacticValue(raw, side, ['playMaker']),
    targetManSlot: tacticValue(raw, side, ['targetMan']),
  };
}

function normalizeReport(report, setupId, capturedAt) {
  const raw = report?.raw || {};
  const fixtureId = text(report?.fixtureId ?? raw?.fixtureID ?? raw?.FixtureId);
  if (!fixtureId) throw new Error('Backfill report is missing its fixture id.');
  const homeClubId = text(report?.home?.clubId ?? raw?.HomeClubID);
  const awayClubId = text(report?.away?.clubId ?? raw?.AwayClubID);
  if (!homeClubId || !awayClubId) throw new Error(`Fixture ${fixtureId} is missing club ids.`);
  return {
    kind: 'matchReplay',
    source: { setupId, fixtureId, pageUrl: null, sourceKind: 'matchreport-json', capturedAt },
    competition: { code: text(raw?.CompType), name: text(report?.competition ?? raw?.TournName) },
    fixture: {
      date: text(report?.date ?? raw?.TurnDate),
      homeClubId,
      homeName: text(report?.home?.name ?? raw?.HomeTeamName),
      awayClubId,
      awayName: text(report?.away?.name ?? raw?.AwayTeamName),
      homeScore: number(report?.home?.score ?? raw?.HomeTeamScore ?? raw?.HomeScore),
      awayScore: number(report?.away?.score ?? raw?.AwayTeamScore ?? raw?.AwayScore),
    },
    stats: {
      home: { possession: number(raw?.HomePoss), shots: number(raw?.HomeShotsOnGoal), shotsOnTarget: number(raw?.HomeShotsOnTarget), corners: number(raw?.HomeCorners) },
      away: { possession: number(raw?.AwayPoss), shots: number(raw?.AwayShotsOnGoal), shotsOnTarget: number(raw?.AwayShotsOnTarget), corners: number(raw?.AwayCorners) },
    },
    players: [...playerRows(raw, 'h'), ...playerRows(raw, 'a')],
    keyEvents: structuredEvents(raw),
    chances: [],
    substitutions: substitutions(raw),
    domination: [],
    worldFixtures: [],
    worldScores: [],
    tactics: { home: tactics(raw, 'h'), away: tactics(raw, 'a') },
    matchReport: {
      manOfMatch: text(raw?.ManOfMatch),
      assists: raw?.Assists && typeof raw.Assists === 'object' ? raw.Assists : {},
      injuries: raw?.Injuries ?? null,
      commentary: Array.isArray(raw?.Commentary) ? raw.Commentary : [],
      referee: { name: text(raw?.RefName), country: text(raw?.RefCountryName) },
      attendance: number(String(raw?.Attendance ?? '').replace(/,/g, '')),
      fullFidelity: {
        tacticActions: { home: raw?.h_tacticActions ?? raw?.home_TacticActions ?? null, away: raw?.a_tacticActions ?? raw?.away_TacticActions ?? null },
        formationNames: { home: raw?.h_formationNames ?? null, away: raw?.a_formationNames ?? null },
        playerMatchRatings: { home: raw?.h_rating ?? null, away: raw?.a_rating ?? null },
        playerOverallRatings: { home: raw?.HomePlayerRating ?? raw?.h_playerRating ?? null, away: raw?.AwayPlayerRating ?? raw?.a_playerRating ?? null },
      },
    },
  };
}

export function isHamburgSeasonBackfill(value) {
  return [HAMBURG_BACKFILL_KIND, WORLD_BACKFILL_KIND].includes(value?.kind) && Array.isArray(value?.reports);
}

export function normalizeHamburgSeasonBackfill(value, options = {}) {
  if (!isHamburgSeasonBackfill(value)) throw new Error('This is not a supported Soccer Manager season backfill file.');
  const nonZeroId = (candidate) => { const id = text(candidate); return id && id !== '0' ? id : null; };
  const setupId = nonZeroId(value?.setupId) || nonZeroId(options.setupId);
  if (!setupId || !/^\d+$/.test(setupId)) {
    throw new Error('The backfill file does not contain the Soccer Manager setup id. Use a v2 backfill export, or import this older pilot file from a Soccer Manager Sync page whose URL includes ?sid=….');
  }
  const capturedAt = text(value?.capturedAt) || new Date().toISOString();
  const seen = new Set();
  const entries = [];
  const errors = [];
  for (const report of value.reports) {
    try {
      const payload = normalizeReport(report, setupId, capturedAt);
      const id = payload.source.fixtureId;
      if (seen.has(id)) continue;
      seen.add(id);
      entries.push({
        id: `match-backfill:${setupId}:${id}`,
        name: `Match report ${id}`,
        sourceUrl: null,
        payload,
      });
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { entries, errors, failures: Array.isArray(value.failures) ? value.failures : [] };
}
