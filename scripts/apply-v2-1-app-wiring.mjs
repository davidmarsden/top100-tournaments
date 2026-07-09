import fs from 'node:fs';

const path = 'src/App.jsx';
let text = fs.readFileSync(path, 'utf8');

function replaceOnce(source, search, replacement) {
  if (!source.includes(search)) throw new Error(`Pattern not found: ${search.slice(0, 80)}`);
  return source.replace(search, replacement);
}

if (!text.includes("./components/PublicTournamentRoute.jsx")) {
  text = text.replace(
    "import PublicTournamentPage from './components/PublicTournamentPage.jsx';\n",
    "import PublicTournamentPage from './components/PublicTournamentPage.jsx';\nimport PublicTournamentRoute from './components/PublicTournamentRoute.jsx';\n"
  );
}
if (!text.includes("./lib/tournamentSlugs")) {
  text = text.replace(
    "import { hasSupabaseConfig, supabase } from './lib/supabaseClient';\n",
    "import { hasSupabaseConfig, supabase } from './lib/supabaseClient';\nimport { publicTournamentPath, seasonNumberFromCode, seasonSlugFromCode, slugify } from './lib/tournamentSlugs';\n"
  );
}

text = text.replace(
  "const initialForm = { seasonCode: 'S28', competitionName: 'Youth Cup', tournamentName: 'S28 Youth Cup', maxEntries: 64, teamsPerGroup: 4, groupCount: 16, knockoutTeams: 32, secondaryBracketName: 'Shield' };",
  "const initialForm = { gameWorldName: 'Top 100', gameWorldSlug: 'top-100', seasonCode: 'S28', competitionName: 'Youth Cup', competitionSlug: 'youth-cup', tournamentName: 'S28 Youth Cup', maxEntries: 64, teamsPerGroup: 4, groupCount: 16, knockoutTeams: 32, secondaryBracketName: 'Shield', registrationStatus: 'closed' };"
);

text = text.replace(
  "function publicTournamentIdFromPath() { const match = window.location.pathname.match(/^\\/(?:tournaments|public)\\/(\\d+)\\/?$/); return match ? Number(match[1]) : null; }",
  "function publicTournamentIdFromPath() { const match = window.location.pathname.match(/^\\/(?:tournaments|public)\\/(\\d+)\\/?$/); return match ? Number(match[1]) : null; }\nfunction isLegacyHomePath() { return window.location.pathname === '/' || window.location.pathname === ''; }"
);

text = text.replace(
  "  if (!isAdminPath()) return <PublicTournamentPage tournamentId={defaultPublicTournamentId()} />;",
  "  if (!isAdminPath()) return <PublicTournamentRoute fallbackTournamentId={defaultPublicTournamentId()} />;"
);

text = text.replace(
  "    const { data, error } = await supabase.from('tournaments').select('id, name, status, max_entries, actual_entries, group_count, teams_per_group, knockout_teams, secondary_bracket_name, created_at').order('created_at', { ascending: false });\n    if (error) setStatus('Could not load tournaments: ' + error.message);\n    else { const ordered = sortTournaments(data || []); setTournaments(ordered); if (!selectedTournamentId && ordered[0]) setSelectedTournamentId(ordered[0].id); setBulkSelectedIds((ids) => ids.filter((id) => ordered.some((item) => item.id === id))); setStatus('Tournaments loaded'); }",
  "    const fullSelect = 'id, name, status, max_entries, actual_entries, group_count, teams_per_group, knockout_teams, secondary_bracket_name, created_at, season_number, public_slug, slug, is_public, registration_status, game_worlds(id, name, slug), competition_types(id, name, slug)';\n    let result = await supabase.from('tournaments').select(fullSelect).order('created_at', { ascending: false });\n    if (result.error) result = await supabase.from('tournaments').select('id, name, status, max_entries, actual_entries, group_count, teams_per_group, knockout_teams, secondary_bracket_name, created_at').order('created_at', { ascending: false });\n    const { data, error } = result;\n    if (error) setStatus('Could not load tournaments: ' + error.message);\n    else { const ordered = sortTournaments(data || []); setTournaments(ordered); if (!selectedTournamentId && ordered[0]) setSelectedTournamentId(ordered[0].id); setBulkSelectedIds((ids) => ids.filter((id) => ordered.some((item) => item.id === id))); setStatus('Tournaments loaded'); }"
);

const oldCreate = `  async function createTournament(event) {
    event.preventDefault();
    if (!canUseDatabase) return setStatus('Add your Supabase environment variables in Netlify before saving.');
    setLoading(true); setStatus('Creating tournament...');
    try {
      const seasonNumber = Number(String(form.seasonCode).replace(/[^0-9]/g, '')) || null;
      const seasonId = await findOrCreate('seasons', { code: form.seasonCode }, { code: form.seasonCode, number: seasonNumber });
      const competitionId = await findOrCreate('competitions', { name: form.competitionName }, { name: form.competitionName, competition_type: 'youth' });
      const { data, error } = await supabase.from('tournaments').insert({ season_id: seasonId, competition_id: competitionId, name: form.tournamentName, status: 'draft', format: 'groups_then_knockout', source: 'app', max_entries: Number(form.maxEntries), actual_entries: 0, group_count: Number(form.groupCount), teams_per_group: Number(form.teamsPerGroup), knockout_teams: Number(form.knockoutTeams), secondary_bracket_name: form.secondaryBracketName || null, rules_notes: 'Created from Top 100 tournament app dashboard' }).select('id').single();
      if (error) throw error;
      setSelectedTournamentId(data.id); setActiveModule('Overview'); setStatus(form.tournamentName + ' created successfully.'); await loadTournaments();
    } catch (error) { setStatus('Create failed: ' + error.message); }
    setLoading(false);
  }`;
