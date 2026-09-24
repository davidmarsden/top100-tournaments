function text(value) {
  if (value === null || value === undefined) return null;
  const out = String(value).trim();
  return out || null;
}

function number(value) {
  if (value === null || value === undefined || value === '') return null;
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function attrs(node) {
  const out = {};
  for (const attr of Array.from(node?.attributes || [])) out[attr.name] = attr.value;
  return out;
}

function playerRef(value) {
  const raw = text(value);
  if (!raw) return null;
  const parts = raw.split(',');
  return {
    playerId: text(parts[0]),
    firstName: text(parts[1]),
    surname: text(parts.slice(2).join(',')),
  };
}

function extractHtmlPlayerIds(value) {
  const raw = String(value || '');
  return [...raw.matchAll(/player\.php\?pid=(\d+)/gi)].map((match) => match[1]);
}

function parsePageContext(pageUrl) {
  try {
    const url = new URL(pageUrl);
    return {
      setupId: text(url.searchParams.get('sid')),
      selectedClubId: text(url.searchParams.get('clubid')),
    };
  } catch {
    return { setupId: null, selectedClubId: null };
  }
}

function xmlDocument(xml) {
  if (typeof DOMParser === 'undefined') {
    throw new Error('Match replay parsing requires DOMParser in the browser.');
  }
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Soccer Manager match replay XML could not be parsed.');
  return doc;
}

function scoreFromKeyEvents(keyEvents) {
  let home = 0;
  let away = 0;
  for (const event of keyEvents) {
    if (event.type !== 'goal') continue;
    if (event.clubSide === 'h') home += 1;
    if (event.clubSide === 'a') away += 1;
  }
  return { home, away };
}

function chanceFromComm(comm, index) {
  const minute = number(comm.getAttribute('t'));
  const teamSide = text(comm.getAttribute('team'));
  const chanceGroup = Array.from(comm.children).find((node) => node.tagName === 'grp' && node.getAttribute('type') === 'chance');
  if (!chanceGroup) return null;
  const lines = Array.from(chanceGroup.children).filter((node) => node.tagName === 'ln');
  const shot = lines.find((node) => node.getAttribute('type') === 'shot') || null;
  const outcome = lines.find((node) => ['goal', 'save', 'miss', 'offside'].includes(node.getAttribute('type'))) || null;
  const assist = lines.find((node) => node.getAttribute('type') === 'assist') || null;
  const source = outcome || shot || assist;
  if (!source) return null;
  const outcomeType = text(outcome?.getAttribute('type')) || 'chance';
  return {
    sequence: index,
    minute,
    teamSide,
    type: 'chance',
    outcome: outcomeType,
    player: playerRef(source.getAttribute('p1') || shot?.getAttribute('p1') || assist?.getAttribute('p1')),
    secondaryPlayer: playerRef(source.getAttribute('p2') || shot?.getAttribute('p2') || assist?.getAttribute('p2')),
    goalkeeper: playerRef(source.getAttribute('k') || shot?.getAttribute('k') || assist?.getAttribute('k')),
    attackType: number(outcome?.getAttribute('at')),
    details2D: text(outcome?.getAttribute('details2D')),
    shotText: text(shot?.textContent),
    outcomeText: text(outcome?.textContent),
  };
}

function substitutionsFromComm(comm, index) {
  if (comm.getAttribute('type') !== 'prekickoff') return null;
  const minute = number(comm.getAttribute('t'));
  const teamSide = text(comm.getAttribute('team'));
  const lines = Array.from(comm.querySelectorAll('ln')).map((node) => String(node.textContent || ''));
  const leavingLine = lines.find((line) => /leaving the action/i.test(line));
  const replacingLine = lines.find((line) => /to replace them/i.test(line));
  if (!leavingLine || !replacingLine) return null;
  return {
    sequence: index,
    minute,
    teamSide,
    type: 'substitution_batch',
    offPlayerIds: extractHtmlPlayerIds(leavingLine),
    onPlayerIds: extractHtmlPlayerIds(replacingLine),
  };
}

export function normalizeSoccerManagerMatchReplay(xml, pageUrl) {
  const sourceXml = text(xml);
  if (!sourceXml) throw new Error('Match replay XML is empty.');
  const doc = xmlDocument(sourceXml);
  const root = doc.querySelector('liveMatchData');
  if (!root) throw new Error('This is not a Soccer Manager liveMatchData replay.');

  const page = parsePageContext(pageUrl);
  const mfix = root.querySelector(':scope > mfix');
  if (!mfix) throw new Error('Match replay is missing its match fixture block.');

  const homeName = text(mfix.querySelector(':scope > h')?.textContent);
  const awayName = text(mfix.querySelector(':scope > a')?.textContent);
  const competitionCode = text(mfix.querySelector(':scope > ns')?.textContent);

  const clubs = new Map(
    Array.from(root.querySelectorAll(':scope > gwc')).map((node) => [
      text(node.getAttribute('id')),
      text(node.getAttribute('name')),
    ]),
  );

  const worldFixtures = Array.from(root.querySelectorAll(':scope > gwfd > gwf')).map((node) => ({
    fixtureId: text(node.getAttribute('fix')),
    homeClubId: text(node.getAttribute('h')),
    awayClubId: text(node.getAttribute('a')),
  }));

  let fixture = worldFixtures.find((row) => clubs.get(row.homeClubId) === homeName && clubs.get(row.awayClubId) === awayName) || null;
  if (!fixture && page.selectedClubId) {
    const candidates = worldFixtures.filter((row) => row.homeClubId === page.selectedClubId || row.awayClubId === page.selectedClubId);
    if (candidates.length === 1) fixture = candidates[0];
  }
  if (!fixture?.fixtureId) throw new Error('Could not identify the current Soccer Manager fixture id from the replay.');

  const keyEvents = [];
  let keySequence = 0;
  for (const group of Array.from(root.querySelectorAll(':scope > kevs > kevg'))) {
    const minute = number(group.getAttribute('t'));
    for (const node of Array.from(group.querySelectorAll(':scope > kev'))) {
      keyEvents.push({
        sequence: keySequence++,
        minute,
        type: text(node.getAttribute('type')),
        clubSide: text(node.getAttribute('club')),
        playerId: text(node.getAttribute('pid')),
        secondaryPlayerId: text(node.getAttribute('pid2')),
        goalType: text(node.getAttribute('gt')),
        attackType: text(node.getAttribute('at')),
      });
    }
  }

  const players = Array.from(mfix.querySelectorAll(':scope > p')).map((node) => ({
    playerId: text(node.getAttribute('id')),
    teamSide: text(node.getAttribute('c')),
    name: text(node.getAttribute('n')),
  })).filter((row) => row.playerId);

  const chances = [];
  const substitutions = [];
  Array.from(root.querySelectorAll(':scope > comm')).forEach((comm, index) => {
    if (comm.getAttribute('type') === 'chance') {
      const chance = chanceFromComm(comm, index);
      if (chance) chances.push(chance);
    }
    const subs = substitutionsFromComm(comm, index);
    if (subs) substitutions.push(subs);
  });

  const domination = Array.from(root.querySelectorAll(':scope > dm')).map((node) => ({
    minute: number(node.getAttribute('t')),
    leftValue: number(node.getAttribute('l')),
  })).filter((row) => row.minute !== null && row.leftValue !== null);

  const worldScores = [];
  let worldScoreSequence = 0;
  for (const group of Array.from(root.querySelectorAll(':scope > gwst'))) {
    const minute = number(group.getAttribute('t'));
    for (const node of Array.from(group.querySelectorAll(':scope > gws'))) {
      worldScores.push({
        sequence: worldScoreSequence++,
        minute,
        fixtureId: text(node.getAttribute('fix')),
        teamSide: text(node.getAttribute('c')),
        competitionCode: text(node.getAttribute('div')),
        playerId: text(node.getAttribute('p')),
        playerName: text(node.getAttribute('pname')),
      });
    }
  }

  const competitionName = text(
    Array.from(root.querySelectorAll(':scope > gwd'))
      .find((node) => text(node.getAttribute('ns')) === competitionCode)
      ?.getAttribute('nl'),
  );

  const score = scoreFromKeyEvents(keyEvents);

  return {
    kind: 'matchReplay',
    source: {
      setupId: page.setupId,
      fixtureId: fixture.fixtureId,
      pageUrl: pageUrl || null,
    },
    competition: {
      code: competitionCode,
      name: competitionName,
    },
    fixture: {
      homeClubId: fixture.homeClubId,
      homeName,
      awayClubId: fixture.awayClubId,
      awayName,
      homeScore: score.home,
      awayScore: score.away,
    },
    players,
    keyEvents,
    chances,
    substitutions,
    domination,
    worldFixtures,
    worldScores,
  };
}

export function summarizeMatchReplay(payload) {
  if (!payload || payload.kind !== 'matchReplay') return {};
  return {
    fixtureId: payload.source?.fixtureId || '—',
    match: `${payload.fixture?.homeName || '?'} ${payload.fixture?.homeScore ?? '—'}–${payload.fixture?.awayScore ?? '—'} ${payload.fixture?.awayName || '?'}`,
    players: payload.players?.length || 0,
    keyEvents: payload.keyEvents?.length || 0,
    chances: payload.chances?.length || 0,
    dominationMinutes: payload.domination?.length || 0,
  };
}
