const presets = [
  { name: 'Top 100', slug: 'top-100' },
  { name: 'Top 100 Regen', slug: 'regen' },
];

const competitions = [
  { name: 'Youth Cup', slug: 'youth-cup', secondary: 'Shield' },
  { name: 'World Club Cup', slug: 'world-club-cup', secondary: '' },
];

export default function GameWorldSelector({ form, updateField }) {
  function applyWorld(event) {
    const preset = presets.find((item) => item.slug === event.target.value);
    if (!preset) return;
    updateField('gameWorldName', preset.name);
    updateField('gameWorldSlug', preset.slug);
  }
  function applyCompetition(event) {
    const preset = competitions.find((item) => item.slug === event.target.value);
    if (!preset) return;
    updateField('competitionName', preset.name);
    updateField('competitionSlug', preset.slug);
    if (preset.secondary !== undefined) updateField('secondaryBracketName', preset.secondary);
  }

  return <>
    <div className="mini-grid">
      <label>World preset<select value={form.gameWorldSlug || 'top-100'} onChange={applyWorld}>{presets.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
      <label>Game world<input value={form.gameWorldName} onChange={(event) => updateField('gameWorldName', event.target.value)} /></label>
      <label>World slug<input value={form.gameWorldSlug} onChange={(event) => updateField('gameWorldSlug', event.target.value)} /></label>
    </div>
    <div className="mini-grid">
      <label>Competition preset<select value={form.competitionSlug || 'youth-cup'} onChange={applyCompetition}>{competitions.map((item) => <option key={item.slug} value={item.slug}>{item.name}</option>)}</select></label>
      <label>Competition<input value={form.competitionName} onChange={(event) => updateField('competitionName', event.target.value)} /></label>
      <label>Competition slug<input value={form.competitionSlug} onChange={(event) => updateField('competitionSlug', event.target.value)} /></label>
    </div>
  </>;
}
