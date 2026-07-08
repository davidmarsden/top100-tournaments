import fs from 'node:fs';

const path = 'src/components/PublicTournamentPage.jsx';
let text = fs.readFileSync(path, 'utf8');

text = text.replace("import KnockoutBracket from './KnockoutBracket.jsx';\n", "import KnockoutBracket from './KnockoutBracket.jsx';\nimport MatchComments from './MatchComments.jsx';\n");
text = text.replace('<FeaturedMatch key={match.id} match={match} />', '<FeaturedMatch key={match.id} match={match} tournamentId={tournamentId} />');
text = text.replace('<ResultSections sections={groupResults} />', '<ResultSections sections={groupResults} tournamentId={tournamentId} />');
text = text.replace('<ResultSections sections={knockoutResults} />', '<ResultSections sections={knockoutResults} tournamentId={tournamentId} />');
text = text.replace(
  'function FeaturedMatch({ match }) { return <article className={`featured-match-card spotlight-match-card spotlight-${match.spotlightType || \'default\'}`}><span>{match.spotlightTag || (match.stage === \'knockout\' ? `${match.bracket || \'Cup\'} · ${roundLabel(match.round)}` : `${match.groups?.code ? `Group ${match.groups.code}` : \'Group stage\'} · ${match.round}`)}</span><strong>{fixtureTitle(match)}</strong><small>{formatDate(match.fixture_date)} · {countdownText(match)}</small>{match.spotlightStory && <p>{match.spotlightStory}</p>}</article>; }',
  'function FeaturedMatch({ match, tournamentId }) { return <article className={`featured-match-card spotlight-match-card spotlight-${match.spotlightType || \'default\'}`}><span>{match.spotlightTag || (match.stage === \'knockout\' ? `${match.bracket || \'Cup\'} · ${roundLabel(match.round)}` : `${match.groups?.code ? `Group ${match.groups.code}` : \'Group stage\'} · ${match.round}`)}</span><strong>{fixtureTitle(match)}</strong><small>{formatDate(match.fixture_date)} · {countdownText(match)}</small>{match.spotlightStory && <p>{match.spotlightStory}</p>}<MatchComments match={match} tournamentId={tournamentId} compact /></article>; }'
);
text = text.replace(
  'function ResultSections({ sections }) {',
  'function ResultSections({ sections, tournamentId }) {'
);
text = text.replace(
  '<div className="fixture-actions"><span>{roundLabel(match.round)}{match.leg ? ` · ${Number(match.leg) === 1 ? \'1st leg\' : \'2nd leg\'}` : \'\'}</span></div></article>)}</div></section>; })}</div>; }',
  '<div className="fixture-actions"><span>{roundLabel(match.round)}{match.leg ? ` · ${Number(match.leg) === 1 ? \'1st leg\' : \'2nd leg\'}` : \'\'}</span></div><MatchComments match={match} tournamentId={tournamentId} compact /></article>)}</div></section>; })}</div>; }'
);

fs.writeFileSync(path, text);
