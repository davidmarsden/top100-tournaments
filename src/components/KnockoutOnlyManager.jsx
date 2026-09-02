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

function isCompleted(match) {
  return match.status === 'played' || match.status === 'forfeit';
}

function nextPowerOfTwo(value) {
  let size = 2;
  while (size < value) size *= 2;
  return size;
}

function seedOrder(size) {
  if (size === 2) return [1, 2];
  return seedOrder(size / 2).flatMap((seed) => [seed, size + 1 - seed]);
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
  const latestMatches = latestRound ? cupMatches.filter((match) => match.round === latestRound.name).sort((a, b) => Number(a.match_order || 0) - Number(b.match_order || 0)) : [];
  const configuredEntrants = Number(selectedTournament?.knockout_teams || 0);

  async function insertRows(rows, message) {
    setLoading(true);
    const { error } = await supabase.from('matches').insert(rows);
    if (error) setStatus('Draw generation failed: ' + error.message);
    else {
      setStatus(message);
      await loadData();
      await onDataChanged?.();
    }
    setLoading(false);
  }

  async function generateOpeningRound() {
    if (cupMatches.length) return setStatus('The knockout draw already exists.');
    if (!configuredEntrants) return setStatus('Set the knockout field in Format first.');
    if (configuredEntrants > 64) return setStatus('Knockout-only brackets currently support up to 64 entrants.');
    if (entries.length !== configuredEntrants) return setStatus(`The format expects ${configuredEntrants} entrants but ${entries.length} are currently saved. Finalise the entrant list before drawing.`);
    if (entries.length < 2) return setStatus('At least two entrants are required.');
    const bracketSize = nextPowerOfTwo(entries.length);
    const openingRound = roundForSize(bracketSize);
    if (!openingRound) return setStatus('Could not determine the opening knockout round.');
    if (!window.confirm(`Generate the ${openingRound.name} draw for ${entries.length} entrants${bracketSize > entries.length ? ` with ${bracketSize - entries.length} bye(s)` : ''}? Seeds will be placed into a fixed bracket.`)) return;

    const entrantsBySeed = new Map(entries.map((entry, index) => [index + 1, { ...entry, knockoutSeed: index + 1 }]));
    const slots = seedOrder(bracketSize).map((seed) => entrantsBySeed.get(seed) || { bye: true, knockoutSeed: seed });
    const rows = [];
    for (let index = 0; index < slots.length; index += 2) {
      const home = slots[index];
      const away = slots[index + 1];
      const homeBye = Boolean(home?.bye);
      const awayBye = Boolean(away?.bye);
      if (homeBye && awayBye) continue;
      const realHome = homeBye ? away : home;
      const realAway = homeBye ? home : away;
      const bye = Boolean(realAway?.bye);
      rows.push({
        tournament_id: tournamentId,
        stage: 'knockout',
        bracket: 'Cup',
        round: openingRound.name,
        leg: 1,
        match_order: rows.length + 1,
        home_entry_id: realHome.id,
        away_entry_id: bye ? null : realAway.id,
        home_placeholder: entryName(realHome),
        away_placeholder: bye ? 'BYE' : entryName(realAway),
        home_seed: realHome.knockoutSeed,
        away_seed: bye ? null : realAway.knockoutSeed,
        home_score: bye ? 3 : null,
        away_score: bye ? 0 : null,
        winner_entry_id: bye ? realHome.id : null,
        loser_entry_id: null,
        status: bye ? 'played' : 'scheduled',
        decided_by: bye ? 'bye' : null,
      });
    }
    await insertRows(rows, `${openingRound.name} draw generated with ${rows.length} ties${bracketSize > entries.length ? ` and ${bracketSize - entries.length} bye(s)` : ''}.`);
  }

  async function generateNextRound() {
    if (!latestRound) return generateOpeningRound();
    if (latestRound.name === 'Final') return setStatus('The final is already the last round.');
    if (!latestMatches.length || latestMatches.some((match) => !isCompleted(match))) return setStatus(`Finish every ${latestRound.name} tie before generating the next round.`);
    if (latestMatches.some((match) => !match.winner_entry_id)) return setStatus(`At least one ${latestRound.name} tie has no winner. Knockout matches cannot finish level; resolve the tie before continuing.`);
    const nextRound = roundForSize(latestRound.size / 2);
    if (!nextRound) return setStatus('Could not determine the next knockout round.');
    if (cupMatches.some((match) => match.round === nextRound.name)) return setStatus(`${nextRound.name} already exists.`);
    if (!window.confirm(`Generate ${nextRound.name} from the ${latestRound.name} winners?`)) return;

    const entryById = new Map(entries.map((entry) => [entry.id, entry]));
    const winners = latestMatches.map((match) => entryById.get(match.winner_entry_id)).filter(Boolean);
    if (winners.length !== latestMatches.length) return setStatus('Could not resolve every winning entrant. Refresh and try again.');
    const rows = [];
    for (let index = 0; index < winners.length; index += 2) {
      const home = winners[index];
      const away = winners[index + 1];
      if (!away) return setStatus('The previous round produced an odd number of winners. Check the bracket before continuing.');
      rows.push({
        tournament_id: tournamentId,
        stage: 'knockout',
        bracket: 'Cup',
        round: nextRound.name,
        leg: 1,
        match_order: rows.length + 1,
        home_entry_id: home.id,
        away_entry_id: away.id,
        home_placeholder: entryName(home),
        away_placeholder: entryName(away),
        home_seed: home.seed,
        away_seed: away.seed,
        status: 'scheduled',
      });
    }
    await insertRows(rows, `${nextRound.name} generated from ${latestRound.name} winners.`);
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
