import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function addDays(dateString, days) {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function formatDate(dateString) {
  if (!dateString) return 'Not set';
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function roundName(round) {
  return round.round_name || round.name || round.round;
}

function hasSecondLegForTemplate(round) {
  return Number(round?.legs || 1) > 1;
}

export default function KnockoutScheduleManager({ selectedTournament, roundTemplates = [], onDataChanged }) {
  const [presets, setPresets] = useState([]);
  const [bracket, setBracket] = useState(roundTemplates[0]?.bracket || 'Cup');
  const [round, setRound] = useState(roundName(roundTemplates[0] || {}) || 'R32');
  const [leg1Date, setLeg1Date] = useState('');
  const [leg2Date, setLeg2Date] = useState('');
  const [editingDates, setEditingDates] = useState({});
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const tournamentId = selectedTournament?.id;

  const sortedTemplates = useMemo(() => [...roundTemplates].sort((a, b) => String(a.bracket).localeCompare(String(b.bracket)) || Number(a.round_order || 0) - Number(b.round_order || 0)), [roundTemplates]);
  const brackets = useMemo(() => [...new Set(sortedTemplates.map((item) => item.bracket))], [sortedTemplates]);
  const roundsForBracket = useMemo(() => sortedTemplates.filter((item) => item.bracket === bracket), [sortedTemplates, bracket]);
  const selectedTemplate = useMemo(() => sortedTemplates.find((item) => item.bracket === bracket && roundName(item) === round), [sortedTemplates, bracket, round]);

  useEffect(() => { if (hasSupabaseConfig && supabase && tournamentId) loadPresets(); }, [tournamentId]);
  useEffect(() => {
    if (!brackets.includes(bracket) && brackets[0]) setBracket(brackets[0]);
  }, [brackets, bracket]);
  useEffect(() => {
    if (!roundsForBracket.some((item) => roundName(item) === round) && roundsForBracket[0]) setRound(roundName(roundsForBracket[0]));
  }, [roundsForBracket, round]);
  useEffect(() => {
    if (leg1Date && hasSecondLegForTemplate(selectedTemplate) && !leg2Date) setLeg2Date(addDays(leg1Date, 7));
    if (!hasSecondLegForTemplate(selectedTemplate)) setLeg2Date('');
  }, [selectedTemplate, leg1Date]);

  const presetMap = useMemo(() => new Map(presets.map((preset) => [preset.bracket + '|' + preset.round, preset])), [presets]);
  const scheduleItems = useMemo(() => sortedTemplates.map((template) => {
    const itemRound = roundName(template);
    const key = template.bracket + '|' + itemRound;
    const preset = presetMap.get(key);
    const draft = editingDates[key] || {};
    return {
      bracket: template.bracket,
      round: itemRound,
      key,
      oneLegOnly: !hasSecondLegForTemplate(template),
      leg1_date: draft.leg1_date ?? preset?.leg1_date ?? '',
      leg2_date: draft.leg2_date ?? preset?.leg2_date ?? '',
    };
  }), [sortedTemplates, presetMap, editingDates]);

  async function loadPresets() {
    setLoading(true);
    const { data, error } = await supabase.from('tournament_round_dates').select('id, bracket, round, leg1_date, leg2_date').eq('tournament_id', tournamentId).order('bracket', { ascending: true }).order('round', { ascending: true });
    if (error) setStatus('Could not load schedule presets. Run database/2026-07-05-knockout-schedule-presets.sql in Supabase first.');
    else { setPresets(data || []); setStatus('Schedule presets loaded.'); }
    setLoading(false);
  }

  async function upsertPreset(targetBracket, targetRound, targetLeg1Date, targetLeg2Date) {
    if (!targetLeg1Date) throw new Error('Choose the 1st-leg date first.');
    const template = sortedTemplates.find((item) => item.bracket === targetBracket && roundName(item) === targetRound);
    const secondLeg = hasSecondLegForTemplate(template) ? (targetLeg2Date || addDays(targetLeg1Date, 7)) : null;
    const row = { tournament_id: tournamentId, bracket: targetBracket, round: targetRound, leg1_date: targetLeg1Date, leg2_date: secondLeg, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('tournament_round_dates').upsert(row, { onConflict: 'tournament_id,bracket,round' });
    if (error) throw error;
    return secondLeg;
  }

  async function savePreset() {
    setLoading(true);
    try {
      const secondLeg = await upsertPreset(bracket, round, leg1Date, leg2Date);
      setStatus(hasSecondLegForTemplate(selectedTemplate) ? `${bracket} ${round} saved: 1st leg ${formatDate(leg1Date)}, 2nd leg ${formatDate(secondLeg)}.` : `${bracket} ${round} saved as one leg on ${formatDate(leg1Date)}.`);
      await loadPresets();
    } catch (error) {
      setStatus('Preset save failed: ' + error.message);
    }
    setLoading(false);
  }

  async function saveItem(item) {
    setLoading(true);
    try {
      const secondLeg = await upsertPreset(item.bracket, item.round, item.leg1_date, item.leg2_date);
      setEditingDates((current) => { const next = { ...current }; delete next[item.key]; return next; });
      setStatus(item.oneLegOnly ? `${item.bracket} ${item.round} saved as one leg on ${formatDate(item.leg1_date)}.` : `${item.bracket} ${item.round} saved: ${formatDate(item.leg1_date)} and ${formatDate(secondLeg)}.`);
      await loadPresets();
    } catch (error) {
      setStatus('Preset save failed: ' + error.message);
    }
    setLoading(false);
  }

  async function applyPresetsToExistingFixtures() {
    if (!presets.length) return setStatus('No schedule presets to apply yet.');
    setLoading(true);
    for (const preset of presets) {
      const template = sortedTemplates.find((item) => item.bracket === preset.bracket && roundName(item) === preset.round);
      const leg1 = await supabase.from('matches').update({ fixture_date: preset.leg1_date }).eq('tournament_id', tournamentId).eq('stage', 'knockout').eq('bracket', preset.bracket).eq('round', preset.round).eq('leg', 1);
      if (leg1.error) { setStatus('Apply failed: ' + leg1.error.message); setLoading(false); return; }
      if (hasSecondLegForTemplate(template)) {
        const leg2 = await supabase.from('matches').update({ fixture_date: preset.leg2_date || addDays(preset.leg1_date, 7) }).eq('tournament_id', tournamentId).eq('stage', 'knockout').eq('bracket', preset.bracket).eq('round', preset.round).eq('leg', 2);
        if (leg2.error) { setStatus('Apply failed: ' + leg2.error.message); setLoading(false); return; }
      }
    }
    await onDataChanged?.();
    setStatus('Schedule presets applied to existing knockout fixtures.');
    setLoading(false);
  }

  function updateDraft(key, field, value) {
    setEditingDates((current) => {
      const next = { ...current, [key]: { ...(current[key] || {}), [field]: value } };
      const [itemBracket, itemRound] = key.split('|');
      const template = sortedTemplates.find((item) => item.bracket === itemBracket && roundName(item) === itemRound);
      if (field === 'leg1_date' && value && hasSecondLegForTemplate(template) && !next[key].leg2_date) next[key].leg2_date = addDays(value, 7);
      if (!hasSecondLegForTemplate(template)) next[key].leg2_date = '';
      return next;
    });
  }

  if (!selectedTournament) return null;

  return <section className="bracket-section schedule-presets"><h3>Knockout schedule presets</h3><p className="muted">Round list and leg counts are loaded from template tables. For two-legged rounds, the suggested 2nd-leg date is exactly seven days after the 1st leg, but every date remains editable.</p><div className="filter-row multi"><label>Bracket<select value={bracket} onChange={(event) => setBracket(event.target.value)}>{brackets.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Round<select value={round} onChange={(event) => setRound(event.target.value)}>{roundsForBracket.map((item) => <option key={roundName(item)} value={roundName(item)}>{roundName(item)}</option>)}</select></label><label>1st-leg date<input type="date" value={leg1Date} onChange={(event) => setLeg1Date(event.target.value)} /></label>{hasSecondLegForTemplate(selectedTemplate) && <label>2nd-leg date<input type="date" value={leg2Date || (leg1Date ? addDays(leg1Date, 7) : '')} onChange={(event) => setLeg2Date(event.target.value)} /></label>}<button type="button" className="secondary" onClick={savePreset} disabled={loading}>Save preset</button><button type="button" onClick={applyPresetsToExistingFixtures} disabled={loading}>Apply presets to fixtures</button></div><p className="status">{status}</p><div className="tournament-grid schedule-grid">{scheduleItems.map((item) => <article className="tournament-card schedule-card" key={item.key}><strong>{item.bracket} {item.round}</strong><label>1st leg<input type="date" value={item.leg1_date} onChange={(event) => updateDraft(item.key, 'leg1_date', event.target.value)} /></label>{item.oneLegOnly ? <span>One leg only</span> : <label>2nd leg<input type="date" value={item.leg2_date || (item.leg1_date ? addDays(item.leg1_date, 7) : '')} onChange={(event) => updateDraft(item.key, 'leg2_date', event.target.value)} /></label>}<span>{item.leg1_date ? `1st leg: ${formatDate(item.leg1_date)}` : '1st leg: Not set'}</span>{!item.oneLegOnly && <span>{item.leg2_date ? `2nd leg: ${formatDate(item.leg2_date)}` : '2nd leg: Not set'}</span>}<button type="button" className="secondary" onClick={() => saveItem(item)} disabled={loading}>Save {item.round}</button></article>)}</div></section>;
}
