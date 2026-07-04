import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from './lib/supabaseClient';

const workflowSteps = [
  'Tournament created',
  'Entrants selected',
  'Groups generated',
  'Fixtures generated',
  'Results entered',
  'Tables updated',
  'Knockout ready',
  'Published',
  'Archived',
];

const modules = [
  'Overview',
  'Entrants',
  'Groups',
  'Fixtures',
  'Results',
  'Tables',
  'Knockout',
  'Public Page',
];

const initialForm = {
  seasonCode: 'S28',
  competitionName: 'Youth Cup',
  tournamentName: 'S28 Youth Cup',
  maxEntries: 64,
  teamsPerGroup: 4,
  groupCount: 16,
  knockoutTeams: 32,
  secondaryBracketName: 'Shield',
};

const groupCodes = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

const demoEntrants = [
  'Genoa', 'Espanyol', 'Bayern Munich', 'Barcelona', 'CSKA', 'Hertha Berlin', 'Independiente', 'River Plate',
  'Montpellier', 'West Brom', 'Club Brugge', 'Juventus', 'Leicester Youth', 'Levante', 'Dortmund', 'Hamburg',
  'Stoke City', 'Sao Paulo', 'FC Porto', 'Sampdoria', 'Sporting', 'SC Internacional', 'Chelsea', 'Anderlecht',
  'Celtic Factory', 'Dynamo Moskva', 'Besiktas', 'PSV', 'AC Milan', 'Crystal Palace', 'Fenerbahce', 'Monaco',
  'Benfica', 'Cruzeiro', 'Liverpool', 'Athletic Club', 'Tottenham', 'Werder Bremen', 'Villarreal', 'Real Madrid',
  'Udinese', 'Valencia', 'Wolfsburg', 'CR Flamengo', 'Leverkusen', 'Swansea', 'Newcastle United', 'Saint Etienne',
  'Ajax', 'Roma', 'Lazio', 'Marseille', 'Fiorentina', 'Lyon', 'Sevilla', 'Porto B',
  'Everton', 'Napoli', 'Atalanta', 'Boca Juniors', 'Palmeiras', 'Flamengo Youth', 'Galatasaray', 'Rangers',
].map((teamName, index) => ({
  id: index + 1,
  team_name: teamName,
  manager_name: 'Manager ' + (index + 1),
  seed: index + 1,
  rating: 100 - Math.floor(index / 4),
}));

function generatePreviewGroups(entries, groupCount) {
  const groups = groupCodes.slice(0, groupCount).map((code, index) => ({
    code,
    group_order: index + 1,
    entries: [],
  }));

  for (let start = 0; start < entries.length; start += groupCount) {
    const potNumber = Math.floor(start / groupCount) + 1;
    const pot = entries.slice(start, start + groupCount);
    const orderedPot = potNumber % 2 === 1 ? pot : [...pot].reverse();

    orderedPot.forEach((entry, index) => {
      const group = groups[index % groupCount];
      group.entries.push({ ...entry, group_code: group.code, pot: potNumber });
    });
  }

  return groups;
}

function generatePreviewFixtures(groups) {
  const fixtures = [];
  let matchOrder = 1;

  groups.forEach((group) => {
    const entries = group.entries;
    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const home = entries[i];
        const away = entries[j];
        fixtures.push({
          group_code: group.code,
          round: 'MD' + j + 'L1',
          leg: 1,
          match_order: matchOrder,
          home_placeholder: home.team_name,
          away_placeholder: away.team_name,
        });
        matchOrder += 1;
        fixtures.push({
          group_code: group.code,
          round: 'MD' + j + 'L2',
          leg: 2,
          match_order: matchOrder,
          home_placeholder: away.team_name,
          away_placeholder: home.team_name,
        });
        matchOrder += 1;
      }
    }
  });

  return fixtures;
}

