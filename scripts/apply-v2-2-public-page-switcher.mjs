import fs from 'node:fs';

const pagePath = 'src/components/PublicTournamentPage.jsx';
let page = fs.readFileSync(pagePath, 'utf8');

if (!page.includes("./PublicTournamentSwitcher.jsx")) {
  page = page.replace(
    "import WinnersArchive from './WinnersArchive.jsx';\n",
    "import WinnersArchive from './WinnersArchive.jsx';\nimport PublicTournamentSwitcher from './PublicTournamentSwitcher.jsx';\n"
  );
}

page = page.replace(
  'export default function PublicTournamentPage({ tournamentId }) {',
  'export default function PublicTournamentPage({ tournamentId, routeRows = [] }) {'
);

page = page.replace(
  "const tournamentResult = await supabase.from('tournaments').select('id, name, status, rules_notes, secondary_bracket_name, max_entries, actual_entries, group_count, teams_per_group, knockout_teams').eq('id', tournamentId).maybeSingle();",
  "let tournamentResult = await supabase.from('tournaments').select('id, name, status, rules_notes, secondary_bracket_name, max_entries, actual_entries, group_count, teams_per_group, knockout_teams, season_number, public_slug, slug, is_public, registration_status, game_worlds(id, name, slug), competition_types(id, name, slug)').eq('id', tournamentId).maybeSingle();\n    if (tournamentResult.error) tournamentResult = await supabase.from('tournaments').select('id, name, status, rules_notes, secondary_bracket_name, max_entries, actual_entries, group_count, teams_per_group, knockout_teams').eq('id', tournamentId).maybeSingle();"
);

page = page.replace(
  "<section className=\"hero tournament-hero\"><p className=\"eyebrow\">Top 100 Youth Cup Hub</p><h1>{tournament.name}</h1><p>{tournament.status || 'draft'} · {stats.played} results · {stats.remaining} fixtures remaining · {stats.goals} goals</p><div className=\"hero-countdown\"><span>Next fixture</span><strong>{nextFixture ? countdownText(nextFixture) : 'Complete'}</strong><small>{nextFixture ? `${formatDate(nextFixture.fixture_date)} · ${fixtureTitle(nextFixture)}` : 'No upcoming fixtures listed'}</small></div></section>",
  "<section className=\"hero tournament-hero\"><p className=\"eyebrow\">{tournament.game_worlds?.name || 'Top 100'} · {tournament.competition_types?.name || 'Youth Cup'} Hub</p><h1>{tournament.name}</h1><p>{tournament.status || 'draft'} · {stats.played} results · {stats.remaining} fixtures remaining · {stats.goals} goals</p><div className=\"hero-countdown\"><span>Next fixture</span><strong>{nextFixture ? countdownText(nextFixture) : 'Complete'}</strong><small>{nextFixture ? `${formatDate(nextFixture.fixture_date)} · ${fixtureTitle(nextFixture)}` : 'No upcoming fixtures listed'}</small></div></section>\n    <PublicTournamentSwitcher routes={routeRows} currentTournament={tournament} />"
);

fs.writeFileSync(pagePath, page);

const cssPath = 'src/tournament-hub.css';
let css = fs.readFileSync(cssPath, 'utf8');
if (!css.includes('.public-tournament-switcher')) {
  css += `\n.public-tournament-switcher { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin: -8px 0 18px; padding: 14px; border: 1px solid #dce5f5; border-radius: 24px; background: rgba(255,255,255,0.92); box-shadow: 0 16px 36px rgba(21, 39, 75, 0.08); backdrop-filter: blur(10px); }\n.public-tournament-switcher label { margin: 0; color: #5f6f8e; font-size: 0.78rem; font-weight: 950; text-transform: uppercase; letter-spacing: 0.08em; }\n.public-tournament-switcher select { margin-top: 6px; min-height: 46px; border-radius: 16px; font-size: 1rem; font-weight: 900; text-transform: none; letter-spacing: 0; color: #172033; }\n@media (max-width: 820px) { .public-tournament-switcher { border-radius: 18px; } }\n`;
  fs.writeFileSync(cssPath, css);
}
