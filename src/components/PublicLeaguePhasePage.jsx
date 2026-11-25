import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import {
  LEAGUE_STAGE, WCC_ROUNDS, calculateLeagueTable, latestPlayedMatchday, matchdayHighlights, matchdayOf,
} from '../lib/leaguePhase.js';
import { resolveTieWithFet } from '../lib/knockoutResolution.js';
import LeagueTable from './LeagueTable.jsx';
import './league-phase.css';

const ROUND_NAMES = { 'Play-off': 'Knockout play-off', R32: 'Last 32', R16: 'Last 16', QF: 'Quarter-finals', SF: 'Semi-finals', Final: 'Final' };
const TABS = [['table', 'Table'], ['fixtures', 'Fixtures & results'], ['knockouts', 'Knockouts'], ['rules', 'How it works']];

// Arrangement badges on unplayed fixtures (league_phase_arrangement_status).
const ARRANGEMENT = {
  arranged: ['✓ Arranged', 'is-arranged'],
  swapped: ['✓ Arranged · home/away swapped', 'is-arranged'],
  sent: ['Invite sent', 'is-sent'],
  received: ['Invite received', 'is-sent'],
  chased: ['Chased', 'is-chased'],
  check: ['Check arrangement', 'is-chased'],
  problem: ['Problem reported', 'is-problem'],
  none: ['Not arranged yet', 'is-none'],
};
// Status filter buttons (also the colour key): each groups one or more statuses.
const STATUS_GROUPS = [
  ['arranged', 'Arranged', ['arranged', 'swapped'], 'is-arranged'],
  ['sent', 'Invite sent / received', ['sent', 'received'], 'is-sent'],
  ['chased', 'Chased / check', ['chased', 'check'], 'is-chased'],
  ['problem', 'Problem reported', ['problem'], 'is-problem'],
  ['none', 'Not arranged yet', ['none'], 'is-none'],
  ['played', 'Played', ['played'], 'is-played'],
];
const GROUP_OF = Object.fromEntries(STATUS_GROUPS.flatMap(([key, , statuses]) => statuses.map((status) => [status, key])));

