function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function booleanFlag(value) {
  if (value === true || value === 1 || value === '1') return true;
  if (value === false || value === 0 || value === '0' || value === null || value === undefined || value === '') return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === 'no') return false;
  }
  return false;
}

function nonZeroId(value) {
  const text = textOrNull(value);
  if (!text || text === '0') return null;
  return text;
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&pound;/g, '£')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanPosition(value) {
  const match = String(value || '').match(/>([^<]+)</);
  return match ? match[1].trim() : stripHtml(value);
}

function zipLeagueRows(tables, leagueId) {
  const keys = {
    clubId: '_clubId',
    clubDataId: '_clubDataId',
    clubName: '_clubName',
    managed: '_isManaged',
    stadium: '_stadiumName',
    stadiumSize: '_size',
    played: '_gamesPld',
    won: '_gamesWon',
    drawn: '_gamesDrawn',
    lost: '_gamesLost',
    goalsFor: '_goalsFor',
    goalsAgainst: '_goalsAgainst',
    goalDifference: '_goalsDiff',
    points: '_pts',
    positionClubId: '_pos',
    oldPosition: '_oldPos',
    newPosition: '_newPos',
  };
  const length = Math.max(...Object.values(keys).map((key) => asArray(tables?.[key]?.[leagueId]).length), 0);
  return Array.from({ length }, (_, index) => {
    const row = {};
    for (const [field, key] of Object.entries(keys)) {
      row[field] = tables?.[key]?.[leagueId]?.[index] ?? null;
    }
    return {
      clubId: textOrNull(row.clubId),
      clubDataId: textOrNull(row.clubDataId),
      name: textOrNull(row.clubName),
      managed: numberOrNull(row.managed),
      stadium: textOrNull(row.stadium),
      stadiumSize: numberOrNull(row.stadiumSize),
      position: numberOrNull(row.newPosition) ?? index + 1,
      previousPosition: numberOrNull(row.oldPosition),
      played: numberOrNull(row.played),
      won: numberOrNull(row.won),
      drawn: numberOrNull(row.drawn),
      lost: numberOrNull(row.lost),
      goalsFor: numberOrNull(row.goalsFor),
      goalsAgainst: numberOrNull(row.goalsAgainst),
      goalDifference: numberOrNull(row.goalDifference),
      points: numberOrNull(row.points),
      attendance: numberOrNull(tables?._attendance?.[row.clubId]),
      form: asArray(tables?._form?.[row.clubId]).map((entry) => Number(entry)),
    };
  });
}

function normalizeFixture(record, competition, fixtureDate, kind) {
  if (!record) return null;
  return {
    sourceId: textOrNull(record.fixID),
    competition,
    kind,
    fixtureDate: textOrNull(fixtureDate),
    played: Number(record.played || 0) === 1,
    homeClubId: textOrNull(record.homeTeam),
    homeName: textOrNull(record.homeName),
    homeScore: numberOrNull(record.homeScore),
    awayClubId: textOrNull(record.awayTeam),
    awayName: textOrNull(record.awayName),
    awayScore: numberOrNull(record.awayScore),
    homeManaged: numberOrNull(record.homeManaged),
    awayManaged: numberOrNull(record.awayManaged),
    homePenaltyScore: numberOrNull(record.homePenScore),
    awayPenaltyScore: numberOrNull(record.awayPenScore),
    isLeg2: booleanFlag(record.isLeg2),
  };
}

