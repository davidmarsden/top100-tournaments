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
    setStatus('Approving groups and saving fixtures...');

    try {
      const tournamentId = selectedTournament.id;
      await supabase.from('matches').delete().eq('tournament_id', tournamentId);
      await supabase.from('groups').delete().eq('tournament_id', tournamentId);

      const groupRows = preview.groups.map((group, index) => ({
        tournament_id: tournamentId,
        code: group.code,
        name: 'Group ' + group.code,
        group_order: index + 1,
      }));

      const { data: insertedGroups, error: groupError } = await supabase.from('groups').insert(groupRows).select('id, code');
      if (groupError) throw groupError;
      const groupIdByCode = new Map((insertedGroups || []).map((group) => [group.code, group.id]));

      for (const group of preview.groups) {
        for (const entry of group.entries) {
          const { error: entryError } = await supabase.from('tournament_entries').update({ group_code: group.code, pot: entry.pot }).eq('id', entry.id);
          if (entryError) throw entryError;
        }
      }

      const matchRows = preview.fixtures.map((fixture) => ({
        tournament_id: tournamentId,
        group_id: groupIdByCode.get(fixture.group_code) || null,
        stage: 'group',
        round: fixture.round,
        leg: fixture.leg || 1,
        match_order: fixture.match_order,
        home_entry_id: fixture.home_entry_id || null,
        away_entry_id: fixture.away_entry_id || null,
        home_placeholder: fixture.home_placeholder,
        away_placeholder: fixture.away_placeholder,
        bracket: 'Group Stage',
        status: 'scheduled',
      }));

      const { error: matchError } = await supabase.from('matches').insert(matchRows);
      if (matchError) throw matchError;

      const { error: tournamentError } = await supabase.from('tournaments').update({
        status: 'groups_approved',
        actual_entries: preview.groups.reduce((total, group) => total + group.entries.length, 0),
      }).eq('id', tournamentId);
      if (tournamentError) throw tournamentError;

      await onDataChanged?.();
      setStatus('Draw approved and fixtures saved. The builder is ready for results.');
    } catch (error) {
      setStatus('Approval failed: ' + error.message);
    } finally {
      setSaving(false);
    }
  }

  if (!preview) return <p className="muted">Generate groups from the Tournament Builder or Entrants tab. This tab will then show the proposed groups for approval.</p>;

  return <>
    <div className="draw-actions">
      <div><p className="eyebrow">Draw room</p><h3>{preview.groups.length} groups · {preview.fixtures.length} fixtures</h3><p className="muted">Review the seeded draw, then approve it to save the groups and group-stage fixtures.</p></div>
      <div className="button-row"><button type="button" onClick={approveDraw} disabled={saving}>{saving ? 'Saving...' : 'Approve draw'}</button><button type="button" className="secondary" onClick={() => setPreview(null)} disabled={saving}>Regenerate</button></div>
    </div>
    <p className="status">{status}</p>
    <div className="preview-groups">{preview.groups.map((group) => <article className="group-card" key={group.code}><h3>Group {group.code}</h3><ol>{group.entries.map((entry) => <li key={entry.id}><strong>{entry.seed}.</strong> {entry.team_name}<span>{entry.manager_name || 'TBC'} · Pot {entry.pot}</span></li>)}</ol></article>)}</div>
  </>;
}
