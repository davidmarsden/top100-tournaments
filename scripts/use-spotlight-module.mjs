import fs from 'node:fs';

const path = 'src/components/PublicTournamentPage.jsx';
let text = fs.readFileSync(path, 'utf8');

if (!text.includes("../lib/spotlights")) {
  text = text.replace(
    "import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';",
    "import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';\nimport { fixtureSpotlights as buildFixtureSpotlights } from '../lib/spotlights';"
  );
}

text = text.replace(
  'const featured = useMemo(() => fixtureSpotlights(datedMatches, entries, honours, tables, tournamentId), [datedMatches, entries, honours, tables, tournamentId]);',
  'const featured = useMemo(() => buildFixtureSpotlights(datedMatches, entries, honours, tables, tournamentId), [datedMatches, entries, honours, tables, tournamentId]);'
);

text = text.replaceAll('major scalp', 'statement result');
text = text.replace(
  "story: `${managerName(managerEntry)} has ${managerEntry.teams?.name || 'his side'} in one of the round's sharper storylines.`",
  "story: `${managerName(managerEntry)} and ${managerEntry.teams?.name || 'his side'} are worth watching here.`"
);

fs.writeFileSync(path, text);