export default function App() {
  const [form, setForm] = useState(initialForm);
  const [tournaments, setTournaments] = useState([]);
  const [selectedTournamentId, setSelectedTournamentId] = useState(null);
  const [activeModule, setActiveModule] = useState('Overview');
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);

  const canUseDatabase = hasSupabaseConfig && supabase;

  useEffect(() => {
    if (canUseDatabase) loadTournaments();
  }, [canUseDatabase]);

  const selectedTournament = useMemo(
    () => tournaments.find((item) => item.id === selectedTournamentId) || tournaments[0] || null,
    [selectedTournamentId, tournaments]
  );

  const dashboardTitle = selectedTournament
    ? selectedTournament.name + ' control centre'
    : 'Create your first tournament shell';

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function previewGroupsAndFixtures() {
    try {
      const entryCount = Number(form.maxEntries || selectedTournament?.max_entries || 64);
      const groupCount = Number(form.groupCount || selectedTournament?.group_count || 16);
      const sampleEntries = demoEntrants.slice(0, entryCount);
      const groups = generatePreviewGroups(sampleEntries, groupCount);
      const fixtures = generatePreviewFixtures(groups);
      setPreview({ groups, fixtures });
      setActiveModule('Groups');
      setStatus('Preview generated: ' + groups.length + ' groups and ' + fixtures.length + ' group fixtures.');
    } catch (error) {
      setStatus('Preview failed: ' + error.message);
    }
  }

  async function loadTournaments() {
    setLoading(true);
    setStatus('Loading tournaments...');

    const { data, error } = await supabase
      .from('tournaments')
      .select('id, name, status, max_entries, actual_entries, group_count, teams_per_group, knockout_teams, secondary_bracket_name, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      setStatus('Could not load tournaments: ' + error.message);
      setLoading(false);
      return;
    }

    setTournaments(data || []);
    if (!selectedTournamentId && data?.[0]) setSelectedTournamentId(data[0].id);
    setStatus('Tournaments loaded');
    setLoading(false);
  }

  async function findOrCreateSeason() {
    const { data: existing, error: findError } = await supabase
      .from('seasons')
      .select('id')
      .eq('code', form.seasonCode)
      .maybeSingle();

    if (findError) throw findError;
    if (existing) return existing.id;

    const seasonNumber = Number(String(form.seasonCode).replace(/[^0-9]/g, '')) || null;
    const { data, error } = await supabase
      .from('seasons')
      .insert({ code: form.seasonCode, number: seasonNumber })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  async function findOrCreateCompetition() {
    const { data: existing, error: findError } = await supabase
      .from('competitions')
      .select('id')
      .eq('name', form.competitionName)
      .maybeSingle();

    if (findError) throw findError;
    if (existing) return existing.id;

    const { data, error } = await supabase
      .from('competitions')
      .insert({ name: form.competitionName, competition_type: 'youth' })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  async function createTournament(event) {
    event.preventDefault();

    if (!canUseDatabase) {
      setStatus('Add your Supabase environment variables in Netlify before saving.');
      return;
    }

    setLoading(true);
    setStatus('Creating tournament...');

    try {
      const seasonId = await findOrCreateSeason();
      const competitionId = await findOrCreateCompetition();

      const { data, error } = await supabase
        .from('tournaments')
        .insert({
          season_id: seasonId,
          competition_id: competitionId,
          name: form.tournamentName,
          status: 'draft',
          format: 'groups_then_knockout',
          source: 'app',
          max_entries: Number(form.maxEntries),
          actual_entries: 0,
          group_count: Number(form.groupCount),
          teams_per_group: Number(form.teamsPerGroup),
          knockout_teams: Number(form.knockoutTeams),
          secondary_bracket_name: form.secondaryBracketName || null,
          rules_notes: 'Created from Top 100 tournament app dashboard',
        })
        .select('id')
        .single();

      if (error) throw error;

      setSelectedTournamentId(data.id);
      setActiveModule('Overview');
      setStatus(form.tournamentName + ' created successfully.');
      await loadTournaments();
    } catch (error) {
      setStatus('Create failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Top 100 Tournament Manager</p>
        <h1>{dashboardTitle}</h1>
        <p>
          Create tournaments, choose entrants, generate groups and fixtures, enter results,
          build knockouts and publish the archive page from one control centre.
        </p>
      </section>

      {!canUseDatabase && (
        <section className="warning-card">
          <strong>Supabase is not connected yet.</strong>
          <span>Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify environment variables.</span>
        </section>
      )}

      <section className="dashboard-layout">
        <aside className="sidebar card">
          <p className="eyebrow">Modules</p>
          {modules.map((module) => (
            <button
              key={module}
              type="button"
              className={activeModule === module ? 'nav-pill active' : 'nav-pill'}
              onClick={() => setActiveModule(module)}
            >
              {module}
            </button>
          ))}
        </aside>

        <section className="workspace">
          <section className="grid two-columns compact">
            <form className="card" onSubmit={createTournament}>
              <div className="card-header">
                <p className="eyebrow">Tournament setup</p>
                <h2>Create or configure tournament</h2>
              </div>

              <div className="mini-grid">
                <label>Season<input value={form.seasonCode} onChange={(event) => updateField('seasonCode', event.target.value)} /></label>
                <label>Competition<input value={form.competitionName} onChange={(event) => updateField('competitionName', event.target.value)} /></label>
              </div>

              <label>Tournament name<input value={form.tournamentName} onChange={(event) => updateField('tournamentName', event.target.value)} /></label>

              <div className="mini-grid">
                <label>Max entries<input type="number" value={form.maxEntries} onChange={(event) => updateField('maxEntries', event.target.value)} /></label>
                <label>Groups<input type="number" value={form.groupCount} onChange={(event) => updateField('groupCount', event.target.value)} /></label>
                <label>Teams/group<input type="number" value={form.teamsPerGroup} onChange={(event) => updateField('teamsPerGroup', event.target.value)} /></label>
                <label>Knockout teams<input type="number" value={form.knockoutTeams} onChange={(event) => updateField('knockoutTeams', event.target.value)} /></label>
              </div>

              <label>Secondary bracket<input value={form.secondaryBracketName} onChange={(event) => updateField('secondaryBracketName', event.target.value)} /></label>

              <div className="button-row">
                <button type="submit" disabled={loading}>{loading ? 'Working...' : 'Create tournament'}</button>
                <button type="button" className="secondary" onClick={previewGroupsAndFixtures}>Preview groups & fixtures</button>
              </div>
              <p className="status">{status}</p>
            </form>

            <section className="card">
              <div className="card-header">
                <p className="eyebrow">Workflow status</p>
                <h2>{selectedTournament ? selectedTournament.name : 'No tournament selected'}</h2>
              </div>
              <ol className="steps">
                {workflowSteps.map((step, index) => {
                  const done = index === 0 && selectedTournament;
                  const previewDone = preview && (step === 'Groups generated' || step === 'Fixtures generated');
                  return (
                    <li key={step} className={done || previewDone ? 'done' : ''}>
                      <span>{done || previewDone ? '✓' : index + 1}</span>
                      {step}
                    </li>
                  );
                })}
              </ol>
            </section>
          </section>

          <section className="card module-card">
            <div className="card-header row">
              <div>
                <p className="eyebrow">{activeModule}</p>
                <h2>{moduleHeading(activeModule)}</h2>
              </div>
              <button type="button" className="secondary" onClick={loadTournaments} disabled={loading || !canUseDatabase}>Refresh</button>
            </div>
            <ModuleContent
              activeModule={activeModule}
              tournaments={tournaments}
              selectedTournament={selectedTournament}
              setSelectedTournamentId={setSelectedTournamentId}
              preview={preview}
              setPreview={setPreview}
            />
          </section>
        </section>
      </section>
    </main>
  );
}

function moduleHeading(activeModule) {
  const headings = {
    Overview: 'Tournament dashboard',
    Entrants: 'Select teams and managers',
    Groups: 'Approve generated groups',
    Fixtures: 'Generate and manage fixtures',
    Results: 'Enter results',
    Tables: 'Live group tables',
    Knockout: 'Cup and Shield draw',
    'Public Page': 'Publish and archive',
  };
  return headings[activeModule] || activeModule;
}

function ModuleContent({ activeModule, tournaments, selectedTournament, setSelectedTournamentId, preview, setPreview }) {
  if (activeModule === 'Overview') {
    return (
      <>
        {tournaments.length === 0 ? (
          <p className="muted">No tournaments loaded yet.</p>
        ) : (
          <div className="tournament-grid">
            {tournaments.map((tournament) => (
              <button
                type="button"
                className={selectedTournament?.id === tournament.id ? 'tournament-card selected' : 'tournament-card'}
                key={tournament.id}
                onClick={() => setSelectedTournamentId(tournament.id)}
              >
                <strong>{tournament.name}</strong>
                <span>{tournament.status} · {tournament.actual_entries || 0}/{tournament.max_entries || '-'} entries</span>
                <span>{tournament.group_count || '-'} groups · {tournament.knockout_teams || '-'} knockout teams · {tournament.secondary_bracket_name || 'No secondary bracket'}</span>
              </button>
            ))}
          </div>
        )}
      </>
    );
  }

  if (activeModule === 'Groups') {
    if (!preview) return <p className="muted">Generate a groups preview first. Later this tab will load saved groups from Supabase.</p>;
    return (
      <>
        <div className="row preview-actions">
          <p className="muted">Preview: {preview.groups.length} groups, {preview.fixtures.length} fixtures.</p>
          <button type="button" className="secondary" onClick={() => setPreview(null)}>Clear preview</button>
        </div>
        <div className="preview-groups">
          {preview.groups.map((group) => (
            <article className="group-card" key={group.code}>
              <h3>Group {group.code}</h3>
              <ol>
                {group.entries.map((entry) => (
                  <li key={entry.id}><strong>{entry.seed}.</strong> {entry.team_name}<span>Pot {entry.pot}</span></li>
                ))}
              </ol>
            </article>
          ))}
        </div>
      </>
    );
  }

  if (activeModule === 'Fixtures') {
    if (!preview) return <p className="muted">Generate a fixtures preview first. Later this tab will save match records into Supabase.</p>;
    return (
      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Group</th><th>Round</th><th>Home</th><th>Away</th></tr></thead>
          <tbody>
            {preview.fixtures.slice(0, 48).map((fixture) => (
              <tr key={fixture.group_code + '-' + fixture.match_order}>
                <td>{fixture.match_order}</td><td>{fixture.group_code}</td><td>{fixture.round}</td><td>{fixture.home_placeholder}</td><td>{fixture.away_placeholder}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const placeholders = {
    Entrants: 'Next: searchable tick-box entrant selector using teams, managers and tournament_entries.',
    Results: 'Next: tap a fixture, enter score, save result, update winner and loser.',
    Tables: 'Next: live calculated group tables from match results.',
    Knockout: 'Next: automatic Cup and Shield bracket generation from final group standings.',
    'Public Page': 'Next: read-only public tournament page and archived tournament view.',
  };

  return <p className="muted">{placeholders[activeModule] || 'Module coming next.'}</p>;
}