function formatDate(value) {
  if (!value) return 'Date TBC';
  return new Date(`${String(value).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

function scoreText(match) {
  if (match.status === 'forfeit' && !match.winner_entry_id && Number(match.home_score) === 0 && Number(match.away_score) === 0) return 'Void';
  if (match.status === 'forfeit') return match.winner_entry_id === match.home_entry_id ? '3–0 w/o' : '0–3 w/o';
  if (match.status === 'played' && match.home_score != null) return `${match.home_score}–${match.away_score}`;
  if (match.status === 'postponed') return 'Moved';
  return null;
}

function initialTab() {
  const hash = typeof window !== 'undefined' ? window.location.hash.replace('#', '') : '';
  return TABS.some(([key]) => key === hash) ? hash : 'table';
}

export default function PublicLeaguePhasePage({ tournamentId }) {
  const [tournament, setTournament] = useState(null);
  const [entries, setEntries] = useState([]);
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('Loading the World Club Cup...');
  const [tab, setTab] = useState(initialTab);
  const [matchday, setMatchday] = useState(null);
  const [club, setClub] = useState('');
  const [arrangement, setArrangement] = useState(new Map());
  const [statusFilter, setStatusFilter] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!hasSupabaseConfig || !supabase || !tournamentId) return;
      const [t, e, m, a] = await Promise.all([
        supabase.from('tournaments').select('id, name, status, season_number, league_draw_seed, league_draw_at, league_first_matchday, secondary_bracket_name, game_worlds(id, name, slug), competition_types(id, name, slug)').eq('id', tournamentId).maybeSingle(),
        supabase.from('tournament_entries').select('id, pot, teams(id, name), managers(id, name, display_name)').eq('tournament_id', tournamentId),
        supabase.from('matches').select('id, stage, bracket, round, leg, match_order, fixture_date, home_entry_id, away_entry_id, home_score, away_score, home_normal_time_score, away_normal_time_score, home_extra_time_score, away_extra_time_score, winner_entry_id, loser_entry_id, status, decided_by, forfeit, walkover').eq('tournament_id', tournamentId),
        supabase.rpc('league_phase_arrangement_status', { target_tournament_id: tournamentId }),
      ]);
      if (cancelled) return;
      if (t.error || !t.data) { setStatus('This tournament could not be loaded.'); return; }
      setTournament(t.data);
      setEntries((e.data || []).map((row) => ({ id: row.id, name: row.teams?.name || 'TBC', managerName: row.managers?.display_name || row.managers?.name || null, pot: Number(row.pot) || null })));
      setMatches(m.data || []);
      setArrangement(new Map((a.error ? [] : a.data || []).map((row) => [row.match_id, row.arrangement_status || 'none'])));
      setStatus('');
    }
    load();
    return () => { cancelled = true; };
  }, [tournamentId]);

  useEffect(() => { try { window.history.replaceState(null, '', `#${tab}`); } catch { /* ignore */ } }, [tab]);

  const league = useMemo(() => matches.filter((m) => m.stage === LEAGUE_STAGE), [matches]);
  const knockouts = useMemo(() => matches.filter((m) => m.stage === 'knockout'), [matches]);
  const table = useMemo(() => calculateLeagueTable(entries, league), [entries, league]);
  const latest = useMemo(() => latestPlayedMatchday(league), [league]);
  const matchdays = useMemo(() => [...new Set(league.map(matchdayOf).filter(Boolean))].sort((a, b) => a - b), [league]);
  const dateOf = (md) => league.find((m) => matchdayOf(m) === md)?.fixture_date;
  // Open on the first matchday that still has games to play.
  const defaultMatchday = matchdays.find((md) => league.some((m) => matchdayOf(m) === md && !['played', 'forfeit'].includes(m.status))) || matchdays.at(-1) || 1;
  const shownMatchday = matchday || defaultMatchday;
  const highlights = useMemo(() => matchdayHighlights(entries, league, latest), [entries, league, latest]);
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const played = league.filter((m) => ['played', 'forfeit'].includes(m.status)).length;

  const statusOf = (m) => (scoreText(m) ? 'played' : arrangement.get(m.id) || 'none');
  const shownFixtures = (club
    ? league.filter((m) => m.home_entry_id === Number(club) || m.away_entry_id === Number(club)).sort((a, b) => (matchdayOf(a) || 0) - (matchdayOf(b) || 0))
    : league.filter((m) => matchdayOf(m) === shownMatchday).sort((a, b) => a.match_order - b.match_order))
    .filter((m) => !statusFilter || GROUP_OF[statusOf(m)] === statusFilter);

  if (!tournament) return <main className="wcc"><div className="wcc-wrap"><p className="wcc-empty">{status}</p></div></main>;

  const leagueDone = league.length > 0 && played === league.length;
  const stageLabel = !league.length ? 'Draw to come' : leagueDone ? (knockouts.length ? 'Knockouts' : 'League stage complete') : `League stage · Matchday ${latest || 1} of 6`;

  return <main className="wcc">
    <div className="wcc-wrap">
      <header className="wcc-hero">
        <p className="wcc-eyebrow">{tournament.game_worlds?.name || 'Top 100'} · Season {tournament.season_number}</p>
        <h1>{tournament.name}</h1>
        <p>All {entries.length || 100} clubs in one table. Six Wednesdays, one club from every Division and two from your own, then the knockouts. The top 8 go straight to the last 16, 9th to 24th play off for the other places, and 25th to 56th go into the Shield.</p>
        <div className="wcc-facts">
          <div className="wcc-fact"><b>{stageLabel}</b><span>Now</span></div>
          <div className="wcc-fact"><b>{played} / {league.length || 300}</b><span>League matches played</span></div>
          <div className="wcc-fact"><b>{formatDate(tournament.league_first_matchday)}</b><span>Matchday 1</span></div>
          <div className="wcc-fact"><b>Every Wednesday</b><span>Friendlies, strongest XI, no eligibility rules</span></div>
        </div>
      </header>

      {latest && (highlights.upset || highlights.biggestWin) && <section className="wcc-highlights" aria-label={`Matchday ${latest} talking points`}>
        {highlights.upset && <article className="wcc-highlight"><h3>Upset of Matchday {latest}</h3><p><b>{highlights.upset.winner?.name}</b> (Division {highlights.upset.winner?.pot}) beat <b>{highlights.upset.loser?.name}</b> (Division {highlights.upset.loser?.pot}) {Math.max(highlights.upset.match.home_score, highlights.upset.match.away_score)}–{Math.min(highlights.upset.match.home_score, highlights.upset.match.away_score)}.</p></article>}
        {highlights.biggestWin && highlights.biggestWin !== highlights.upset && <article className="wcc-highlight"><h3>Biggest win</h3><p><b>{highlights.biggestWin.home?.name}</b> {highlights.biggestWin.match.home_score}–{highlights.biggestWin.match.away_score} <b>{highlights.biggestWin.away?.name}</b></p></article>}
        {highlights.climbers.length > 0 && <article className="wcc-highlight"><h3>On the move</h3><p>{highlights.climbers.map((row, i) => <span key={row.entryId}>{i ? ' · ' : ''}<b>{row.name}</b> up {row.gained} to {row.position}</span>)}</p></article>}
      </section>}

      <nav className="wcc-tabs" role="tablist" aria-label="World Club Cup sections">
        {TABS.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}
      </nav>

      {tab === 'table' && <section className="wcc-section" role="tabpanel"><h2>League stage table</h2><LeagueTable rows={table} /></section>}

      {tab === 'fixtures' && <section className="wcc-section" role="tabpanel">
        <h2>{club ? `${byId.get(Number(club))?.name || 'Club'}: all fixtures` : `Matchday ${shownMatchday} · ${formatDate(dateOf(shownMatchday))}`}</h2>
        {!matchdays.length ? <p className="wcc-empty">Fixtures appear here as soon as the draw is made.</p> : <>
          <div className="wcc-fixture-filters">
            <label className="wcc-club-filter">Club
              <select value={club} onChange={(e) => setClub(e.target.value)}>
                <option value="">All clubs, by matchday</option>
                {[...entries].sort((a, b) => a.name.localeCompare(b.name)).map((e) => <option key={e.id} value={e.id}>{e.name}{e.managerName ? ` (${e.managerName})` : ''}</option>)}
              </select>
            </label>
            {!club && <div className="wcc-matchdays" role="group" aria-label="Matchday">
              {matchdays.map((md) => <button key={md} type="button" aria-pressed={md === shownMatchday} onClick={() => setMatchday(md)}>MD{md}</button>)}
            </div>}
          </div>
          {arrangement.size > 0 && <div className="wcc-arrangement-key" role="group" aria-label="Filter by status">
            {STATUS_GROUPS.map(([key, label, , tone]) => <button key={key} type="button" className={`wcc-arrangement ${tone}`} aria-pressed={statusFilter === key} onClick={() => setStatusFilter(statusFilter === key ? '' : key)}>{label}</button>)}
            {statusFilter && <button type="button" className="wcc-arrangement is-clear" onClick={() => setStatusFilter('')}>Show all</button>}
          </div>}
          {shownFixtures.length === 0 && <p className="wcc-empty">No fixtures {club ? 'for this club' : 'on this matchday'} with that status.</p>}
          <div className="wcc-fixtures">
            {shownFixtures.map((m) => {
              const home = byId.get(m.home_entry_id);
              const away = byId.get(m.away_entry_id);
              const score = scoreText(m);
              const winner = m.winner_entry_id ? byId.get(m.winner_entry_id) : null;
              const loser = winner && (winner.id === home?.id ? away : home);
              const upset = m.status === 'played' && winner && loser && Number(winner.pot) - Number(loser.pot) >= 2;
              return <article key={m.id} className={upset ? 'wcc-fixture wcc-fixture--upset' : 'wcc-fixture'}>
                <div className="wcc-fixture__team wcc-fixture__home">{home?.name}<small>Division {home?.pot}</small></div>
                <div className={score ? 'wcc-fixture__score' : 'wcc-fixture__score is-pending'}>{score || 'v'}</div>
                <div className="wcc-fixture__team">{away?.name}<small>Division {away?.pot}</small></div>
                {upset && <div className="wcc-fixture__tag">Giant-killing</div>}
                {club && <div className="wcc-fixture__when">MD{matchdayOf(m)} · {formatDate(m.fixture_date)}</div>}
                {!score && arrangement.has(m.id) && <div className={`wcc-arrangement ${ARRANGEMENT[arrangement.get(m.id)]?.[1] || 'is-none'}`}>{ARRANGEMENT[arrangement.get(m.id)]?.[0] || 'Not arranged yet'}</div>}
              </article>;
            })}
          </div>
        </>}
      </section>}

      {tab === 'knockouts' && <section className="wcc-section" role="tabpanel">
        {!knockouts.length ? <p className="wcc-empty">The knockouts are drawn from the final table after Matchday 6. The play-off and Shield last 32 start the following Wednesday.</p>
          : ['Cup', 'Shield'].map((bracket) => <div key={bracket}>
            {WCC_ROUNDS[bracket].filter((round) => knockouts.some((m) => m.bracket === bracket && m.round === round)).reverse().map((round) => {
              const ties = [...new Set(knockouts.filter((m) => m.bracket === bracket && m.round === round).map((m) => m.match_order))].sort((a, b) => a - b);
              return <div key={round} className="wcc-section">
                <h2>{bracket === 'Cup' ? 'World Club Cup' : tournament.secondary_bracket_name || 'Shield'} · {ROUND_NAMES[round] || round}</h2>
                <div className="wcc-ties">{ties.map((order) => {
                  const legs = knockouts.filter((m) => m.bracket === bracket && m.round === round && m.match_order === order).sort((a, b) => a.leg - b.leg);
                  const result = resolveTieWithFet(legs);
                  const first = byId.get(legs[0]?.home_entry_id);
                  const second = byId.get(legs[0]?.away_entry_id);
                  return <article key={order} className="wcc-tie">
                    <div className="wcc-tie__teams"><span className={result.winnerId && result.winnerId === first?.id ? 'is-winner' : ''}>{first?.name || legs[0]?.home_placeholder || 'TBC'}</span><span className={result.winnerId && result.winnerId === second?.id ? 'is-winner' : ''}>{second?.name || legs[0]?.away_placeholder || 'TBC'}</span></div>
                    <div className="wcc-tie__legs">{legs.map((leg) => <span key={leg.id}>Leg {leg.leg} ({formatDate(leg.fixture_date)}): {scoreText(leg) || 'to play'}{leg.decided_by === 'fictional_extra_time' ? ' after FET' : ''}. </span>)}{result.reason === 'fet_required' ? 'Level: decided by Fictional Extra Time.' : ''}</div>
                  </article>;
                })}</div>
              </div>;
            })}
          </div>)}
      </section>}

      {tab === 'rules' && <section className="wcc-section wcc-rules" role="tabpanel">
        <h2>How the World Club Cup works</h2>
        <p>Every Top 100 club takes part. Matches are friendlies played on Wednesdays, so there are no eligibility rules or fitness worries: pick your strongest team.</p>
        <h3>League stage</h3>
        <p>Clubs are drawn from five pots, one per Division. Each club plays six matches, one a week: one club from each of the other four Divisions and two from its own, three at home and three away. All {entries.length || 100} clubs share one table.</p>
        <p>Order in the table: points (3 for a win, 1 for a draw), goal difference, goals scored, wins, then the total points of the clubs you played.</p>
        <h3>What your position means</h3>
        <p><b>1st–8th:</b> straight into the World Club Cup last 16. <b>9th–24th:</b> a two-legged play-off (9th v 24th, 10th v 23rd …) for the other eight places. <b>25th–56th:</b> the Shield last 32 (25th v 56th …). <b>57th–100th:</b> out.</p>
        <h3>Knockouts</h3>
        <p>Every tie is two legs, with the higher-placed club at home in the second leg. Level on aggregate: away goals, then Fictional Extra Time.</p>
        <h3>Results and forfeits</h3>
        <p>Results are read from Soccer Manager automatically by SM Sync, so there is nothing to submit. Play the friendly with the right club at home. If a match isn't played, the club that tried to arrange it wins 3–0; if neither club tried, both lose 0–3. The World Club Cup is mandatory and forfeits count towards the season's forfeit record.</p>
        {tournament.league_draw_seed && <>
          <h3>Check the draw</h3>
          <p>The draw was made on {new Date(tournament.league_draw_at).toLocaleString('en-GB')} from the seed <code>{tournament.league_draw_seed}</code>. Running the published draw code with the same seed and pots gives exactly the same fixtures.</p>
        </>}
      </section>}
    </div>
  </main>;
}
