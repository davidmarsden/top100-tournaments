import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const demoTeams = ['Genoa', 'Espanyol', 'Bayern Munich', 'Barcelona', 'CSKA', 'Hertha Berlin', 'Independiente', 'River Plate', 'Montpellier', 'West Brom', 'Club Brugge', 'Juventus', 'Leicester Youth', 'Levante', 'Dortmund', 'Hamburg', 'Stoke City', 'Sao Paulo', 'FC Porto', 'Sampdoria', 'Sporting', 'SC Internacional', 'Chelsea', 'Anderlecht', 'Celtic Factory', 'Dynamo Moskva', 'Besiktas', 'PSV', 'AC Milan', 'Crystal Palace', 'Fenerbahce', 'Monaco', 'Benfica', 'Cruzeiro', 'Liverpool', 'Athletic Club', 'Tottenham', 'Werder Bremen', 'Villarreal', 'Real Madrid', 'Udinese', 'Valencia', 'Wolfsburg', 'CR Flamengo', 'Leverkusen', 'Swansea', 'Newcastle United', 'Saint Etienne', 'Ajax', 'Roma', 'Lazio', 'Marseille', 'Fiorentina', 'Lyon', 'Sevilla', 'Porto B', 'Everton', 'Napoli', 'Atalanta', 'Boca Juniors', 'Palmeiras', 'Flamengo Youth', 'Galatasaray', 'Rangers'];

function parseCsv(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line, index) => ({ text: line.trim(), row_number: index + 1 }))
    .filter((line) => line.text);
  if (!lines.length) return [];

  const hasHeader = /manager|team|rating/i.test(lines[0].text);
  const dataLines = hasHeader ? lines.slice(1) : lines;

  return dataLines.map(({ text: line, row_number }) => {
    const parts = line.split(/\t|,/).map((part) => part.trim());
    if (parts.length !== 3) throw new Error(`Row ${row_number}: expected exactly manager, team, rating.`);

    const [manager_name, team_name, ratingText] = parts;
    if (!manager_name) throw new Error(`Row ${row_number}: manager name is missing.`);
    if (!team_name) throw new Error(`Row ${row_number}: team name is missing.`);
    if (!ratingText) throw new Error(`Row ${row_number}: rating is missing.`);

    const rating = Number(ratingText);
    if (!Number.isFinite(rating)) throw new Error(`Row ${row_number}: rating “${ratingText}” is not a valid number.`);
    if (!Number.isInteger(rating)) throw new Error(`Row ${row_number}: rating must be a whole number.`);

    return { manager_name, team_name, rating, row_number };
  });
}

function normaliseDirectoryName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function resolveUniqueDirectoryMatch(value, records, fields, label) {
  const clean = String(value || '').trim();
  const needle = normaliseDirectoryName(clean);
  if (!needle) throw new Error(label + ' name is required.');

  const exactMatches = records.filter((record) => fields.some((field) => normaliseDirectoryName(record?.[field]) === needle));
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) throw new Error(`${label} “${clean}” matches more than one directory record.`);

  const partialMatches = records.filter((record) => fields.some((field) => {
    const haystack = normaliseDirectoryName(record?.[field]);
    return haystack && (haystack.includes(needle) || needle.includes(haystack));
  }));
  if (partialMatches.length === 1) return partialMatches[0];
  if (partialMatches.length > 1) {
    const examples = partialMatches.slice(0, 4).map((record) => record.name || record.display_name).filter(Boolean).join(', ');
    throw new Error(`${label} “${clean}” is ambiguous${examples ? ` (${examples})` : ''}. Use the full directory name.`);
  }
  throw new Error(`${label} “${clean}” was not found in the existing directory.`);
}

function makeEditForm(entry) {
  return {
    id: entry.id,
    is_new: false,
    manager_name: entry.managers?.display_name || entry.managers?.name || '',
    team_name: entry.teams?.name || '',
    team_id: entry.team_id,
    rating: entry.rating ?? '',
  };
}