const newCreate = `  async function createTournament(event) {
    event.preventDefault();
    if (!canUseDatabase) return setStatus('Add your Supabase environment variables in Netlify before saving.');
    setLoading(true); setStatus('Creating tournament...');
    try {
      const seasonNumber = seasonNumberFromCode(form.seasonCode);
      const seasonId = await findOrCreate('seasons', { code: form.seasonCode }, { code: form.seasonCode, number: seasonNumber });
      const competitionId = await findOrCreate('competitions', { name: form.competitionName }, { name: form.competitionName, competition_type: form.competitionSlug || 'youth-cup' });
      const gameWorldSlug = slugify(form.gameWorldSlug || form.gameWorldName || 'top-100') || 'top-100';
      const competitionSlug = slugify(form.competitionSlug || form.competitionName || 'youth-cup') || 'youth-cup';
      let gameWorldId = null;
      let competitionTypeId = null;
      try {
        gameWorldId = await findOrCreate('game_worlds', { slug: gameWorldSlug }, { name: form.gameWorldName || 'Top 100', slug: gameWorldSlug, display_order: gameWorldSlug === 'top-100' ? 1 : 100 });
        competitionTypeId = await findOrCreate('competition_types', { slug: competitionSlug }, { name: form.competitionName, slug: competitionSlug, default_max_entries: Number(form.maxEntries), default_group_count: Number(form.groupCount), default_teams_per_group: Number(form.teamsPerGroup), default_knockout_teams: Number(form.knockoutTeams), default_secondary_bracket_name: form.secondaryBracketName || null });
      } catch (metadataError) {
        gameWorldId = null;
        competitionTypeId = null;
      }
      const basePayload = { season_id: seasonId, competition_id: competitionId, name: form.tournamentName, status: 'draft', format: 'groups_then_knockout', source: 'app', max_entries: Number(form.maxEntries), actual_entries: 0, group_count: Number(form.groupCount), teams_per_group: Number(form.teamsPerGroup), knockout_teams: Number(form.knockoutTeams), secondary_bracket_name: form.secondaryBracketName || null, rules_notes: 'Created from Top 100 tournament app dashboard' };
      const v2Payload = { ...basePayload, game_world_id: gameWorldId, competition_type_id: competitionTypeId, season_number: seasonNumber, slug: slugify(form.tournamentName), public_slug: seasonSlugFromCode(form.seasonCode), is_public: true, registration_status: form.registrationStatus || 'closed' };
      let result = await supabase.from('tournaments').insert(v2Payload).select('id').single();
      if (result.error) result = await supabase.from('tournaments').insert(basePayload).select('id').single();
      const { data, error } = result;
      if (error) throw error;
      setSelectedTournamentId(data.id); setActiveModule('Overview'); setStatus(form.tournamentName + ' created successfully.'); await loadTournaments();
    } catch (error) { setStatus('Create failed: ' + error.message); }
    setLoading(false);
  }`;
text = replaceOnce(text, oldCreate, newCreate);

const oldForm = `<div className="mini-grid"><label>Season<input value={form.seasonCode} onChange={(event) => updateField('seasonCode', event.target.value)} /></label><label>Competition<input value={form.competitionName} onChange={(event) => updateField('competitionName', event.target.value)} /></label></div><label>Tournament name<input value={form.tournamentName} onChange={(event) => updateField('tournamentName', event.target.value)} /></label>`;
const newForm = `<div className="mini-grid"><label>Game world<input value={form.gameWorldName} onChange={(event) => updateField('gameWorldName', event.target.value)} /></label><label>World slug<input value={form.gameWorldSlug} onChange={(event) => updateField('gameWorldSlug', event.target.value)} /></label></div><div className="mini-grid"><label>Season<input value={form.seasonCode} onChange={(event) => updateField('seasonCode', event.target.value)} /></label><label>Competition<input value={form.competitionName} onChange={(event) => updateField('competitionName', event.target.value)} /></label><label>Competition slug<input value={form.competitionSlug} onChange={(event) => updateField('competitionSlug', event.target.value)} /></label></div><label>Tournament name<input value={form.tournamentName} onChange={(event) => updateField('tournamentName', event.target.value)} /></label>`;
text = replaceOnce(text, oldForm, newForm);

const cardOld = `<span>{tournament.group_count || '?'} groups · {tournament.knockout_teams || '?'} knockout teams</span></button></article>)}</div></div>;`;
const cardNew = `<span>{tournament.group_count || '?'} groups · {tournament.knockout_teams || '?'} knockout teams</span><span>{tournament.game_worlds?.name || 'Top 100'} · {tournament.competition_types?.name || 'Youth Cup'}{tournament.season_number ? ' · S' + tournament.season_number : ''}</span><span>{publicTournamentPath(tournament)}</span></button></article>)}</div></div>;`;
text = replaceOnce(text, cardOld, cardNew);

fs.writeFileSync(path, text);