export function normalizeCompetitionSnapshot(input) {
  const tables = input?.tables || {};
  const leagueIds = asArray(tables._leagueID);
  const leagueNames = asArray(tables._leagueName);
  const divisions = leagueIds.map((leagueId, index) => ({
    leagueId: textOrNull(leagueId),
    division: numberOrNull(tables._division?.[index]) ?? index + 1,
    name: textOrNull(leagueNames[index]) || `Division ${index + 1}`,
    promoted: numberOrNull(tables._numPromoted?.[index]),
    relegated: numberOrNull(tables._numRelegated?.[index]),
    rounds: numberOrNull(tables._numRounds?.[index]),
    standings: zipLeagueRows(tables, leagueId),
  }));

  const resultRows = Object.entries(input?.results?._data || {}).flatMap(([competition, rows]) =>
    asArray(rows).map((row) => normalizeFixture(row, competition, input?.results?.turnDate, 'result')).filter(Boolean)
  );
  const fixtureRows = Object.entries(input?.fixtures?._data || {}).flatMap(([competition, rows]) =>
    asArray(rows).map((row) => normalizeFixture(row, competition, input?.fixtures?.turnDate, 'fixture')).filter(Boolean)
  );

  const customerFiles = input?.customerFileNames || {};
  const managers = Object.entries(customerFiles).map(([clubId, entry]) => ({
    clubId,
    managerId: textOrNull(entry?.customerID),
    firstName: textOrNull(entry?.Firstname),
    surname: textOrNull(entry?.Surname),
    displayName: [entry?.Firstname, entry?.Surname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim() || null,
  }));

  const history = asArray(input?.compInfo?._seasonCount?.[0]).map((season, index) => ({
    season: numberOrNull(season),
    seasonId: textOrNull(input?.compInfo?._seasonIDs?.[0]?.[index]),
    winnerClubId: textOrNull(input?.compInfo?._winnersIDs?.[0]?.[index]),
    winnerClubName: textOrNull(input?.compInfo?._winnersNames?.[0]?.[index]),
    winnerManagerId: textOrNull(input?.compInfo?._winnerManagerIDs?.[0]?.[index]),
    winnerManagerName: textOrNull(input?.compInfo?._winnerManagerName?.[0]?.[index]),
  }));

  return {
    kind: 'competition',
    world: {
      setupId: textOrNull(input?.gwData?.setupID),
      countryCode: textOrNull(input?.ownCountryCode),
      divisionCount: numberOrNull(tables.numDivisions),
      teamCount: numberOrNull(tables._numTeams),
      setupTypeId: textOrNull(tables.SetupTypeID),
    },
    divisions,
    managers,
    results: resultRows,
    fixtures: fixtureRows,
    history,
    playerLeaders: asArray(input?.playerTables?._playerId).map((playerId, index) => ({
      playerId: textOrNull(playerId),
      firstName: textOrNull(input?.playerTables?._firstName?.[index]),
      surname: textOrNull(input?.playerTables?._surname?.[index]),
      clubId: textOrNull(input?.playerTables?._clubId?.[index]),
      clubName: textOrNull(input?.playerTables?._clubName?.[index]),
      appearances: numberOrNull(input?.playerTables?._appearances?.[index]),
      goals: numberOrNull(input?.playerTables?._numGoals?.[index]),
      averageRating: numberOrNull(input?.playerTables?._aveRating?.[index]),
    })),
  };
}

export function normalizePlayerChanges(input) {
  const normalise = (record, kind) => ({
    kind,
    playerId: textOrNull(record.PlayerID ?? record.PlayerDataID),
    name: textOrNull(record.PlayerName),
    age: numberOrNull(record.PlayerAge),
    clubId: textOrNull(record.ClubID),
    clubName: textOrNull(record.playerClubName),
    managed: numberOrNull(record.IsManaged),
    nationality: textOrNull(record.playerscountryname ?? record.PlayerNat),
    rating: numberOrNull(record.PlayerRating),
    oldRating: numberOrNull(record.PlayerOldRating),
    newRating: numberOrNull(record.New),
    ratingDifference: numberOrNull(record.Diff),
    changeType: textOrNull(record.ChangeType ?? (kind === 'new' ? 'NewPlayer' : null)),
    changeLabel: textOrNull(record.ChangeTypeText ?? (kind === 'new' ? 'New player' : null)),
    position: cleanPosition(record.LiveMultiPositionDis),
    positionId: numberOrNull(record.playerpositionid),
    oldPositionId: numberOrNull(record.PlayerPosOld ?? record.OldRaw),
    newPositionId: numberOrNull(record.NewRaw ?? record.playerpositionid),
    value: numberOrNull(record.valueraw),
    photo: textOrNull(record.PhotoFilename),
  });

  return {
    kind: 'playerChanges',
    changes: asArray(input?.changes).map((record) => normalise(record, 'change')),
    newPlayers: asArray(input?.new).map((record) => normalise(record, 'new')),
  };
}

export function normalizeTransfers(input) {
  return {
    kind: 'transfers',
    turn: numberOrNull(input?.Turn?.TurnNum),
    summary: {
      count: textOrNull(input?.Summary?.NumTransfers),
      totalAmountSpent: stripHtml(input?.Summary?.TotalAmountSpent),
      averageSpend: stripHtml(input?.Summary?.AverageSpend),
      highestSpend: stripHtml(input?.Summary?.HighestSpend),
    },
    transfers: asArray(input?.Transfers).map((record) => ({
      transferId: textOrNull(record.TransferID),
      playerId: textOrNull(record.PlayerDataID),
      playerName: textOrNull(record.PlayerName),
      playerSurname: textOrNull(record.PlayerSurname),
      rating: numberOrNull(record.PlayerRating),
      age: numberOrNull(record.Age),
      nationality: textOrNull(record.CountryName),
      position: cleanPosition(record.PositionDis),
      fromClubId: textOrNull(record.ClubFromID),
      fromClubName: textOrNull(record.ClubFromName),
      toClubId: textOrNull(record.ClubToID),
      toClubName: textOrNull(record.ClubToName),
      fromManagerId: textOrNull(record.CustomerID1),
      toManagerId: textOrNull(record.CustomerID2),
      playerValue: numberOrNull(record.Value),
      amount: numberOrNull(record.Amount),
      acceptedDate: textOrNull(record.AcceptDate),
      status: numberOrNull(record.Status),
      statusLabel: stripHtml(record.TransferInfoDis),
      illegal: booleanFlag(record.Ilegal),
      illegalReason: textOrNull(record.IlegalReason),
      playerOffers: [
        nonZeroId(record.PlayerOffer1DataID) ? { playerId: nonZeroId(record.PlayerOffer1DataID), name: textOrNull(record.PlayerOffer1Name) } : null,
        nonZeroId(record.PlayerOffer2DataID) ? { playerId: nonZeroId(record.PlayerOffer2DataID), name: textOrNull(record.PlayerOffer2Name) } : null,
      ].filter(Boolean),
    })),
  };
}

export function normalizeClubFinance(input) {
  return {
    kind: 'clubFinance',
    season: {
      startingBalance: numberOrNull(input?._seasonStartingBalanceRaw ?? input?._seasonStartingBalance),
      balance: numberOrNull(input?._seasonBalance),
      totalIncome: numberOrNull(input?._seasonTotalIn),
      totalOutgoings: numberOrNull(input?._seasonTotalOut),
      profit: numberOrNull(input?._seasonProfitRaw ?? input?._seasonProfit),
      transfersIn: numberOrNull(input?._seasonTransfersIn),
      transfersOut: numberOrNull(input?._seasonTransfersOut),
      wages: numberOrNull(input?._seasonPlayerWages),
      gateReceipts: numberOrNull(input?._seasonGateReceipts),
      tvRevenue: numberOrNull(input?._seasonTVRevenue),
      sponsor: numberOrNull(input?._seasonSponsor),
    },
    weekly: asArray(input?.Weekly).map((week) => ({
      weekStart: textOrNull(week._weekStartDate),
      income: numberOrNull(week._weeklyTotalIn),
      outgoings: numberOrNull(week._weeklyTotalOut),
      balance: numberOrNull(week._weeklyBalance),
      wages: numberOrNull(week._weeklyPlayerWages),
      transfersIn: numberOrNull(week._weeklyTransfersIn),
      transfersOut: numberOrNull(week._weeklyTransfersOut),
      gateReceipts: numberOrNull(week._weeklyGateReceipts),
      tvRevenue: numberOrNull(week._weeklyTVRevenue),
    })),
  };
}

export function detectSoccerManagerPayload(input) {
  if (input?.gwData && input?.tables && (input?.results || input?.fixtures)) return 'competition';
  if (Array.isArray(input?.changes) || Array.isArray(input?.new)) return 'playerChanges';
  if (Array.isArray(input?.Transfers)) return 'transfers';
  if (Array.isArray(input?.Weekly) && ('_seasonBalance' in input || '_seasonTotalIn' in input)) return 'clubFinance';
  return null;
}

export function normalizeSoccerManagerPayload(input) {
  switch (detectSoccerManagerPayload(input)) {
    case 'competition': return normalizeCompetitionSnapshot(input);
    case 'playerChanges': return normalizePlayerChanges(input);
    case 'transfers': return normalizeTransfers(input);
    case 'clubFinance': return normalizeClubFinance(input);
    default: throw new Error('Unsupported Soccer Manager JSON response.');
  }
}

export function summarizeNormalizedPayload(payload) {
  if (!payload) return {};
  if (payload.kind === 'competition') {
    return {
      type: 'Competition snapshot',
      world: payload.world.setupId,
      divisions: payload.divisions.length,
      clubs: payload.divisions.reduce((sum, division) => sum + division.standings.length, 0),
      managers: payload.managers.length,
      results: payload.results.length,
      fixtures: payload.fixtures.length,
      history: payload.history.length,
      playerLeaders: payload.playerLeaders.length,
    };
  }
  if (payload.kind === 'playerChanges') {
    return { type: 'Player changes', changes: payload.changes.length, newPlayers: payload.newPlayers.length };
  }
  if (payload.kind === 'transfers') {
    return { type: 'Transfer market', turn: payload.turn, transfers: payload.transfers.length, total: payload.summary.count };
  }
  if (payload.kind === 'clubFinance') {
    return { type: 'Club finance', weeks: payload.weekly.length, seasonBalance: payload.season.balance, seasonProfit: payload.season.profit };
  }
  return { type: payload.kind };
}