export default function EntrantsManager({ selectedTournament, onPreviewGenerated }) {
  const [entries, setEntries] = useState([]);
  const [teams, setTeams] = useState([]);
  const [query, setQuery] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [sheetCsvUrl, setSheetCsvUrl] = useState('');
  const [editing, setEditing] = useState(null);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);

  const tournamentId = selectedTournament?.id;
  const gameWorldId = selectedTournament?.game_world_id || selectedTournament?.game_worlds?.id;
  const knockoutOnly = selectedTournament?.tournament_structure === 'knockout_only';
  const maxEntries = Number(selectedTournament?.max_entries || 64);

  useEffect(() => {
    if (hasSupabaseConfig && supabase && tournamentId) {
      loadEntrants();
      loadTeams();
    }
  }, [tournamentId, gameWorldId, selectedTournament?.tournament_structure]);

  const filteredTeams = useMemo(() => {
    const selectedTeamIds = new Set(entries.map((entry) => entry.team_id));
    const needle = query.trim().toLowerCase();
    return teams
      .filter((team) => !selectedTeamIds.has(team.id))
      .filter((team) => !needle || team.name.toLowerCase().includes(needle));
  }, [entries, teams, query]);

  async function loadTeams() {
    const { data, error } = await supabase.from('teams').select('id, name').eq('active', true).order('name', { ascending: true });
    if (error) return setStatus('Could not load teams: ' + error.message);

    let managerByTeam = new Map();
    if (gameWorldId) {
      const { data: clubs, error: clubsError } = await supabase
        .from('game_world_clubs')
        .select('club_name, current_manager_name')
        .eq('game_world_id', gameWorldId)
        .eq('active', true);
      if (clubsError) return setStatus('Could not load game-world clubs: ' + clubsError.message);
      managerByTeam = new Map((clubs || []).map((club) => [normaliseDirectoryName(club.club_name), club.current_manager_name || '']));
    }

    setTeams((data || []).map((team) => ({
      ...team,
      current_manager_name: managerByTeam.get(normaliseDirectoryName(team.name)) || '',
    })));
  }

  async function loadEntrants() {
    if (!tournamentId) return;
    const { data, error } = await supabase
      .from('tournament_entries')
      .select('id, tournament_id, team_id, manager_id, seed, rating, entry_status, group_code, pot, teams(id, name), managers(id, name, display_name)')
      .eq('tournament_id', tournamentId)
      .order('seed', { ascending: true });
    if (error) return setStatus('Could not load entrants: ' + error.message);

    const loaded = data || [];
    setEntries(loaded);
    if (knockoutOnly) {
      const { error: countError } = await supabase.from('tournaments').update({ actual_entries: loaded.length }).eq('id', tournamentId);
      if (countError) return setStatus('Entrants loaded, but the tournament entrant count could not be synchronized: ' + countError.message);
    }
    setStatus('Entrants loaded');
  }

  async function findOrCreateTeam(name) {
    const clean = String(name || '').trim();
    if (!clean) throw new Error('Team name is required.');
    const { data: existing, error: findError } = await supabase.from('teams').select('id').ilike('name', clean).maybeSingle();
    if (findError) throw findError;
    if (existing) return existing.id;
    const { data, error } = await supabase.from('teams').insert({ name: clean, active: true }).select('id').single();
    if (error) throw error;
    return data.id;
  }

  async function findOrCreateManager(name) {
    const clean = String(name || '').trim() || 'TBC Manager';
    const { data: existing, error: findError } = await supabase.from('managers').select('id').ilike('name', clean).maybeSingle();
    if (findError) throw findError;
    if (existing) return existing.id;
    const { data, error } = await supabase.from('managers').insert({ name: clean, display_name: clean, canonical_name: clean.toLowerCase(), active: true }).select('id').single();
    if (error) throw error;
    return data.id;
  }

  function beginAddTeam(team) {
    setEditing({
      id: null,
      is_new: true,
      team_id: team.id,
      team_name: team.name,
      manager_name: team.current_manager_name || '',
      rating: '',
    });
    setStatus(`Enter the manager and average rating for ${team.name}, then save.`);
  }

  async function removeEntrant(entry) {
    setLoading(true);
    setStatus('Removing entrant...');
    const { error } = await supabase.from('tournament_entries').delete().eq('id', entry.id);
    if (error) setStatus('Remove failed: ' + error.message);
    else {
      await loadEntrants();
      setStatus('Entrant removed.');
    }
    setLoading(false);
  }

  async function saveEntrantEdit(event) {
    event.preventDefault();
    if (!editing) return;
    if (!editing.team_name.trim()) return setStatus('Team name is required.');
    if (!editing.manager_name.trim()) return setStatus('Manager name is required.');
    if (String(editing.rating).trim() === '') return setStatus('Rating is required.');

    const rating = Number(editing.rating);
    if (!Number.isFinite(rating)) return setStatus('Rating must be a number.');
    if (!Number.isInteger(rating)) return setStatus('Rating must be a whole number.');
    if (editing.is_new && (rating < 65 || rating > 95)) return setStatus('New entrant rating must be between 65 and 95.');

    setLoading(true);
    setStatus(editing.is_new ? 'Adding entrant...' : 'Updating entrant without changing group, seed, pot or fixtures...');
    try {
      const { data: teamDirectory, error: teamError } = await supabase.from('teams').select('id, name').eq('active', true).order('name', { ascending: true });
      if (teamError) throw teamError;
      const { data: managerDirectory, error: managerError } = await supabase.from('managers').select('id, name, display_name, canonical_name').eq('active', true).order('name', { ascending: true });
      if (managerError) throw managerError;

      const manager = resolveUniqueDirectoryMatch(editing.manager_name, managerDirectory || [], ['name', 'display_name', 'canonical_name'], 'Manager');

      if (editing.is_new) {
        const team = (teamDirectory || []).find((record) => record.id === editing.team_id);
        if (!team) throw new Error(`Team “${editing.team_name}” was not found in the active directory.`);

        const { data: currentEntries, error: entriesError } = await supabase.from('tournament_entries').select('team_id, seed').eq('tournament_id', tournamentId);
        if (entriesError) throw entriesError;
        if ((currentEntries || []).some((entry) => entry.team_id === team.id)) throw new Error(`${team.name} is already entered.`);
        if ((currentEntries || []).length >= maxEntries) throw new Error('This tournament is already at its entrant limit.');

        const nextSeed = Math.max(0, ...(currentEntries || []).map((entry) => Number(entry.seed) || 0)) + 1;
        const { error } = await supabase.from('tournament_entries').insert({
          tournament_id: tournamentId,
          team_id: team.id,
          manager_id: manager.id,
          seed: nextSeed,
          rating,
          entry_status: 'active',
          prize_draw_eligible: true,
        });
        if (error) throw error;
      } else {
        const team = resolveUniqueDirectoryMatch(editing.team_name, teamDirectory || [], ['name'], 'Team');
        const { error } = await supabase.from('tournament_entries').update({ team_id: team.id, manager_id: manager.id, rating }).eq('id', editing.id);
        if (error) throw error;
      }

      const wasNew = editing.is_new;
      setEditing(null);
      await loadTeams();
      await loadEntrants();
      setStatus(wasNew ? 'Entrant added.' : 'Entrant updated. Group, seed, pot and fixtures were preserved.');
    } catch (error) {
      setStatus((editing.is_new ? 'Add failed: ' : 'Entrant update failed: ') + error.message);
    } finally {
      setLoading(false);
    }
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
        if (!entries.some((entry) => entry.team_id === teamId)) {
          const { error } = await supabase.from('tournament_entries').insert({
            tournament_id: tournamentId,
            team_id: teamId,
            manager_id: managerId,
            seed,
            rating: Math.min(95, 100 - Math.floor(index / 4)),
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

  async function importRows(rows) {
    if (!rows.length) return setStatus('No valid rows found. Use: manager, team, average rating.');
    setLoading(true);
    setStatus('Checking ' + rows.length + ' entrants against the team and manager directories...');
    try {
      const { data: teamDirectory, error: teamError } = await supabase.from('teams').select('id, name').eq('active', true).order('name', { ascending: true });
      if (teamError) throw teamError;
      const { data: managerDirectory, error: managerError } = await supabase.from('managers').select('id, name, display_name, canonical_name').eq('active', true).order('name', { ascending: true });
      if (managerError) throw managerError;
      const { data: currentEntries, error: entriesError } = await supabase.from('tournament_entries').select('team_id, seed').eq('tournament_id', tournamentId);
      if (entriesError) throw entriesError;

      const sortedRows = [...rows].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || a.team_name.localeCompare(b.team_name));
      const resolvedRows = sortedRows.map((row, index) => {
        const rowLabel = row.row_number ? `Row ${row.row_number}` : `Import row ${index + 1}`;
        try {
          return {
            row,
            rowLabel,
            team: resolveUniqueDirectoryMatch(row.team_name, teamDirectory || [], ['name'], 'Team'),
            manager: resolveUniqueDirectoryMatch(row.manager_name, managerDirectory || [], ['name', 'display_name', 'canonical_name'], 'Manager'),
          };
        } catch (error) {
          throw new Error(`${rowLabel}: ${error.message}`);
        }
      });

      const selectedTeamIds = new Set((currentEntries || []).map((entry) => entry.team_id));
      const batchTeamIds = new Set();
      const newRows = resolvedRows.filter(({ team }) => {
        if (selectedTeamIds.has(team.id) || batchTeamIds.has(team.id)) return false;
        batchTeamIds.add(team.id);
        return true;
      });
      const remainingSlots = Math.max(0, maxEntries - (currentEntries || []).length);
      const rowsToInsert = newRows.slice(0, remainingSlots);

      if (!rowsToInsert.length) {
        await loadEntrants();
        setStatus(remainingSlots === 0 ? 'Import checked successfully, but this tournament is already at its entrant limit.' : 'Import checked successfully. All listed teams are already entered.');
        return;
      }

      const nextSeed = Math.max(0, ...(currentEntries || []).map((entry) => Number(entry.seed) || 0)) + 1;
      const payload = rowsToInsert.map(({ row, team, manager }, index) => ({
        tournament_id: tournamentId,
        team_id: team.id,
        manager_id: manager.id,
        seed: nextSeed + index,
        rating: row.rating,
        entry_status: 'active',
        prize_draw_eligible: true,
      }));
      const { error: insertError } = await supabase.from('tournament_entries').insert(payload);
      if (insertError) throw insertError;

      await loadTeams();
      await loadEntrants();
      setStatus(`Imported ${payload.length} entrant${payload.length === 1 ? '' : 's'} after validating the full batch. Existing directory records were reused; no global teams or managers were created.`);
    } catch (error) {
      await loadEntrants();
      setStatus('Import failed before any new entrants were added: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  async function importBulkText() {
    try {
      await importRows(parseCsv(bulkText));
    } catch (error) {
      setStatus('Import failed before any new entrants were added: ' + error.message);
    }
  }

  async function importSheetCsv() {
    if (!sheetCsvUrl) return setStatus('Paste a published Google Sheet CSV URL first.');
    setLoading(true);
    setStatus('Fetching Google Sheet CSV...');
    try {
      const response = await fetch(sheetCsvUrl);
      if (!response.ok) throw new Error('CSV fetch failed: ' + response.status);
      const text = await response.text();
      setBulkText(text);
      await importRows(parseCsv(text));
    } catch (error) {
      setStatus('Google Sheet import failed before any new entrants were added: ' + error.message);
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

  if (!selectedTournament) return <p className="muted">Create or select a tournament first.</p>;

  return <div className="entrants-manager">
    <div className="entrant-toolbar">
      <div>
        <p className="eyebrow">Selected</p>
        <h3>{entries.length} / {maxEntries} entrants</h3>
        <p className="muted">{knockoutOnly ? 'Knockout seeding uses average rating, highest first. The tournament entrant count is synchronized directly from this list.' : 'Group seeding uses average rating, highest first. Use Replace/Edit after fixtures are approved so the entry ID, assigned group, seed, pot and fixtures stay intact.'}</p>
      </div>
      <div className="button-row">
        <button type="button" className="secondary" onClick={loadEntrants} disabled={loading}>Reload</button>
        <button type="button" className="secondary" onClick={seedDemoEntrants} disabled={loading}>Seed demo 64</button>
        <button type="button" onClick={buildEntrantPreview} disabled={entries.length === 0}>{knockoutOnly ? 'Prepare Knockout Draw' : 'Generate Groups'}</button>
      </div>
    </div>

    <p className="status">{status}</p>

    {editing && <section className="entrant-panel replacement-panel">
      <h3>{editing.is_new ? `Add ${editing.team_name}` : 'Replace / edit entrant safely'}</h3>
      <p className="muted">{editing.is_new ? 'Confirm the manager and enter the team’s average rating before adding it. No placeholder manager or guessed rating will be created.' : 'This updates only team, manager and rating on the existing tournament entry. It does not change fixtures, group, seed or pot.'}</p>
      <form onSubmit={saveEntrantEdit}>
        <div className="mini-grid">
          <label>Manager name<input value={editing.manager_name} onChange={(event) => setEditing((current) => ({ ...current, manager_name: event.target.value }))} /></label>
          <label>Team name<input value={editing.team_name} readOnly={editing.is_new} onChange={(event) => setEditing((current) => ({ ...current, team_name: event.target.value }))} /></label>
          <label>Team rating<input type="number" min={editing.is_new ? 65 : undefined} max={editing.is_new ? 95 : undefined} step="1" value={editing.rating} onChange={(event) => setEditing((current) => ({ ...current, rating: event.target.value }))} /></label>
        </div>
        <div className="button-row">
          <button type="submit" disabled={loading}>{editing.is_new ? 'Add entrant' : 'Save replacement'}</button>
          <button type="button" className="secondary" onClick={() => setEditing(null)} disabled={loading}>Cancel</button>
        </div>
      </form>
    </section>}

    <div className="entrant-panels">
      <section className="entrant-panel">
        <h3>Selected entrants</h3>
        {entries.length === 0 ? <p className="muted">No entrants yet. Add teams one by one, seed the demo 64, paste rows, or import a published Google Sheet CSV.</p> : <div className="entrant-list">{entries.map((entry) => <article className="entrant-row selected" key={entry.id}>
          <div><strong>{entry.seed}. {entry.teams?.name || 'Unknown team'}</strong><span>{entry.managers?.display_name || entry.managers?.name || 'TBC Manager'} · rating {entry.rating || '-'} · pot {entry.pot || '-'} · group {entry.group_code || '-'}</span></div>
          <div className="button-row"><button type="button" className="secondary" onClick={() => setEditing(makeEditForm(entry))} disabled={loading}>Replace/Edit</button><button type="button" className="danger" onClick={() => removeEntrant(entry)} disabled={loading}>Remove</button></div>
        </article>)}</div>}
      </section>

      <section className="entrant-panel">
        <h3>Bulk import</h3>
        <p className="muted">Paste rows as: manager, team, average rating. Ratings must be whole numbers. A header row is fine. Team and manager names are matched to the existing directories; unique short names such as Nice can match OGC Nice.</p>
        <textarea rows="8" value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder="Manager, Team, Rating&#10;Zé Quim, Nice, 89" />
        <div className="button-row"><button type="button" className="secondary" onClick={importBulkText} disabled={loading}>Import pasted rows</button></div>
        <label>Published Google Sheet CSV URL<input value={sheetCsvUrl} onChange={(event) => setSheetCsvUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv" /></label>
        <button type="button" className="secondary" onClick={importSheetCsv} disabled={loading}>Import from Google Sheet CSV</button>
      </section>

      <section className="entrant-panel">
        <h3>Add teams</h3>
        <p className="muted">Choose a team, then confirm its manager and whole-number average rating before adding it.</p>
        <input placeholder="Search teams..." value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="entrant-list">{filteredTeams.map((team) => <article className="entrant-row" key={team.id}>
          <div><strong>{team.name}</strong><span>{team.current_manager_name ? `Manager: ${team.current_manager_name}` : 'Available for selection'}</span></div>
          <button type="button" className="secondary" onClick={() => beginAddTeam(team)} disabled={loading || entries.length >= maxEntries}>Add</button>
        </article>)}</div>
      </section>
    </div>
  </div>;
}
