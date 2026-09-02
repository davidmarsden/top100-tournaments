import { useEffect, useMemo, useState } from 'react';
import FixturesManager from './FixturesManager.jsx';
import { supabase } from '../lib/supabaseClient';

const ROUND_SEQUENCE = [
  { size: 64, name: 'R64' },
  { size: 32, name: 'R32' },
  { size: 16, name: 'R16' },
  { size: 8, name: 'QF' },
  { size: 4, name: 'SF' },
  { size: 2, name: 'Final' },
];

function nextPowerOfTwo(value) {
  let size = 2;
  while (size < value) size *= 2;
  return size;
}

function roundForSize(size) {
  return ROUND_SEQUENCE.find((round) => round.size === size) || null;
}

function entryName(entry) {
  return entry?.teams?.name || 'Unknown team';
}

export default function KnockoutOnlyManager({ selectedTournament, onDataChanged }) {
  const [entries, setEntries] = useState([]);
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('Loading knockout data...');
  const [loading, setLoading] = useState(false);
  const tournamentId = selectedTournament?.id;

  useEffect(() => {
    if (tournamentId) loadData();
  }, [tournamentId, selectedTournament?.knockout_teams]);

  async function loadData() {
    if (!tournamentId) return;
    setLoading(true);
    const [entriesResult, matchesResult] = await Promise.all([
      supabase.from('tournament_entries').select('id, seed, rating, teams(id, name), managers(id, name, display_name)').eq('tournament_id', tournamentId).order('seed', { ascending: true }),
      supabase.from('matches').select('id, stage, bracket, round, leg, match_order, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, status, home_placeholder, away_placeholder').eq('tournament_id', tournamentId).eq('stage', 'knockout').order('match_order', { ascending: true }),
    ]);
    const error = entriesResult.error || matchesResult.error;
    if (error) {
      setStatus('Could not load knockout data: ' + error.message);
    } else {
      const orderedEntries = [...(entriesResult.data || [])].sort((a, b) => Number(a.seed || 999) - Number(b.seed || 999) || Number(b.rating || 0) - Number(a.rating || 0) || entryName(a).localeCompare(entryName(b)));
      setEntries(orderedEntries);
      setMatches(matchesResult.data || []);
      setStatus('Knockout data loaded.');
    }
    setLoading(false);
  }

  const cupMatches = useMemo(() => matches.filter((match) => (match.bracket || 'Cup') === 'Cup'), [matches]);
  const roundsPresent = useMemo(() => ROUND_SEQUENCE.filter((round) => cupMatches.some((match) => match.round === round.name)), [cupMatches]);
  const latestRound = roundsPresent[roundsPresent.length - 1] || null;
  const configuredEntrants = Number(selectedTournament?.knockout_teams || 0);

  async function generateOpeningRound() {
    if (cupMatches.length) return setStatus('The knockout draw already exists.');
    if (!configuredEntrants) return setStatus('Set the knockout field in Format first.');
    if (configuredEntrants > 64) return setStatus('Knockout-only brackets currently support up to 64 entrants.');
    if (entries.length !== configuredEntrants) return setStatus(`The format expects ${configuredEntrants} entrants but ${entries.length} are currently saved. Finalise the entrant list before drawing.`);
    if (entries.length < 2) return setStatus('At least two entrants are required.');
    const bracketSize = nextPowerOfTwo(entries.length);
    const openingRound = roundForSize(bracketSize);
    if (!openingRound) return setStatus('Could not determine the opening knockout round.');
    if (!window.confirm(`Generate the ${openingRound.name} draw for ${entries.length} entrants${bracketSize > entries.length ? ` with ${bracketSize - entries.length} bye(s)` : ''}? Seeds will be normalized and placed into a fixed bracket.`)) return;

    setLoading(true);
    setStatus('Generating the opening draw atomically...');
    const { data, error } = await supabase.rpc('generate_knockout_opening_round_atomic', { p_tournament_id: tournamentId });
    if (error) {
      setStatus('Draw generation failed: ' + error.message);
    } else {
      const draw = data || {};
      const generatedRound = draw.round || openingRound.name;
      const ties = Number(draw.ties || 0);
      const byes = Number(draw.byes || 0);
      setStatus(`${generatedRound} draw generated with ${ties} ties${byes ? ` and ${byes} bye(s)` : ''}.`);
      await loadData();
      await onDataChanged?.();
    }
    setLoading(false);
  }

  async function generateNextRound() {
    if (!latestRound) return generateOpeningRound();
    if (latestRound.name === 'Final') return setStatus('The final is already the last round.');
    const nextRound = roundForSize(latestRound.size / 2);
    if (!nextRound) return setStatus('Could not determine the next knockout round.');
    if (!window.confirm(`Generate ${nextRound.name} from the latest resolved ${latestRound.name} winners?`)) return;

    setLoading(true);
    setStatus(`Revalidating ${latestRound.name} and generating ${nextRound.name} atomically...`);
    const { data, error } = await supabase.rpc('generate_knockout_successor_round_atomic', { p_tournament_id: tournamentId });
    if (error) {
      setStatus('Next-round generation failed: ' + error.message);
      await loadData();
    } else {
      const draw = data || {};
      setStatus(`${draw.round || nextRound.name} generated from the fresh ${draw.source_round || latestRound.name} winner snapshot with ${Number(draw.ties || 0)} ties.`);
      await loadData();
      await onDataChanged?.();
    }
    setLoading(false);
  }

  const nextLabel = !latestRound ? 'Generate opening draw' : latestRound.name === 'Final' ? 'Final generated' : `Generate ${roundForSize(latestRound.size / 2)?.name || 'next round'}`;

  return <div className="knockout-manager">
    <section className="entrant-panel">
      <p className="eyebrow">Knockout-only tournament</p>
      <h3>Seeded Cup draw</h3>
      <p className="muted">There is no group stage. The saved entrant seeds determine a fixed single-elimination bracket. Fields that are not powers of two receive automatic byes for the highest seeds. Each tie is one leg; enter the final score including any fictional extra-time resolution so a winner is recorded.</p>
      <div className="overview-metrics compact-metrics">
        <article><span>Entrants</span><strong>{entries.length}/{configuredEntrants || 'TBC'}</strong></article>
        <article><span>Opening round</span><strong>{configuredEntrants ? roundForSize(nextPowerOfTwo(configuredEntrants))?.name || 'TBC' : 'TBC'}</strong></article>
        <article><span>Draw</span><strong>{cupMatches.length ? 'Live' : 'Not generated'}</strong></article>
        <article><span>Current round</span><strong>{latestRound?.name || 'TBC'}</strong></article>
      </div>
      <div className="button-row"><button type="button" onClick={generateNextRound} disabled={loading || latestRound?.name === 'Final'}>{loading ? 'Working...' : nextLabel}</button><button type="button" className="secondary" onClick={loadData} disabled={loading}>Refresh draw</button></div>
      <p className="status">{status}</p>
    </section>
    {cupMatches.length > 0 && <FixturesManager selectedTournament={selectedTournament} stage="knockout" onDataChanged={async () => { await loadData(); await onDataChanged?.(); }} />}
  </div>;
}
