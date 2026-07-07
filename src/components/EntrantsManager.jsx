import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const demoTeams = ['Genoa', 'Espanyol', 'Bayern Munich', 'Barcelona', 'CSKA', 'Hertha Berlin', 'Independiente', 'River Plate', 'Montpellier', 'West Brom', 'Club Brugge', 'Juventus', 'Leicester Youth', 'Levante', 'Dortmund', 'Hamburg', 'Stoke City', 'Sao Paulo', 'FC Porto', 'Sampdoria', 'Sporting', 'SC Internacional', 'Chelsea', 'Anderlecht', 'Celtic Factory', 'Dynamo Moskva', 'Besiktas', 'PSV', 'AC Milan', 'Crystal Palace', 'Fenerbahce', 'Monaco', 'Benfica', 'Cruzeiro', 'Liverpool', 'Athletic Club', 'Tottenham', 'Werder Bremen', 'Villarreal', 'Real Madrid', 'Udinese', 'Valencia', 'Wolfsburg', 'CR Flamengo', 'Leverkusen', 'Swansea', 'Newcastle United', 'Saint Etienne', 'Ajax', 'Roma', 'Lazio', 'Marseille', 'Fiorentina', 'Lyon', 'Sevilla', 'Porto B', 'Everton', 'Napoli', 'Atalanta', 'Boca Juniors', 'Palmeiras', 'Flamengo Youth', 'Galatasaray', 'Rangers'];

function parseCsv(text) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const hasHeader = /manager|team|rating/i.test(lines[0]);
  const dataLines = hasHeader ? lines.slice(1) : lines;
  return dataLines.map((line) => {
    const parts = line.split(/\t|,/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 3) return null;
    const [manager_name, team_name, rating] = parts;
    return { manager_name, team_name, rating: Number(rating) };
  }).filter((row) => row && row.manager_name && row.team_name && Number.isFinite(row.rating));
}

