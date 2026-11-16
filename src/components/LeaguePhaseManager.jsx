import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import {
  LEAGUE_STAGE, buildCupRoundOf16, buildPostLeagueRounds, calculateLeagueTable, drawLeaguePhase,
  knockoutRoundDates, leaguePhaseCalendar, validateLeagueDraw,
} from '../lib/leaguePhase.js';
import { resolveTieWithFet } from '../lib/knockoutResolution.js';
import LeagueTable from './LeagueTable.jsx';
import './league-phase.css';

const DEFAULT_FIRST_WEDNESDAY = '2026-12-09';

function entryView(entry) {
  return {
    id: entry.id,
    name: entry.teams?.name || `Entry ${entry.id}`,
    managerName: entry.managers?.display_name || entry.managers?.name || null,
    pot: Number(entry.pot) || null,
  };
}

function suggestedSeed(tournament) {
  const words = ['Lisbon', 'Porto', 'Turin', 'Munich', 'Madrid', 'Milan', 'Paris', 'Rio', 'Buenos Aires', 'Amsterdam'];
  const word = words[Math.floor(Math.random() * words.length)];
  return `S${tournament?.season_number || ''} WCC ${word} ${Math.floor(1000 + Math.random() * 9000)}`;
}

export default function LeaguePhaseManager({ selectedTournament, onDataChanged }) {
  const tournamentId = selectedTournament?.id;
  const [entries, setEntries] = useState([]);
  const [matches, setMatches] = useState([]);
  const [tournament, setTournament] = useState(selectedTournament);
  const [issues, setIssues] = useState([]);
  const [firstWednesday, setFirstWednesday] = useState(selectedTournament?.league_first_matchday || DEFAULT_FIRST_WEDNESDAY);
  const [seed, setSeed] = useState('');
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    if (!hasSupabaseConfig || !supabase || !tournamentId) return;
    const [t, e, m, i] = await Promise.all([
      supabase.from('tournaments').select('*').eq('id', tournamentId).single(),
      supabase.from('tournament_entries').select('id, team_id, pot, teams(id, name), managers(id, name, display_name)').eq('tournament_id', tournamentId),
      supabase.from('matches').select('id, stage, bracket, round, leg, match_order, fixture_date, home_entry_id, away_entry_id, home_score, away_score, home_normal_time_score, away_normal_time_score, home_extra_time_score, away_extra_time_score, winner_entry_id, loser_entry_id, status, decided_by, forfeit, walkover, source_id').eq('tournament_id', tournamentId),
      supabase.rpc('league_phase_result_issues', { target_tournament_id: tournamentId }),
    ]);
    if (t.error || e.error || m.error) return setStatus('Could not load the tournament: ' + (t.error || e.error || m.error).message);
    setTournament(t.data);
    setEntries((e.data || []).map(entryView).sort((a, b) => (a.pot || 9) - (b.pot || 9) || a.name.localeCompare(b.name)));
    setMatches(m.data || []);
    setIssues(i.error ? [] : i.data || []);
    if (t.data?.league_first_matchday) setFirstWednesday(t.data.league_first_matchday);
  }

  useEffect(() => { load(); setPreview(null); setSeed(suggestedSeed(selectedTournament)); }, [tournamentId]);

  const leagueMatches = useMemo(() => matches.filter((m) => m.stage === LEAGUE_STAGE), [matches]);
  const knockoutMatches = useMemo(() => matches.filter((m) => m.stage === 'knockout'), [matches]);
  const table = useMemo(() => calculateLeagueTable(entries, leagueMatches), [entries, leagueMatches]);
  const potCounts = useMemo(() => [1, 2, 3, 4, 5].map((pot) => entries.filter((e) => e.pot === pot).length), [entries]);
  const played = leagueMatches.filter((m) => ['played', 'forfeit'].includes(m.status)).length;
  const fromSync = leagueMatches.filter((m) => m.decided_by === 'sm_sync').length;
  const drawn = Boolean(tournament?.league_draw_at);
  const hasResults = played > 0;
  const calendarError = useMemo(() => { try { leaguePhaseCalendar(firstWednesday); return null; } catch (error) { return error.message; } }, [firstWednesday]);

  async function run(label, fn) {
    setBusy(true); setStatus(label + '...');
    try { const message = await fn(); setStatus(message || 'Done.'); await load(); onDataChanged?.(); }
    catch (error) { setStatus(error.message || String(error)); }
    setBusy(false);
  }

  const enterClubs = () => run('Entering every club', async () => {
    const { data, error } = await supabase.rpc('enter_all_game_world_clubs', { target_tournament_id: tournamentId });
    if (error) throw error;
    return `${data} club(s) entered. Pots follow each club's current Division.`;
  });

  function makePreview() {
    try {
      const draw = drawLeaguePhase(entries, { seed });
      const problems = validateLeagueDraw(entries, draw.fixtures.map((f) => ({ ...f, home: f.home.id, away: f.away.id })));
      setPreview({ ...draw, problems });
      setStatus(problems.length ? 'The draw breaks a rule: ' + problems.slice(0, 3).join('; ') : `Draw preview ready: ${draw.fixtures.length} fixtures. Nothing is saved yet.`);
    } catch (error) { setPreview(null); setStatus(error.message); }
  }

  const saveDraw = () => run('Saving the draw', async () => {
    if (!preview || preview.problems.length) throw new Error('Preview a valid draw first.');
    if (preview.seed !== seed) throw new Error('The seed has changed since the preview. Preview again.');
    if (drawn && !window.confirm('Replace the existing draw? Its fixtures will be deleted.')) return 'Kept the existing draw.';
    const fixtures = preview.fixtures.map((f) => ({ matchday: f.matchday, home_entry_id: f.home.id, away_entry_id: f.away.id }));
    const { data, error } = await supabase.rpc('save_league_phase_draw', { target_tournament_id: tournamentId, draw_seed: seed, first_matchday: firstWednesday, fixtures });
    if (error) throw error;
    const dates = knockoutRoundDates(firstWednesday).map((row) => ({ ...row, tournament_id: tournamentId }));
    const { error: datesError } = await supabase.from('tournament_round_dates').upsert(dates, { onConflict: 'tournament_id,bracket,round' });
    setPreview(null);
    return `Draw saved and published: ${data} fixtures. Seed "${seed}".` + (datesError ? ' Knockout dates could not be saved: ' + datesError.message : ' Knockout dates set.');
  });

  const checkSync = () => run('Checking SM Sync for results', async () => {
    const { data, error } = await supabase.rpc('apply_sm_results_to_tournament', { target_tournament_id: tournamentId });
    if (error) throw error;
    return data ? `${data} result(s) filled from SM Sync.` : 'No new results in SM Sync. Results arrive after the daily Sync.';
  });

  const buildPlayoffs = () => run('Building the play-off and Shield last 32', async () => {
    if (knockoutMatches.some((m) => (m.bracket === 'Cup' && m.round === 'Play-off') || (m.bracket === 'Shield' && m.round === 'R32'))) throw new Error('The play-off and Shield last 32 already exist.');
    const dates = knockoutRoundDates(tournament?.league_first_matchday || firstWednesday);
    const { rows, incomplete } = buildPostLeagueRounds(table, { tournamentId, roundDates: dates });
    if (incomplete && !window.confirm(`${incomplete} club(s) have not played all 6 matches. Build the knockouts from the table as it stands?`)) return 'Not built.';
    const { error } = await supabase.from('matches').insert(rows);
    if (error) throw error;
    return `Built ${rows.length / 2} two-legged ties: 8 Cup play-off ties and 16 Shield ties.`;
  });

  const playoffWinners = useMemo(() => {
    const winners = new Map();
    for (let tie = 1; tie <= 8; tie += 1) {
      const legs = knockoutMatches.filter((m) => m.bracket === 'Cup' && m.round === 'Play-off' && Number(m.match_order) === tie);
      if (legs.length) { const result = resolveTieWithFet(legs); if (result.winnerId) winners.set(tie, result.winnerId); }
    }
    return winners;
  }, [knockoutMatches]);
  const playoffExists = knockoutMatches.some((m) => m.bracket === 'Cup' && m.round === 'Play-off');
  const r16Exists = knockoutMatches.some((m) => m.bracket === 'Cup' && m.round === 'R16');

  const buildR16 = () => run('Building the Cup last 16', async () => {
    if (r16Exists) throw new Error('The Cup last 16 already exists.');
    const rows = buildCupRoundOf16(table, playoffWinners, { tournamentId, roundDates: knockoutRoundDates(tournament?.league_first_matchday || firstWednesday) });
    const { error } = await supabase.from('matches').insert(rows);
    if (error) throw error;
    return 'Built the Cup last 16. Later rounds (and the Shield last 16 onward) are built in Knockout.';
  });

  const previewByClub = useMemo(() => {
    if (!preview) return [];
    const names = new Map(entries.map((e) => [e.id, e]));
    return entries.map((club) => ({
      club,
      games: preview.fixtures.filter((f) => f.home.id === club.id || f.away.id === club.id)
        .map((f) => ({ matchday: f.matchday, home: f.home.id === club.id, opponent: names.get(f.home.id === club.id ? f.away.id : f.home.id) })),
    }));
  }, [preview, entries]);

  if (!tournament) return <p className="muted">Choose a tournament.</p>;
  const noResult = issues.filter((row) => row.issue === 'no_result');
  const reversed = issues.filter((row) => row.issue === 'played_reversed');

  return <div className="league-admin">
    <p className="status" role="status">{status || (drawn ? `Draw made ${new Date(tournament.league_draw_at).toLocaleString('en-GB')} · seed "${tournament.league_draw_seed}"` : 'League stage not drawn yet.')}</p>

    <section className="league-step">
      <header><span className="league-step__n">1</span><div><h3>Clubs</h3><p className="muted">Every club in {tournament.game_worlds?.name || 'the game world'} takes part. Each Division is a pot.</p></div></header>
      <div className="league-pots">{potCounts.map((count, index) => <div key={index} className={count === 20 ? 'league-pot ok' : 'league-pot'}><strong>Pot {index + 1}</strong><span>Division {index + 1}</span><b>{count}</b></div>)}</div>
      <div className="button-row"><button type="button" onClick={enterClubs} disabled={busy || drawn}>{entries.length ? 'Refresh clubs and pots from SM Sync' : 'Enter every club'}</button></div>
      {drawn && <p className="muted">Clubs are locked once the draw is made.</p>}
    </section>

    <section className="league-step">
      <header><span className="league-step__n">2</span><div><h3>Draw</h3><p className="muted">6 matchdays: one club from each other pot, two from its own; 3 home, 3 away. Anyone can re-run the draw from the published seed and get the same fixtures.</p></div></header>
      <div className="mini-grid">
        <label>First Wednesday<input type="date" value={firstWednesday} onChange={(e) => setFirstWednesday(e.target.value)} disabled={hasResults} /></label>
        <label>Draw seed<input value={seed} onChange={(e) => { setSeed(e.target.value); setPreview(null); }} disabled={hasResults} /></label>
      </div>
      {calendarError && <p className="warning-card">{calendarError}</p>}
      {!calendarError && <p className="muted">League stage {leaguePhaseCalendar(firstWednesday)[0].date} to {leaguePhaseCalendar(firstWednesday)[5].date}; finals {leaguePhaseCalendar(firstWednesday).at(-2).date} and {leaguePhaseCalendar(firstWednesday).at(-1).date}.</p>}
      <div className="button-row">
        <button type="button" className="secondary" onClick={makePreview} disabled={busy || hasResults || !seed || potCounts.some((c) => c !== potCounts[0])}>Preview draw</button>
        <button type="button" onClick={saveDraw} disabled={busy || hasResults || !preview || preview.problems.length > 0 || Boolean(calendarError)}>{drawn ? 'Replace and publish draw' : 'Save and publish draw'}</button>
      </div>
      {hasResults && <p className="muted">Results have been entered, so the draw is final.</p>}
      {preview && !preview.problems.length && <details className="league-preview" open>
        <summary>Draw preview: every club's six opponents</summary>
        <div className="league-preview__grid">{previewByClub.map(({ club, games }) => <div key={club.id} className="league-preview__club">
          <strong>{club.name} <span className="muted">Pot {club.pot}</span></strong>
          <ol>{games.sort((a, b) => a.matchday - b.matchday).map((g) => <li key={g.matchday}><span className="muted">MD{g.matchday}</span> {g.home ? 'v' : '@'} {g.opponent?.name} <span className="muted">P{g.opponent?.pot}</span></li>)}</ol>
        </div>)}</div>
      </details>}
    </section>

    <section className="league-step">
      <header><span className="league-step__n">3</span><div><h3>Results</h3><p className="muted">Results come in from SM Sync on their own: when the daily Sync saves a friendly between two drawn clubs, with the right club at home, the fixture fills itself. Enter only forfeits here (Results module) and tied knockout ties (FET).</p></div></header>
      <div className="league-stats"><div><b>{played}</b><span>of {leagueMatches.length} played</span></div><div><b>{fromSync}</b><span>from SM Sync</span></div><div><b>{noResult.length}</b><span>overdue</span></div><div><b>{reversed.length}</b><span>played at the wrong ground</span></div></div>
      <div className="button-row"><button type="button" className="secondary" onClick={checkSync} disabled={busy || !drawn}>Check SM Sync now</button></div>
      {reversed.length > 0 && <div className="warning-card"><strong>Played with home and away swapped</strong><p>These were not applied. Decide in Results whether to accept the score as played.</p><ul>{reversed.map((row) => <li key={row.match_id}>{row.round}{row.leg > 1 ? ` leg ${row.leg}` : ''}: {row.home_name} v {row.away_name} was played as {row.away_name} {row.sm_home_score}–{row.sm_away_score} {row.home_name} ({row.sm_played})</li>)}</ul></div>}
      {noResult.length > 0 && <details><summary>{noResult.length} fixture(s) past their Wednesday with no result</summary><ul className="league-issues">{noResult.map((row) => <li key={row.match_id}><span className="muted">{row.fixture_date}</span> {row.bracket || 'League'} {row.round}{row.leg > 1 ? ` leg ${row.leg}` : ''}: {row.home_name} v {row.away_name}</li>)}</ul></details>}
    </section>

    <section className="league-step">
      <header><span className="league-step__n">4</span><div><h3>Table</h3><p className="muted">Points, goal difference, goals, wins, then opponents' points. A forfeit is 3-0 to the club that tried; if neither did, 0-3 for both.</p></div></header>
      <LeagueTable rows={table} compact />
    </section>

    <section className="league-step">
      <header><span className="league-step__n">5</span><div><h3>Knockouts</h3><p className="muted">1-8 go to the Cup last 16, 9-24 play off (9 v 24, 10 v 23 …), 25-56 go to the Shield last 32. Every tie is two legs; the higher-placed club is at home in the second leg.</p></div></header>
      <div className="button-row">
        <button type="button" onClick={buildPlayoffs} disabled={busy || !drawn || playoffExists}>Build Cup play-off and Shield last 32</button>
        <button type="button" onClick={buildR16} disabled={busy || !playoffExists || r16Exists || playoffWinners.size < 8}>Build Cup last 16 ({playoffWinners.size}/8 play-offs decided)</button>
      </div>
      <p className="muted">From the quarter-finals (and the Shield last 16) use the Knockout module's next-round button as usual.</p>
    </section>
  </div>;
}
