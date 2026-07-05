import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const ROUNDS = ['R32', 'R16', 'QF', 'SF', 'Final'];
const BRACKETS = ['Cup', 'Shield'];

function hasSecondLeg(bracket, round) {
  if (round === 'R32') return false;
  if (bracket === 'Shield' && round === 'R16') return false;
  return true;
}

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

export default function KnockoutScheduleManager({ selectedTournament, onDataChanged }) {
  const [presets, setPresets] = useState([]);
  const [bracket, setBracket] = useState('Cup');
  const [round, setRound] = useState('R32');
  const [leg1Date, setLeg1Date] = useState('');
  const [leg2Date, setLeg2Date] = useState('');
  const [editingDates, setEditingDates] = useState({});
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const tournamentId = selectedTournament?.id;

  useEffect(() => { if (hasSupabaseConfig && supabase && tournamentId) loadPresets(); }, [tournamentId]);
  useEffect(() => {
    if (leg1Date && hasSecondLeg(bracket, round) && !leg2Date) setLeg2Date(addDays(leg1Date, 7));
    if (!hasSecondLeg(bracket, round)) setLeg2Date('');
  }, [bracket, round, leg1Date]);

  const presetMap = useMemo(() => new Map(presets.map((preset) => [preset.bracket + '|' + preset.round, preset])), [presets]);
  const scheduleItems = useMemo(() => BRACKETS.flatMap((b) => ROUNDS.map((r) => {
    const preset = presetMap.get(b + '|' + r);
    const key = b + '|' + r;
    const draft = editingDates[key] || {};
    return {
      bracket: b,
      round: r,
      key,
      oneLegOnly: !hasSecondLeg(b, r),
      leg1_date: draft.leg1_date ?? preset?.leg1_date ?? '',
      leg2_date: draft.leg2_date ?? preset?.leg2_date ?? '',
    };
  })), [presetMap, editingDates]);

  async function loadPresets() {
    setLoading(true);
    const { data, error } = await supabase.from('tournament_round_dates').select('id, bracket, round, leg1_date, leg2_date').eq('tournament_id', tournamentId).order('bracket', { ascending: true }).order('round', { ascending: true });
    if (error) setStatus('Could not load schedule presets. Run database/2026-07-05-knockout-schedule-presets.sql in Supabase first.');
    else { setPresets(data || []); setStatus('Schedule presets loaded.'); }
    setLoading(false);
  }

  async function upsertPreset(targetBracket, targetRound, targetLeg1Date, targetLeg2Date) {
    if (!targetLeg1Date) return setStatus('Choose the 1st-leg date first.');
    const secondLeg = hasSecondLeg(targetBracket, targetRound) ? (targetLeg2Date || addDays(targetLeg1Date, 7)) : null;
    const row = { tournament_id: tournamentId, bracket: targetBracket, round: targetRound, leg1_date: targetLeg1Date, leg2_date: secondLeg, updated_at: new Date().toISOString() };
    const { error } = await supabase.from('tournament_round_dates').upsert(row, { onConflict: 'tournament_id,bracket,round' });
    if (error) throw error;
    return secondLeg;
  }

  async function savePreset() {
    setLoading(true);
    try {
      const secondLeg = await upsertPreset(bracket, round, leg1Date, leg2Date);
      setStatus(hasSecondLeg(bracket, round)
        ? `${bracket} ${round} saved: 1st leg ${formatDate(leg1Date)}, 2nd leg ${formatDate(secondLeg)}.`
        : `${bracket} ${round} saved as one leg on ${formatDate(leg1Date)}.`);
      await loadPresets();
    } catch (error) {
      setStatus('Preset save failed: ' + error.message);
    }
    setLoading(false);
  }

  async function saveItem(item) {
    if (!item.leg1_date) return setStatus('Choose a 1st-leg date for ' + item.bracket + ' ' + item.round + '.');
    setLoading(true);
    try {
      const secondLeg = await upsertPreset(item.bracket, item.round, item.leg1_date, item.leg2_date);
      setEditingDates((current) => {
        const next = { ...current };
        delete next[item.key];
        return next;
      });
      setStatus(hasSecondLeg(item.bracket, item.round)
        ? `${item.bracket} ${item.round} saved: ${formatDate(item.leg1_date)} and ${formatDate(secondLeg)}.`
        : `${item.bracket} ${item.round} saved as one leg on ${formatDate(item.leg1_date)}.`);
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
      const oneLegOnly = !hasSecondLeg(preset.bracket, preset.round);
      const leg1 = await supabase.from('matches').update({ fixture_date: preset.leg1_date }).eq('tournament_id', tournamentId).eq('stage', 'knockout').eq('bracket', preset.bracket).eq('round', preset.round).eq('leg', 1);
      if (leg1.error) { setStatus('Apply failed: ' + leg1.error.message); setLoading(false); return; }
      if (!oneLegOnly) {
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
      if (field === 'leg1_date' && value && hasSecondLeg(itemBracket, itemRound) && !next[key].leg2_date) next[key].leg2_date = addDays(value, 7);
      if (!hasSecondLeg(itemBracket, itemRound)) next[key].leg2_date = '';
      return next;
    });
  }

  if (!selectedTournament) return null;

  return <section className="bracket-section schedule-presets"><h3>Knockout schedule presets</h3><p className="muted">Set round dates before fixtures are known. R32 is one leg only. Shield R16 is one leg only. For two-legged rounds, the suggested 2nd-leg date is exactly seven days after the 1st leg, but every date is editable.</p><div className="filter-row multi"><label>Bracket<select value={bracket} onChange={(event) => setBracket(event.target.value)}>{BRACKETS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Round<select value={round} onChange={(event) => setRound(event.target.value)}>{ROUNDS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>1st-leg date<input type="date" value={leg1Date} onChange={(event) => setLeg1Date(event.target.value)} /></label>{hasSecondLeg(bracket, round) && <label>2nd-leg date<input type="date" value={leg2Date || (leg1Date ? addDays(leg1Date, 7) : '')} onChange={(event) => setLeg2Date(event.target.value)} /></label>}<button type="button" className="secondary" onClick={savePreset} disabled={loading}>Save preset</button><button type="button" onClick={applyPresetsToExistingFixtures} disabled={loading}>Apply presets to fixtures</button></div><p className="status">{status}</p><div className="tournament-grid schedule-grid">{scheduleItems.map((item) => <article className="tournament-card schedule-card" key={item.key}><strong>{item.bracket} {item.round}</strong><label>1st leg<input type="date" value={item.leg1_date} onChange={(event) => updateDraft(item.key, 'leg1_date', event.target.value)} /></label>{item.oneLegOnly ? <span>One leg only</span> : <label>2nd leg<input type="date" value={item.leg2_date || (item.leg1_date ? addDays(item.leg1_date, 7) : '')} onChange={(event) => updateDraft(item.key, 'leg2_date', event.target.value)} /></label>}<span>{item.leg1_date ? `1st leg: ${formatDate(item.leg1_date)}` : '1st leg: Not set'}</span>{!item.oneLegOnly && <span>{item.leg2_date ? `2nd leg: ${formatDate(item.leg2_date)}` : '2nd leg: Not set'}</span>}<button type="button" className="secondary" onClick={() => saveItem(item)} disabled={loading}>Save {item.round}</button></article>)}</div></section>;
}
