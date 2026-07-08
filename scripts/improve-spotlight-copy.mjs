import fs from 'node:fs';

const path = 'src/components/PublicTournamentPage.jsx';
let text = fs.readFileSync(path, 'utf8');

const start = text.indexOf('function decorateSpotlight(');
const end = text.indexOf('function fixtureSpotlights(', start);
if (start === -1 || end === -1) {
  throw new Error('Could not locate decorateSpotlight block');
}

const replacement = `function describeManager(entry) {
  const manager = managerName(entry);
  const club = entry?.teams?.name || 'their side';
  return manager && manager !== 'TBC' ? \`${'${manager}'}’s ${'${club}'}\` : club;
}
function pickHomeUnderdog(match, homePrestige, awayPrestige, homeEntry, awayEntry) {
  const homeSeed = homePrestige.topSeed || 9999;
  const awaySeed = awayPrestige.topSeed || 9999;
  const seedGap = homeSeed - awaySeed;
  if (seedGap >= 14 && awaySeed <= 16) return { underdog: homeEntry, favourite: awayEntry, seedGap };
  return null;
}
function decorateSpotlight(match, pressure, prestige, entriesMap) {
  const homeEntry = entriesMap.get(entryKey(match.home_entry_id));
  const awayEntry = entriesMap.get(entryKey(match.away_entry_id));
  const home = prestige.get(entryKey(match.home_entry_id)) || { score: 0, reasons: [], storyTypes: new Set(), topSeed: 9999 };
  const away = prestige.get(entryKey(match.away_entry_id)) || { score: 0, reasons: [], storyTypes: new Set(), topSeed: 9999 };
  const group = match.groups?.code || 'group';
  const homeLabel = describeEntry(homeEntry);
  const awayLabel = describeEntry(awayEntry);
  const holderEntry = home.storyTypes?.has('holder') ? homeEntry : away.storyTypes?.has('holder') ? awayEntry : null;
  const holderType = home.storyTypes?.has('holder') ? home : away.storyTypes?.has('holder') ? away : null;
  const homeUnderdog = pickHomeUnderdog(match, home, away, homeEntry, awayEntry);
  const pedigreeReasons = [...home.reasons, ...away.reasons].filter((reason) => !reason.includes('seed') && !reason.includes('holder')).slice(0, 2);
  const topSeedEntry = (home.topSeed || 9999) < (away.topSeed || 9999) ? homeEntry : awayEntry;
  const topSeed = Math.min(home.topSeed || 9999, away.topSeed || 9999);

  if (pressure.score >= 25) return { type: 'stakes', tag: pressure.tag, story: pressure.story };

  if (holderEntry) {
    const label = holderType?.shieldWins > holderType?.cupWins ? 'Shield holders' : 'Youth Cup holders';
    return { type: 'holder', tag: 'Holder watch', story: `${'${describeManager(holderEntry)}'} arrive as ${'${label}'}. The first job is simple enough: avoid becoming someone else’s headline.` };
  }

  if (homeUnderdog) {
    return { type: 'underdog', tag: 'Home underdog watch', story: `${'${describeManager(homeUnderdog.underdog)}'} have home advantage against ${'${describeManager(homeUnderdog.favourite)}'}. This is exactly the sort of tie where the favourite has to stay switched on.` };
  }

  if (match.stage === 'group' && topSeed <= 8) {
    return { type: 'seed', tag: 'Seed under pressure', story: `${'${describeManager(topSeedEntry)}'} are seeded to set the pace in Group ${'${group}'}. These are the fixtures favourites are expected to win cleanly.` };
  }

  if (homeEntry?.managers && awayEntry?.managers && managerName(homeEntry) !== 'TBC' && managerName(awayEntry) !== 'TBC') {
    return { type: 'manager', tag: 'Manager duel', story: `${'${managerName(homeEntry)}'} and ${'${managerName(awayEntry)}'} get a direct tactical read on each other here. The result may matter less than the message it sends.` };
  }

  if (pedigreeReasons.length) {
    return { type: 'pedigree', tag: 'Honours pedigree', story: `There is Youth Cup history on show here: ${'${pedigreeReasons.join(' and ')}'}. That gives this one a bit more weight than an ordinary group fixture.` };
  }

  if (match.stage === 'knockout') {
    return { type: 'knockout', tag: `${'${match.bracket || \'Cup\'}'} ${'${roundLabel(match.round)}'}`, story: `${'${homeLabel}'} against ${'${awayLabel}'}. No table maths now, just survive and move on.` };
  }

  return { type: 'spotlight', tag: `Group ${'${group}'} watch`, story: `${'${homeLabel}'} meet ${'${awayLabel}'} in a fixture that should help define the shape of Group ${'${group}'}.` };
}
`;

text = text.slice(0, start) + replacement + text.slice(end);
text = text.replace("const wantedTypes = ['holder', 'stakes', 'underdog', 'manager', 'pedigree', 'seed'];", "const wantedTypes = ['holder', 'stakes', 'underdog', 'seed', 'manager', 'pedigree', 'knockout', 'spotlight'];");
text = text.replace('major scalp', 'statement result');

fs.writeFileSync(path, text);
