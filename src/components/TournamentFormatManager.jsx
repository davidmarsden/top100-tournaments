import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

function inputValue(value) {
  return value === null || value === undefined || Number(value) === 0 ? '' : String(value);
}

function numberOrNull(value) {
  const clean = String(value || '').trim();
  if (!clean) return null;
  const number = Number(clean);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null;
}

export default function TournamentFormatManager({ selectedTournament, onTournamentUpdated }) {
  const [form, setForm] = useState({ structure: 'group_knockout', maxEntries: '', groupCount: '', teamsPerGroup: '', knockoutTeams: '', secondaryBracketName: '' });
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setForm({
      structure: selectedTournament?.tournament_structure || 'group_knockout',
      maxEntries: inputValue(selectedTournament?.max_entries),
      groupCount: inputValue(selectedTournament?.group_count),
      teamsPerGroup: inputValue(selectedTournament?.teams_per_group),
      knockoutTeams: inputValue(selectedTournament?.knockout_teams),
      secondaryBracketName: selectedTournament?.secondary_bracket_name || '',
    });
  }, [selectedTournament?.id, selectedTournament?.tournament_structure, selectedTournament?.max_entries, selectedTournament?.group_count, selectedTournament?.teams_per_group, selectedTournament?.knockout_teams, selectedTournament?.secondary_bracket_name]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function canChangeStructure(nextStructure) {
    const currentStructure = selectedTournament?.tournament_structure || 'group_knockout';
    if (nextStructure === currentStructure) return true;
    const [groupsResult, matchesResult] = await Promise.all([
      supabase.from('groups').select('id', { count: 'exact', head: true }).eq('tournament_id', selectedTournament.id),
      supabase.from('matches').select('id', { count: 'exact', head: true }).eq('tournament_id', selectedTournament.id),
    ]);
    const error = groupsResult.error || matchesResult.error;
    if (error) throw error;
    if ((groupsResult.count || 0) > 0 || (matchesResult.count || 0) > 0) {
      setStatus('Tournament structure cannot be changed after groups or fixtures have been created.');
      return false;
    }
    return true;
  }

  async function save(event) {
    event.preventDefault();
    if (!selectedTournament?.id) return;
    setLoading(true);
    setStatus('Saving tournament shape...');
    try {
      if (!(await canChangeStructure(form.structure))) return;
      const knockoutOnly = form.structure === 'knockout_only';
      const maxEntries = numberOrNull(form.maxEntries);
      const knockoutTeams = numberOrNull(form.knockoutTeams) || (knockoutOnly ? maxEntries : null);
      if (!maxEntries || !knockoutTeams) {
        setStatus('Set the final entry count and knockout field before saving the format.');
        return;
      }
      if (knockoutTeams > maxEntries) {
        setStatus('Knockout teams cannot exceed the final entry count.');
        return;
      }
      const payload = {
        tournament_structure: form.structure,
        max_entries: maxEntries,
        group_count: knockoutOnly ? null : numberOrNull(form.groupCount),
        teams_per_group: knockoutOnly ? null : numberOrNull(form.teamsPerGroup),
        knockout_teams: knockoutTeams,
        secondary_bracket_name: knockoutOnly ? null : String(form.secondaryBracketName || '').trim() || null,
      };
      if (!knockoutOnly && (!payload.group_count || !payload.teams_per_group)) {
        setStatus('Group + knockout tournaments need both a group count and teams per group.');
        return;
      }
      const { error } = await supabase.from('tournaments').update(payload).eq('id', selectedTournament.id);
      if (error) setStatus('Could not save tournament shape: ' + error.message);
      else {
        setStatus(knockoutOnly ? 'Knockout-only format saved. Entrants will go directly into the seeded knockout draw.' : 'Group + knockout format saved. Group generation will use these values.');
        await onTournamentUpdated?.();
      }
    } catch (error) {
      setStatus('Could not save tournament shape: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  if (!selectedTournament) return <p className="muted">Select a tournament first.</p>;

  const knockoutOnly = form.structure === 'knockout_only';
  const formatReady = Boolean(Number(selectedTournament.max_entries || 0) > 0 && Number(selectedTournament.knockout_teams || 0) > 0 && (selectedTournament.tournament_structure === 'knockout_only' || (Number(selectedTournament.group_count || 0) > 0 && Number(selectedTournament.teams_per_group || 0) > 0)));

  return <form className="registration-manager" onSubmit={save}>
    <section className="entrant-panel">
      <p className="eyebrow">Tournament shape</p>
      <h3>{selectedTournament.name}</h3>
      <p className="muted">Choose the competition structure once registration has made the likely field clear. Knockout-only tournaments skip groups and tables completely.</p>
      {!formatReady && <p className="status">Format still to be decided — registration can continue normally.</p>}
      <label>Tournament structure<select value={form.structure} onChange={(event) => update('structure', event.target.value)}>
        <option value="group_knockout">Group stage + knockout</option>
        <option value="knockout_only">Knockout only</option>
      </select></label>
      <div className="mini-grid">
        <label>Final entries<input type="number" min="2" max="64" value={form.maxEntries} onChange={(event) => update('maxEntries', event.target.value)} placeholder="Decide after registration" /></label>
        {!knockoutOnly && <label>Groups<input type="number" min="1" value={form.groupCount} onChange={(event) => update('groupCount', event.target.value)} placeholder="TBC" /></label>}
        {!knockoutOnly && <label>Teams/group<input type="number" min="2" value={form.teamsPerGroup} onChange={(event) => update('teamsPerGroup', event.target.value)} placeholder="TBC" /></label>}
        <label>Knockout teams<input type="number" min="2" max="64" value={form.knockoutTeams} onChange={(event) => update('knockoutTeams', event.target.value)} placeholder={knockoutOnly ? 'Defaults to final entries' : 'TBC'} /></label>
      </div>
      {knockoutOnly ? <p className="muted">The opening draw will use the entrant seeds directly. If the field is not a power of two, the highest seeds receive the required byes. Knockout-only currently uses a single Cup bracket.</p> : <label>Secondary bracket<input value={form.secondaryBracketName} onChange={(event) => update('secondaryBracketName', event.target.value)} placeholder="Optional — e.g. Shield" /></label>}
      <div className="button-row"><button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save tournament shape'}</button></div>
      <p className="status">{status}</p>
    </section>
  </form>;
}