function makeEditForm(entry) {
  return {
    id: entry.id,
    manager_name: entry.managers?.display_name || entry.managers?.name || 'TBC Manager',
    team_name: entry.teams?.name || '',
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
  const maxEntries = Number(selectedTournament?.max_entries || 64);

  useEffect(() => { if (hasSupabaseConfig && supabase && tournamentId) { loadEntrants(); loadTeams(); } }, [tournamentId]);
  const filteredTeams = useMemo(() => { const selectedTeamIds = new Set(entries.map((entry) => entry.team_id)); const needle = query.trim().toLowerCase(); return teams.filter((team) => !selectedTeamIds.has(team.id)).filter((team) => !needle || team.name.toLowerCase().includes(needle)).slice(0, 80); }, [entries, teams, query]);

  async function loadTeams() { const { data, error } = await supabase.from('teams').select('id, name').order('name', { ascending: true }); if (error) return setStatus('Could not load teams: ' + error.message); setTeams(data || []); }
  async function loadEntrants() { if (!tournamentId) return; const { data, error } = await supabase.from('tournament_entries').select('id, tournament_id, team_id, manager_id, seed, rating, entry_status, group_code, pot, teams(id, name), managers(id, name, display_name)').eq('tournament_id', tournamentId).order('seed', { ascending: true }); if (error) return setStatus('Could not load entrants: ' + error.message); setEntries(data || []); setStatus('Entrants loaded'); }
  async function findOrCreateTeam(name) { const clean = String(name || '').trim(); if (!clean) throw new Error('Team name is required.'); const { data: existing, error: findError } = await supabase.from('teams').select('id').ilike('name', clean).maybeSingle(); if (findError) throw findError; if (existing) return existing.id; const { data, error } = await supabase.from('teams').insert({ name: clean, active: true }).select('id').single(); if (error) throw error; return data.id; }
  async function findOrCreateManager(name) { const clean = String(name || '').trim() || 'TBC Manager'; const { data: existing, error: findError } = await supabase.from('managers').select('id').ilike('name', clean).maybeSingle(); if (findError) throw findError; if (existing) return existing.id; const { data, error } = await supabase.from('managers').insert({ name: clean, display_name: clean, canonical_name: clean.toLowerCase(), active: true }).select('id').single(); if (error) throw error; return data.id; }
  async function addTeamAsEntrant(team, seed = null) { if (!tournamentId) return; setLoading(true); setStatus('Adding ' + team.name + '...'); try { const managerId = await findOrCreateManager('TBC Manager'); const nextSeed = seed || entries.length + 1; const { error } = await supabase.from('tournament_entries').insert({ tournament_id: tournamentId, team_id: team.id, manager_id: managerId, seed: nextSeed, rating: 100 - Math.floor((nextSeed - 1) / 4), entry_status: 'active', prize_draw_eligible: true }); if (error) throw error; await loadEntrants(); setStatus(team.name + ' added.'); } catch (error) { setStatus('Add failed: ' + error.message); } finally { setLoading(false); } }
  async function removeEntrant(entry) { setLoading(true); setStatus('Removing entrant...'); const { error } = await supabase.from('tournament_entries').delete().eq('id', entry.id); if (error) setStatus('Remove failed: ' + error.message); else { await loadEntrants(); setStatus('Entrant removed.'); } setLoading(false); }

  async function saveEntrantEdit(event) {
    event.preventDefault();
    if (!editing) return;
    const rating = Number(editing.rating);
    if (!editing.team_name.trim()) return setStatus('Replacement team name is required.');
    if (!editing.manager_name.trim()) return setStatus('Replacement manager name is required.');
    if (!Number.isFinite(rating)) return setStatus('Rating must be a number.');

    setLoading(true);
    setStatus('Updating entrant without changing group, seed, pot or fixtures...');
    try {
      const teamId = await findOrCreateTeam(editing.team_name);
      const managerId = await findOrCreateManager(editing.manager_name);
      const { error } = await supabase.from('tournament_entries').update({ team_id: teamId, manager_id: managerId, rating }).eq('id', editing.id);
      if (error) throw error;
      setEditing(null);
      await loadTeams();
      await loadEntrants();
      setStatus('Entrant updated. Group, seed, pot and fixtures were preserved.');
    } catch (error) {
      setStatus('Entrant update failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  async function seedDemoEntrants() { if (!tournamentId) return; setLoading(true); setStatus('Creating demo entrant set...'); try { for (let index = 0; index < Math.min(maxEntries, demoTeams.length); index += 1) { const teamName = demoTeams[index]; const teamId = await findOrCreateTeam(teamName); const managerId = await findOrCreateManager('Manager ' + (index + 1)); const seed = index + 1; if (!entries.some((entry) => entry.team_id === teamId)) { const { error } = await supabase.from('tournament_entries').insert({ tournament_id: tournamentId, team_id: teamId, manager_id: managerId, seed, rating: 100 - Math.floor(index / 4), entry_status: 'active', prize_draw_eligible: true }); if (error && !String(error.message).includes('duplicate')) throw error; } } await loadTeams(); await loadEntrants(); setStatus('Demo entrant set created.'); } catch (error) { setStatus('Demo import failed: ' + error.message); } finally { setLoading(false); } }
  async function importRows(rows) { if (!rows.length) return setStatus('No valid rows found. Use: manager, team, average rating.'); setLoading(true); setStatus('Importing ' + rows.length + ' entrants...'); try { const sortedRows = rows.sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0) || a.team_name.localeCompare(b.team_name)).slice(0, maxEntries); for (let index = 0; index < sortedRows.length; index += 1) { const row = sortedRows[index]; const teamId = await findOrCreateTeam(row.team_name); const managerId = await findOrCreateManager(row.manager_name); const seed = index + 1; const alreadySelected = entries.some((entry) => entry.team_id === teamId); if (!alreadySelected) { const { error } = await supabase.from('tournament_entries').insert({ tournament_id: tournamentId, team_id: teamId, manager_id: managerId, seed, rating: row.rating, entry_status: 'active', prize_draw_eligible: true }); if (error && !String(error.message).includes('duplicate')) throw error; } } await loadTeams(); await loadEntrants(); setStatus('Imported and seeded by average rating.'); } catch (error) { setStatus('Import failed: ' + error.message); } finally { setLoading(false); } }
  async function importBulkText() { await importRows(parseCsv(bulkText)); }
  async function importSheetCsv() { if (!sheetCsvUrl) return setStatus('Paste a published Google Sheet CSV URL first.'); setLoading(true); setStatus('Fetching Google Sheet CSV...'); try { const response = await fetch(sheetCsvUrl); if (!response.ok) throw new Error('CSV fetch failed: ' + response.status); const text = await response.text(); setBulkText(text); await importRows(parseCsv(text)); } catch (error) { setStatus('Google Sheet import failed: ' + error.message); } finally { setLoading(false); } }
  function buildEntrantPreview() { const previewEntries = entries.map((entry) => ({ id: entry.id, team_name: entry.teams?.name || 'Unknown team', manager_name: entry.managers?.display_name || entry.managers?.name || 'TBC', seed: entry.seed, rating: entry.rating })); onPreviewGenerated(previewEntries); }

  if (!selectedTournament) return <p className="muted">Create or select a tournament first.</p>;
  return <div className="entrants-manager"><div className="entrant-toolbar"><div><p className="eyebrow">Selected</p><h3>{entries.length} / {maxEntries} entrants</h3><p className="muted">Group seeding uses average rating, highest first. Use Replace/Edit after fixtures are approved so the entry ID, assigned group, seed, pot and fixtures stay intact.</p></div><div className="button-row"><button type="button" className="secondary" onClick={loadEntrants} disabled={loading}>Reload</button><button type="button" className="secondary" onClick={seedDemoEntrants} disabled={loading}>Seed demo 64</button><button type="button" onClick={buildEntrantPreview} disabled={entries.length === 0}>Generate Groups</button></div></div><p className="status">{status}</p>{editing && <section className="entrant-panel replacement-panel"><h3>Replace / edit entrant safely</h3><p className="muted">This updates only team, manager and rating on the existing tournament entry. It does not change fixtures, group, seed or pot.</p><form onSubmit={saveEntrantEdit}><div className="mini-grid"><label>Manager name<input value={editing.manager_name} onChange={(event) => setEditing((current) => ({ ...current, manager_name: event.target.value }))} /></label><label>Team name<input value={editing.team_name} onChange={(event) => setEditing((current) => ({ ...current, team_name: event.target.value }))} /></label><label>Team rating<input type="number" step="0.1" value={editing.rating} onChange={(event) => setEditing((current) => ({ ...current, rating: event.target.value }))} /></label></div><div className="button-row"><button type="submit" disabled={loading}>Save replacement</button><button type="button" className="secondary" onClick={() => setEditing(null)} disabled={loading}>Cancel</button></div></form></section>}<div className="entrant-panels"><section className="entrant-panel"><h3>Selected entrants</h3>{entries.length === 0 ? <p className="muted">No entrants yet. Add teams one by one, seed the demo 64, paste rows, or import a published Google Sheet CSV.</p> : <div className="entrant-list">{entries.map((entry) => <article className="entrant-row selected" key={entry.id}><div><strong>{entry.seed}. {entry.teams?.name || 'Unknown team'}</strong><span>{entry.managers?.display_name || entry.managers?.name || 'TBC Manager'} · rating {entry.rating || '-'} · pot {entry.pot || '-'} · group {entry.group_code || '-'}</span></div><div className="button-row"><button type="button" className="secondary" onClick={() => setEditing(makeEditForm(entry))} disabled={loading}>Replace/Edit</button><button type="button" className="danger" onClick={() => removeEntrant(entry)} disabled={loading}>Remove</button></div></article>)}</div>}</section><section className="entrant-panel"><h3>Bulk import</h3><p className="muted">Paste rows as: manager, team, average rating. A header row is fine.</p><textarea rows="8" value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder="Manager, Team, Rating&#10;David Marsden, Hamburg, 89.4" /><div className="button-row"><button type="button" className="secondary" onClick={importBulkText} disabled={loading}>Import pasted rows</button></div><label>Published Google Sheet CSV URL<input value={sheetCsvUrl} onChange={(event) => setSheetCsvUrl(event.target.value)} placeholder="https://docs.google.com/spreadsheets/d/.../export?format=csv" /></label><button type="button" className="secondary" onClick={importSheetCsv} disabled={loading}>Import from Google Sheet CSV</button></section><section className="entrant-panel"><h3>Add teams</h3><input placeholder="Search teams..." value={query} onChange={(event) => setQuery(event.target.value)} /><div className="entrant-list">{filteredTeams.map((team) => <article className="entrant-row" key={team.id}><div><strong>{team.name}</strong><span>Available for selection</span></div><button type="button" className="secondary" onClick={() => addTeamAsEntrant(team)} disabled={loading || entries.length >= maxEntries}>Add</button></article>)}</div></section></div></div>;
}
