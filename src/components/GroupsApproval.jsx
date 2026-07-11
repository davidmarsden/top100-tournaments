import { useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

export default function GroupsApproval({ selectedTournament, preview, setPreview, onDataChanged }) {
  const [status, setStatus] = useState('Ready to approve draw');
  const [saving, setSaving] = useState(false);

  async function approveDraw() {
    if (!selectedTournament) return setStatus('Select a tournament first.');
    if (!preview?.groups?.length) return setStatus('Generate groups first.');
    if (!hasSupabaseConfig || !supabase) return setStatus('Supabase is not connected.');

    setSaving(true);
    setStatus('Approving groups...');

    try {
      const tournamentId = selectedTournament.id;

      const { count: existingMatchCount, error: matchCountError } = await supabase
        .from('matches')
        .select('id', { count: 'exact', head: true })
        .eq('tournament_id', tournamentId);
      if (matchCountError) throw matchCountError;
      if (existingMatchCount) throw new Error('Fixtures already exist. Delete or reset them before replacing the group draw.');

      const { error: clearGroupsError } = await supabase.from('groups').delete().eq('tournament_id', tournamentId);
      if (clearGroupsError) throw clearGroupsError;

      const groupRows = preview.groups.map((group, index) => ({
        tournament_id: tournamentId,
        code: group.code,
        name: 'Group ' + group.code,
        group_order: index + 1,
      }));

      const { error: groupError } = await supabase.from('groups').insert(groupRows);
      if (groupError) throw groupError;

      for (const group of preview.groups) {
        for (const entry of group.entries) {
          const { error: entryError } = await supabase
            .from('tournament_entries')
            .update({ group_code: group.code, pot: entry.pot })
            .eq('id', entry.id);
          if (entryError) throw entryError;
        }
      }

      const { error: tournamentError } = await supabase.from('tournaments').update({
        status: 'groups_approved',
        actual_entries: preview.groups.reduce((total, group) => total + group.entries.length, 0),
      }).eq('id', tournamentId);
      if (tournamentError) throw tournamentError;

      await onDataChanged?.();
      setStatus('Groups approved. Return to the Tournament Builder to generate fixtures.');
    } catch (error) {
      setStatus('Approval failed: ' + error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!preview) return <p className="muted">Generate groups from the Tournament Builder or Entrants tab. This tab will then show the proposed groups for approval.</p>;

  return <>
    <div className="draw-actions">
      <div>
        <p className="eyebrow">Draw room</p>
        <h3>{preview.groups.length} groups · {preview.groups.reduce((total, group) => total + group.entries.length, 0)} entrants</h3>
        <p className="muted">Review the seeded draw, then approve the groups and team assignments. Fixtures are generated separately in the next builder step.</p>
      </div>
      <div className="button-row">
        <button type="button" onClick={approveDraw} disabled={saving}>{saving ? 'Saving...' : 'Approve groups'}</button>
        <button type="button" className="secondary" onClick={() => setPreview(null)} disabled={saving}>Regenerate</button>
      </div>
    </div>
    <p className="status">{status}</p>
    <div className="preview-groups">{preview.groups.map((group) => <article className="group-card" key={group.code}><h3>Group {group.code}</h3><ol>{group.entries.map((entry) => <li key={entry.id}><strong>{entry.seed}.</strong> {entry.team_name}<span>{entry.manager_name || 'TBC'} · Pot {entry.pot}</span></li>)}</ol></article>)}</div>
  </>;
}
