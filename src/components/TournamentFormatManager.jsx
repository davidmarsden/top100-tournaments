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
  const [form, setForm] = useState({ maxEntries: '', groupCount: '', teamsPerGroup: '', knockoutTeams: '', secondaryBracketName: '' });
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setForm({
      maxEntries: inputValue(selectedTournament?.max_entries),
      groupCount: inputValue(selectedTournament?.group_count),
      teamsPerGroup: inputValue(selectedTournament?.teams_per_group),
      knockoutTeams: inputValue(selectedTournament?.knockout_teams),
      secondaryBracketName: selectedTournament?.secondary_bracket_name || '',
    });
  }, [selectedTournament?.id, selectedTournament?.max_entries, selectedTournament?.group_count, selectedTournament?.teams_per_group, selectedTournament?.knockout_teams, selectedTournament?.secondary_bracket_name]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    if (!selectedTournament?.id) return;
    setLoading(true);
    setStatus('Saving tournament shape...');
    const payload = {
      max_entries: numberOrNull(form.maxEntries),
      group_count: numberOrNull(form.groupCount),
      teams_per_group: numberOrNull(form.teamsPerGroup),
      knockout_teams: numberOrNull(form.knockoutTeams),
      secondary_bracket_name: String(form.secondaryBracketName || '').trim() || null,
    };
    const { error } = await supabase.from('tournaments').update(payload).eq('id', selectedTournament.id);
    if (error) setStatus('Could not save tournament shape: ' + error.message);
    else {
      setStatus('Tournament shape saved. Group generation will now use these values.');
      await onTournamentUpdated?.();
    }
    setLoading(false);
  }

  if (!selectedTournament) return <p className="muted">Select a tournament first.</p>;

  const undecided = !Number(selectedTournament.max_entries || 0) || !Number(selectedTournament.group_count || 0) || !Number(selectedTournament.teams_per_group || 0) || !Number(selectedTournament.knockout_teams || 0);

  return <form className="registration-manager" onSubmit={save}>
    <section className="entrant-panel">
      <p className="eyebrow">Tournament shape</p>
      <h3>{selectedTournament.name}</h3>
      <p className="muted">Registration can open before any of these numbers are known. Once the entry list is clear, set the capacity and competition shape here before generating groups or fixtures.</p>
      {undecided && <p className="status">Format still to be decided — registration can continue normally.</p>}
      <div className="mini-grid">
        <label>Final entries<input type="number" min="2" value={form.maxEntries} onChange={(event) => update('maxEntries', event.target.value)} placeholder="Decide after registration" /></label>
        <label>Groups<input type="number" min="1" value={form.groupCount} onChange={(event) => update('groupCount', event.target.value)} placeholder="TBC" /></label>
        <label>Teams/group<input type="number" min="2" value={form.teamsPerGroup} onChange={(event) => update('teamsPerGroup', event.target.value)} placeholder="TBC" /></label>
        <label>Knockout teams<input type="number" min="2" value={form.knockoutTeams} onChange={(event) => update('knockoutTeams', event.target.value)} placeholder="TBC" /></label>
      </div>
      <label>Secondary bracket<input value={form.secondaryBracketName} onChange={(event) => update('secondaryBracketName', event.target.value)} placeholder="Optional — e.g. Shield" /></label>
      <div className="button-row"><button type="submit" disabled={loading}>{loading ? 'Saving...' : 'Save tournament shape'}</button></div>
      <p className="status">{status}</p>
    </section>
  </form>;
}
