import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from './lib/supabaseClient';

const steps = [
  'Competition setup',
  'Add entrants',
  'Generate groups',
  'Generate fixtures',
  'Enter results',
  'Auto-update tables',
  'Generate knockout draw',
  'Publish public page',
  'Archive automatically',
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
      group.entries.push({
        ...entry,
        group_code: group.code,
        pot: potNumber,
      });
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
          home_entry_id: home.id,
          away_entry_id: away.id,
        });
        matchOrder += 1;

        fixtures.push({
          group_code: group.code,
          round: 'MD' + j + 'L2',
          leg: 2,
          match_order: matchOrder,
          home_placeholder: away.team_name,
          away_placeholder: home.team_name,
          home_entry_id: away.id,
          away_entry_id: home.id,
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
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);

  const canUseDatabase = hasSupabaseConfig && supabase;

  useEffect(() => {
    if (canUseDatabase) loadTournaments();
  }, [canUseDatabase]);

  const completionText = useMemo(() => {
    const created = tournaments.some((item) => item.name === form.tournamentName);
    return created ? 'Tournament created' : 'First milestone: create the tournament shell';
  }, [form.tournamentName, tournaments]);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function previewGroupsAndFixtures() {
    try {
      const entryCount = Number(form.maxEntries || 64);
      const sampleEntries = demoEntrants.slice(0, entryCount);
      const groups = generatePreviewGroups(sampleEntries, Number(form.groupCount || 16));
      const fixtures = generatePreviewFixtures(groups);

      setPreview({ groups, fixtures });
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

      const { error } = await supabase.from('tournaments').insert({
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
        rules_notes: 'Created from Top 100 tournament app MVP',
      });

      if (error) throw error;

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
        <p className="eyebrow">Top 100 Tournament Admin</p>
        <h1>Build the tournament organiser around the real workflow.</h1>
        <p>
          Start with a tournament shell, then add entrants, generate groups, create fixtures,
          enter results and publish the archive page.
        </p>
      </section>

      {!canUseDatabase && (
        <section className="warning-card">
          <strong>Supabase is not connected yet.</strong>
          <span>
            Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Netlify environment variables.
          </span>
        </section>
      )}

      <section className="grid two-columns">
        <form className="card" onSubmit={createTournament}>
          <div className="card-header">
            <p className="eyebrow">Step 1</p>
            <h2>Create tournament</h2>
          </div>

          <label>
            Season
            <input value={form.seasonCode} onChange={(event) => updateField('seasonCode', event.target.value)} />
          </label>

          <label>
            Competition
            <input value={form.competitionName} onChange={(event) => updateField('competitionName', event.target.value)} />
          </label>

          <label>
            Tournament name
            <input value={form.tournamentName} onChange={(event) => updateField('tournamentName', event.target.value)} />
          </label>

          <div className="mini-grid">
            <label>
              Max entries
              <input type="number" value={form.maxEntries} onChange={(event) => updateField('maxEntries', event.target.value)} />
            </label>
            <label>
              Groups
              <input type="number" value={form.groupCount} onChange={(event) => updateField('groupCount', event.target.value)} />
            </label>
            <label>
              Teams/group
              <input type="number" value={form.teamsPerGroup} onChange={(event) => updateField('teamsPerGroup', event.target.value)} />
            </label>
            <label>
              Knockout teams
              <input type="number" value={form.knockoutTeams} onChange={(event) => updateField('knockoutTeams', event.target.value)} />
            </label>
          </div>

          <label>
            Secondary bracket
            <input value={form.secondaryBracketName} onChange={(event) => updateField('secondaryBracketName', event.target.value)} />
          </label>

          <div className="button-row">
            <button type="submit" disabled={loading}>{loading ? 'Working...' : 'Create S28 Youth Cup'}</button>
            <button type="button" className="secondary" onClick={previewGroupsAndFixtures}>Preview groups & fixtures</button>
          </div>
          <p className="status">{status}</p>
        </form>

        <section className="card">
          <div className="card-header">
            <p className="eyebrow">Workflow</p>
            <h2>{completionText}</h2>
          </div>
          <ol className="steps">
            {steps.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </section>
      </section>

      {preview && (
        <section className="card">
          <div className="card-header row">
            <div>
              <p className="eyebrow">Engine test</p>
              <h2>Preview: {preview.groups.length} groups, {preview.fixtures.length} fixtures</h2>
            </div>
            <button type="button" className="secondary" onClick={() => setPreview(null)}>Clear preview</button>
          </div>

          <div className="preview-groups">
            {preview.groups.map((group) => (
              <article className="group-card" key={group.code}>
                <h3>Group {group.code}</h3>
                <ol>
                  {group.entries.map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.seed}.</strong> {entry.team_name}
                      <span>Pot {entry.pot}</span>
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>

          <details className="fixture-preview">
            <summary>Show first 24 generated fixtures</summary>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Group</th>
                    <th>Round</th>
                    <th>Home</th>
                    <th>Away</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.fixtures.slice(0, 24).map((fixture) => (
                    <tr key={fixture.group_code + '-' + fixture.match_order}>
                      <td>{fixture.match_order}</td>
                      <td>{fixture.group_code}</td>
                      <td>{fixture.round}</td>
                      <td>{fixture.home_placeholder}</td>
                      <td>{fixture.away_placeholder}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      <section className="card">
        <div className="card-header row">
          <div>
            <p className="eyebrow">Archive</p>
            <h2>Existing tournaments</h2>
          </div>
          <button type="button" className="secondary" onClick={loadTournaments} disabled={loading || !canUseDatabase}>
            Refresh
          </button>
        </div>

        {tournaments.length === 0 ? (
          <p className="muted">No tournaments loaded yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Entries</th>
                  <th>Groups</th>
                  <th>Knockout</th>
                  <th>Secondary</th>
                </tr>
              </thead>
              <tbody>
                {tournaments.map((tournament) => (
                  <tr key={tournament.id}>
                    <td>{tournament.name}</td>
                    <td>{tournament.status}</td>
                    <td>{tournament.actual_entries || 0}/{tournament.max_entries || '-'}</td>
                    <td>{tournament.group_count || '-'} × {tournament.teams_per_group || '-'}</td>
                    <td>{tournament.knockout_teams || '-'}</td>
                    <td>{tournament.secondary_bracket_name || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
