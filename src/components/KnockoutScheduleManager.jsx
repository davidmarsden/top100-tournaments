import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const ROUNDS = ['R32', 'R16', 'QF', 'SF', 'Final'];
const BRACKETS = ['Cup', 'Shield'];

function addDays(dateString, days) {
  const date = new Date(dateString + 'T00:00:00');
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(dateString) {
  if (!dateString) return 'Not set';
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function KnockoutScheduleManager({ selectedTournament, onDataChanged }) {
  const [presets, setPresets] = useState([]);
  const [bracket, setBracket] = useState('Cup');
  const [round, setRound] = useState('R32');
  const [leg1Date, setLeg1Date] = useState('');
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const tournamentId = selectedTournament?.id;

  useEffect(() => { if (hasSupabaseConfig && supabase && tournamentId) loadPresets(); }, [tournamentId]);

  const presetMap = useMemo(() => new Map(presets.map((preset) => [preset.bracket + '|' + preset.round, preset])), [presets]);

  async function loadPresets() {
    setLoading(true);
    const { data, error } = await supabase.from('tournament_round_dates').select('id, bracket, round, leg1_date, leg2_date').eq('tournament_id', tournamentId).order('bracket', { ascending: true }).order('round', { ascending: true });
    if (error) setStatus('Could not load schedule presets. Run database/2026-07-05-knockout-schedule-presets.sql in Supabase first.');
    else { setPresets(data || []); setStatus('Schedule presets loaded.'); }
    setLoading(false);
  }

  async function savePreset() {
    if (!leg1Date) return setStatus('Choose the 1st-leg date first.');
    setLoading(true);
    const row = { tournament_id: tournamentId, bracket, round, leg1_date: leg1Date, leg2_date: addDays(leg1Date, 7), updated_at: new Date().toISOString() };
    const { error } = await supabase.from('tournament_round_dates').upsert(row, { onConflict: 'tournament_id,bracket,round' });
    if (error) setStatus('Preset save failed: ' + error.message);
    else { setStatus(`${bracket} ${round} saved: 1st leg ${formatDate(leg1Date)}, 2nd leg ${formatDate(addDays(leg1Date, 7))}.`); await loadPresets(); }
    setLoading(false);
  }

  async function applyPresetsToExistingFixtures() {
    if (!presets.length) return setStatus('No schedule presets to apply yet.');
    setLoading(true);
    for (const preset of presets) {
      const leg1 = await supabase.from('matches').update({ fixture_date: preset.leg1_date }).eq('tournament_id', tournamentId).eq('stage', 'knockout').eq('bracket', preset.bracket).eq('round', preset.round).eq('leg', 1);
      if (leg1.error) { setStatus('Apply failed: ' + leg1.error.message); setLoading(false); return; }
      const leg2 = await supabase.from('matches').update({ fixture_date: preset.leg2_date || addDays(preset.leg1_date, 7) }).eq('tournament_id', tournamentId).eq('stage', 'knockout').eq('bracket', preset.bracket).eq('round', preset.round).eq('leg', 2);
      if (leg2.error) { setStatus('Apply failed: ' + leg2.error.message); setLoading(false); return; }
    }
    await onDataChanged?.();
    setStatus('Schedule presets applied to existing knockout fixtures.');
    setLoading(false);
  }

  if (!selectedTournament) return null;

  return <section className="bracket-section schedule-presets"><h3>Knockout schedule presets</h3><p className="muted">Set round dates before fixtures are known. Existing and future generated ties can use these presets. 2nd legs are automatically 7 days after 1st legs.</p><div className="filter-row multi"><label>Bracket<select value={bracket} onChange={(event) => setBracket(event.target.value)}>{BRACKETS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Round<select value={round} onChange={(event) => setRound(event.target.value)}>{ROUNDS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>1st-leg date<input type="date" value={leg1Date} onChange={(event) => setLeg1Date(event.target.value)} /></label><button type="button" className="secondary" onClick={savePreset} disabled={loading}>Save preset</button><button type="button" onClick={applyPresetsToExistingFixtures} disabled={loading}>Apply presets to fixtures</button></div><p className="status">{status}</p><div className="tournament-grid">{BRACKETS.flatMap((b) => ROUNDS.map((r) => ({ bracket: b, round: r, preset: presetMap.get(b + '|' + r) }))).map((item) => <article className="tournament-card" key={item.bracket + item.round}><strong>{item.bracket} {item.round}</strong><span>1st leg: {formatDate(item.preset?.leg1_date)}</span><span>2nd leg: {formatDate(item.preset?.leg2_date)}</span></article>)}</div></section>;
}
