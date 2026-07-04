import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const demoTeams = [
  'Genoa', 'Espanyol', 'Bayern Munich', 'Barcelona', 'CSKA', 'Hertha Berlin', 'Independiente', 'River Plate',
  'Montpellier', 'West Brom', 'Club Brugge', 'Juventus', 'Leicester Youth', 'Levante', 'Dortmund', 'Hamburg',
  'Stoke City', 'Sao Paulo', 'FC Porto', 'Sampdoria', 'Sporting', 'SC Internacional', 'Chelsea', 'Anderlecht',
  'Celtic Factory', 'Dynamo Moskva', 'Besiktas', 'PSV', 'AC Milan', 'Crystal Palace', 'Fenerbahce', 'Monaco',
  'Benfica', 'Cruzeiro', 'Liverpool', 'Athletic Club', 'Tottenham', 'Werder Bremen', 'Villarreal', 'Real Madrid',
  'Udinese', 'Valencia', 'Wolfsburg', 'CR Flamengo', 'Leverkusen', 'Swansea', 'Newcastle United', 'Saint Etienne',
  'Ajax', 'Roma', 'Lazio', 'Marseille', 'Fiorentina', 'Lyon', 'Sevilla', 'Porto B',
  'Everton', 'Napoli', 'Atalanta', 'Boca Juniors', 'Palmeiras', 'Flamengo Youth', 'Galatasaray', 'Rangers',
];

