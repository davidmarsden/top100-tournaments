import fs from 'node:fs';

const path = 'netlify/functions/challonge-import.js';
let text = fs.readFileSync(path, 'utf8');

const oldMaps = `  const participantToEntry = new Map();
  const participantNameToEntry = new Map();
  bundle.parsedParticipants.forEach((p) => {
    const entryId = entryByTeam.get(teamMap.get(p.teamName));
    [p.challongeParticipantId, ...p.aliases].forEach((alias) => {
      addId(new Set(), alias);
      const clean = s(alias);
      const normalized = normalAlias(alias);
      if (clean) participantToEntry.set(clean, entryId);
      if (normalized) participantToEntry.set(normalized, entryId);
      const digits = clean.match(/\\d+/g)?.join('');
      if (digits) participantToEntry.set(digits, entryId);
    });
    [p.teamName, participantName(bundle.participants.find((raw) => itemId(raw) === p.challongeParticipantId))].filter(Boolean).forEach((name) => participantNameToEntry.set(normalAlias(name), entryId));
  });`;

const newMaps = `  const participantToEntry = new Map();
  const participantNameToEntry = new Map();
  const participantToTeamName = new Map();
  const entryToTeamName = new Map();
  bundle.parsedParticipants.forEach((p) => {
    const entryId = entryByTeam.get(teamMap.get(p.teamName));
    if (entryId) entryToTeamName.set(entryId, p.teamName);
    [p.challongeParticipantId, ...p.aliases].forEach((alias) => {
      addId(new Set(), alias);
      const clean = s(alias);
      const normalized = normalAlias(alias);
      if (clean) {
        participantToEntry.set(clean, entryId);
        participantToTeamName.set(clean, p.teamName);
      }
      if (normalized) {
        participantToEntry.set(normalized, entryId);
        participantToTeamName.set(normalized, p.teamName);
      }
      const digits = clean.match(/\\d+/g)?.join('');
      if (digits) {
        participantToEntry.set(digits, entryId);
        participantToTeamName.set(digits, p.teamName);
      }
    });
    [p.teamName, participantName(bundle.participants.find((raw) => itemId(raw) === p.challongeParticipantId))].filter(Boolean).forEach((name) => participantNameToEntry.set(normalAlias(name), entryId));
  });`;

if (!text.includes(oldMaps)) throw new Error('Participant map block not found');
text = text.replace(oldMaps, newMaps);

const oldResolverEnd = `  function resolveEntry(match, side) {
    const aliases = side === 1
      ? relationAliases(match, 'player1', 'player1_id', 'player1Id', 'participant1', 'participant1_id', 'participant1Id')
      : relationAliases(match, 'player2', 'player2_id', 'player2Id', 'participant2', 'participant2_id', 'participant2Id');
    for (const alias of aliases) {
      const direct = participantToEntry.get(s(alias)) || participantToEntry.get(normalAlias(alias));
      if (direct) return direct;
    }
    for (const name of relationNames(match, side)) {
      const byName = participantNameToEntry.get(normalAlias(name));
      if (byName) return byName;
    }
    return null;
  }`;

const newResolverEnd = `  function resolveEntry(match, side) {
    const aliases = side === 1
      ? relationAliases(match, 'player1', 'player1_id', 'player1Id', 'participant1', 'participant1_id', 'participant1Id')
      : relationAliases(match, 'player2', 'player2_id', 'player2Id', 'participant2', 'participant2_id', 'participant2Id');
    for (const alias of aliases) {
      const direct = participantToEntry.get(s(alias)) || participantToEntry.get(normalAlias(alias));
      if (direct) return direct;
    }
    for (const name of relationNames(match, side)) {
      const byName = participantNameToEntry.get(normalAlias(name));
      if (byName) return byName;
    }
    return null;
  }

  function resolveTeamName(match, side, entryId) {
    if (entryId && entryToTeamName.get(entryId)) return entryToTeamName.get(entryId);
    const aliases = side === 1
      ? relationAliases(match, 'player1', 'player1_id', 'player1Id', 'participant1', 'participant1_id', 'participant1Id')
      : relationAliases(match, 'player2', 'player2_id', 'player2Id', 'participant2', 'participant2_id', 'participant2Id');
    for (const alias of aliases) {
      const name = participantToTeamName.get(s(alias)) || participantToTeamName.get(normalAlias(alias));
      if (name) return name;
    }
    const embeddedName = relationNames(match, side)[0];
    return embeddedName ? parseTeamAndManager(embeddedName).teamName : null;
  }`;

if (!text.includes(oldResolverEnd)) throw new Error('Resolver block not found');
text = text.replace(oldResolverEnd, newResolverEnd);

text = text.replace(
  `    const homeEntryId = resolveEntry(match, 1);
    const awayEntryId = resolveEntry(match, 2);`,
  `    const homeEntryId = resolveEntry(match, 1);
    const awayEntryId = resolveEntry(match, 2);
    const homeTeamName = resolveTeamName(match, 1, homeEntryId);
    const awayTeamName = resolveTeamName(match, 2, awayEntryId);`
);

text = text.replace(
  `      home_placeholder: homeEntryId ? null : (relationNames(match, 1)[0] || (player1Aliases[0] ? \`Challonge participant \${player1Aliases[0]}\` : 'TBC')),
      away_placeholder: awayEntryId ? null : (relationNames(match, 2)[0] || (player2Aliases[0] ? \`Challonge participant \${player2Aliases[0]}\` : 'TBC')),`,
  `      home_placeholder: homeTeamName || (player1Aliases[0] ? \`Challonge participant \${player1Aliases[0]}\` : 'TBC'),
      away_placeholder: awayTeamName || (player2Aliases[0] ? \`Challonge participant \${player2Aliases[0]}\` : 'TBC'),`
);

fs.writeFileSync(path, text);
