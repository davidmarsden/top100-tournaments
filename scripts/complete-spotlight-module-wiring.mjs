import fs from 'node:fs';

const path = 'src/components/PublicTournamentPage.jsx';
let text = fs.readFileSync(path, 'utf8');

if (!text.includes("import { fixtureSpotlights as buildFixtureSpotlights } from '../lib/spotlights';")) {
  text = text.replace(
    "import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';",
    "import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';\nimport { fixtureSpotlights as buildFixtureSpotlights } from '../lib/spotlights';"
  );
}

text = text.replace(
  'const featured = useMemo(() => fixtureSpotlights(datedMatches, entries, honours, tables, tournamentId), [datedMatches, entries, honours, tables, tournamentId]);',
  'const featured = useMemo(() => buildFixtureSpotlights(datedMatches, entries, honours, tables, tournamentId), [datedMatches, entries, honours, tables, tournamentId]);'
);

const start = text.indexOf('\nfunction honourType(row)');
const end = text.indexOf('\nexport default function PublicTournamentPage', start);
if (start !== -1 && end !== -1) {
  text = text.slice(0, start) + text.slice(end);
}

text = text.replace("\nconst entryKey = (id) => String(id || '');", '');
text = text.replaceAll('major scalp', 'statement result');
text = text.replaceAll('get a shot at a statement result against', 'have a chance to unsettle');

fs.writeFileSync(path, text);
