import fs from 'node:fs';

const candidates = [
  'netlify/functions/lib/challongeImporter.js',
  'netlify/functions/challonge-import.js',
];

const path = candidates.find((candidate) => fs.existsSync(candidate));
if (!path) {
  throw new Error(`Challonge importer not found. Checked: ${candidates.join(', ')}`);
}

const text = fs.readFileSync(path, 'utf8');

const storesParticipantTeamNames =
  text.includes('const participantToTeam = new Map()')
  || text.includes('const participantToTeamName = new Map()');

const writesHomeTeamFallback =
  /home_placeholder:\s*(homeName|homeTeamName)\s*\|\|/.test(text);

const writesAwayTeamFallback =
  /away_placeholder:\s*(awayName|awayTeamName)\s*\|\|/.test(text);

if (storesParticipantTeamNames && writesHomeTeamFallback && writesAwayTeamFallback) {
  console.log(`Challonge team-name fallbacks are already present in ${path}.`);
  process.exit(0);
}

throw new Error(
  `Challonge importer found at ${path}, but the expected team-name fallback implementation is missing. `
  + 'Update the importer directly rather than relying on the retired text-replacement patch.',
);
