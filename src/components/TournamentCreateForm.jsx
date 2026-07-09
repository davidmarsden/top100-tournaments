import GameWorldSelector from './GameWorldSelector.jsx';
import { useTournament } from '../context/TournamentProvider.jsx';

export default function TournamentCreateForm({ onDemoPreview }) {
  const { form, updateField, createTournament, loading, status, demoPreview } = useTournament();
  function preview() {
    const result = demoPreview();
    onDemoPreview?.(result);
  }

  return <form className="card" onSubmit={createTournament}>
    <div className="card-header"><p className="eyebrow">Tournament settings</p><h2>Create or configure tournament</h2></div>
    <GameWorldSelector form={form} updateField={updateField} />
    <div className="mini-grid"><label>Season<input value={form.seasonCode} onChange={(event) => updateField('seasonCode', event.target.value)} /></label><label>Registration<select value={form.registrationStatus || 'closed'} onChange={(event) => updateField('registrationStatus', event.target.value)}><option value="closed">Closed</option><option value="open">Open</option><option value="paused">Paused</option><option value="full">Full</option></select></label></div>
    <label>Tournament name<input value={form.tournamentName} onChange={(event) => updateField('tournamentName', event.target.value)} /></label>
    <div className="mini-grid"><label>Max entries<input type="number" value={form.maxEntries} onChange={(event) => updateField('maxEntries', event.target.value)} /></label><label>Groups<input type="number" value={form.groupCount} onChange={(event) => updateField('groupCount', event.target.value)} /></label><label>Teams/group<input type="number" value={form.teamsPerGroup} onChange={(event) => updateField('teamsPerGroup', event.target.value)} /></label><label>Knockout teams<input type="number" value={form.knockoutTeams} onChange={(event) => updateField('knockoutTeams', event.target.value)} /></label></div>
    <label>Secondary bracket<input value={form.secondaryBracketName} onChange={(event) => updateField('secondaryBracketName', event.target.value)} /></label>
    <div className="button-row"><button type="submit" disabled={loading}>{loading ? 'Working...' : 'Create tournament'}</button><button type="button" className="secondary" onClick={preview}>Demo preview</button></div>
    <p className="status">{status}</p>
  </form>;
}