export default function EntrantsManager({ selectedTournament, onPreviewGenerated }) {
  const [entries, setEntries] = useState([]);
  const [teams, setTeams] = useState([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);

  const tournamentId = selectedTournament?.id;
  const maxEntries = Number(selectedTournament?.max_entries || 64);

  useEffect(() => {
    if (hasSupabaseConfig && supabase && tournamentId) {
      loadEntrants();
      loadTeams();
    }
  }, [tournamentId]);

  const filteredTeams = useMemo(() => {
    const selectedTeamIds = new Set(entries.map((entry) => entry.team_id));
    const needle = query.trim().toLowerCase();

    return teams
      .filter((team) => !selectedTeamIds.has(team.id))
      .filter((team) => !needle || team.name.toLowerCase().includes(needle))
      .slice(0, 80);
  }, [entries, teams, query]);

  async function loadTeams() {
    const { data, error } = await supabase
      .from('teams')
      .select('id, name')
      .order('name', { ascending: true });

    if (error) {
      setStatus('Could not load teams: ' + error.message);
      return;
    }

    setTeams(data || []);
  }

  async function loadEntrants() {
    if (!tournamentId) return;

    const { data, error } = await supabase
      .from('tournament_entries')
      .select('id, tournament_id, team_id, manager_id, seed, rating, entry_status, teams(id, name), managers(id, name, display_name)')
      .eq('tournament_id', tournamentId)
      .order('seed', { ascending: true });

    if (error) {
      setStatus('Could not load entrants: ' + error.message);
      return;
    }

    setEntries(data || []);
    setStatus('Entrants loaded');
  }

  async function findOrCreateTeam(name) {
    const { data: existing, error: findError } = await supabase
      .from('teams')
      .select('id')
      .eq('name', name)
      .maybeSingle();

    if (findError) throw findError;
    if (existing) return existing.id;

    const { data, error } = await supabase
      .from('teams')
      .insert({ name })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  async function findOrCreateManager(name) {
    const { data: existing, error: findError } = await supabase
      .from('managers')
      .select('id')
      .eq('name', name)
      .maybeSingle();

    if (findError) throw findError;
    if (existing) return existing.id;

    const { data, error } = await supabase
      .from('managers')
      .insert({ name, display_name: name, canonical_name: name.toLowerCase() })
      .select('id')
      .single();

    if (error) throw error;
    return data.id;
  }

  async function addTeamAsEntrant(team, seed = null) {
    if (!tournamentId) return;
    setLoading(true);
    setStatus('Adding ' + team.name + '...');

    try {
      const managerId = await findOrCreateManager('TBC Manager');
      const nextSeed = seed || entries.length + 1;
      const { error } = await supabase.from('tournament_entries').insert({
        tournament_id: tournamentId,
        team_id: team.id,
        manager_id: managerId,
        seed: nextSeed,
        rating: 100 - Math.floor((nextSeed - 1) / 4),
        entry_status: 'active',
        prize_draw_eligible: true,
      });

      if (error) throw error;
      await loadEntrants();
      setStatus(team.name + ' added.');
    } catch (error) {
      setStatus('Add failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  async function removeEntrant(entry) {
    setLoading(true);
    setStatus('Removing entrant...');

    const { error } = await supabase
      .from('tournament_entries')
      .delete()
      .eq('id', entry.id);

    if (error) {
      setStatus('Remove failed: ' + error.message);
    } else {
      await loadEntrants();
      setStatus('Entrant removed.');
    }

    setLoading(false);
  }

  async function seedDemoEntrants() {
    if (!tournamentId) return;
    setLoading(true);
    setStatus('Creating demo entrant set...');

    try {
      for (let index = 0; index < Math.min(maxEntries, demoTeams.length); index += 1) {
        const teamName = demoTeams[index];
        const teamId = await findOrCreateTeam(teamName);
        const managerId = await findOrCreateManager('Manager ' + (index + 1));
        const seed = index + 1;

        const alreadySelected = entries.some((entry) => entry.team_id === teamId);
        if (!alreadySelected) {
          const { error } = await supabase.from('tournament_entries').insert({
            tournament_id: tournamentId,
            team_id: teamId,
            manager_id: managerId,
            seed,
            rating: 100 - Math.floor(index / 4),
            entry_status: 'active',
            prize_draw_eligible: true,
          });
          if (error && !String(error.message).includes('duplicate')) throw error;
        }
      }

      await loadTeams();
      await loadEntrants();
      setStatus('Demo entrant set created.');
    } catch (error) {
      setStatus('Demo import failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  function buildEntrantPreview() {
    const previewEntries = entries.map((entry) => ({
      id: entry.id,
      team_name: entry.teams?.name || 'Unknown team',
      manager_name: entry.managers?.display_name || entry.managers?.name || 'TBC',
      seed: entry.seed,
      rating: entry.rating,
    }));

    onPreviewGenerated(previewEntries);
  }

  if (!selectedTournament) {
    return <p className="muted">Create or select a tournament first.</p>;
  }

  return (
    <div className="entrants-manager">
      <div className="entrant-toolbar">
        <div>
          <p className="eyebrow">Selected</p>
          <h3>{entries.length} / {maxEntries} entrants</h3>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={loadEntrants} disabled={loading}>Reload</button>
          <button type="button" className="secondary" onClick={seedDemoEntrants} disabled={loading}>Seed demo 64</button>
          <button type="button" onClick={buildEntrantPreview} disabled={entries.length === 0}>Generate Groups</button>
        </div>
      </div>

      <p className="status">{status}</p>

      <div className="entrant-panels">
        <section className="entrant-panel">
          <h3>Selected entrants</h3>
          {entries.length === 0 ? (
            <p className="muted">No entrants yet. Add teams one by one, or seed the demo 64.</p>
          ) : (
            <div className="entrant-list">
              {entries.map((entry) => (
                <article className="entrant-row selected" key={entry.id}>
                  <div>
                    <strong>{entry.seed}. {entry.teams?.name || 'Unknown team'}</strong>
                    <span>{entry.managers?.display_name || entry.managers?.name || 'TBC Manager'} · rating {entry.rating || '-'}</span>
                  </div>
                  <button type="button" className="danger" onClick={() => removeEntrant(entry)} disabled={loading}>Remove</button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="entrant-panel">
          <h3>Add teams</h3>
          <input placeholder="Search teams..." value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="entrant-list">
            {filteredTeams.map((team) => (
              <article className="entrant-row" key={team.id}>
                <div>
                  <strong>{team.name}</strong>
                  <span>Available for selection</span>
                </div>
                <button type="button" className="secondary" onClick={() => addTeamAsEntrant(team)} disabled={loading || entries.length >= maxEntries}>Add</button>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
