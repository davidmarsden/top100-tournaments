import { useEffect, useMemo, useState } from 'react';
import KnockoutBracket from './KnockoutBracket.jsx';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const ROUND_ORDER = ['R64', 'R32', 'R16', 'QF', 'SF', 'Final'];

function isCompleted(match) { return match.status === 'played' || match.status === 'forfeit'; }
function teamName(entry, fallback) { return entry?.teams?.name || fallback || 'TBC'; }
function roundSort(a, b) { return String(a.bracket || '').localeCompare(String(b.bracket || '')) || ROUND_ORDER.indexOf(a.round) - ROUND_ORDER.indexOf(b.round) || Number(a.match_order || 0) - Number(b.match_order || 0) || Number(a.leg || 1) - Number(b.leg || 1); }
function groupSort(a, b) { return String(a.groups?.code || '').localeCompare(String(b.groups?.code || '')) || String(a.round || '').localeCompare(String(b.round || ''), undefined, { numeric: true }) || Number(a.match_order || 0) - Number(b.match_order || 0); }
function latestWinner(ordered) { return [...ordered].reverse().find((leg) => leg.winner_entry_id)?.winner_entry_id || null; }
function decisionText(winnerName, firstAway, secondAway, decidingLeg) {
  if (firstAway !== secondAway) return `away goals ${firstAway}-${secondAway}`;
  if (!decidingLeg) return winnerName === 'FET/manual winner needed' ? 'FET/manual decision needed' : 'tie-break';
  if (decidingLeg.home_extra_time_score !== null || decidingLeg.away_extra_time_score !== null) return `FET ${decidingLeg.home_extra_time_score ?? 0}-${decidingLeg.away_extra_time_score ?? 0}`;
  if (decidingLeg.home_penalty_score !== null || decidingLeg.away_penalty_score !== null) return `penalties ${decidingLeg.home_penalty_score ?? 0}-${decidingLeg.away_penalty_score ?? 0}`;
  return String(decidingLeg.decided_by || 'tie-break').replace(/_/g, ' ');
}
function finalSummary(matches, bracket) {
  const finals = matches.filter((match) => match.stage === 'knockout' && match.bracket === bracket && match.round === 'Final').sort((a, b) => Number(a.leg || 1) - Number(b.leg || 1));
  if (!finals.length || finals.some((match) => !isCompleted(match))) return null;
  const first = finals[0];
  const firstId = first.home_entry_id;
  const secondId = first.away_entry_id;
  const firstName = teamName(first.home_entry, first.home_placeholder);
  const secondName = teamName(first.away_entry, first.away_placeholder);
  let firstAgg = 0, secondAgg = 0, firstAway = 0, secondAway = 0;
  finals.forEach((leg) => {
    const home = Number(leg.home_score || 0), away = Number(leg.away_score || 0);
    if (leg.home_entry_id === firstId) { firstAgg += home; secondAgg += away; secondAway += away; }
    else { firstAgg += away; secondAgg += home; firstAway += away; }
  });
  let winnerId = null;
  if (firstAgg > secondAgg) winnerId = firstId;
  else if (secondAgg > firstAgg) winnerId = secondId;
  else if (firstAway > secondAway) winnerId = firstId;
  else if (secondAway > firstAway) winnerId = secondId;
  else winnerId = latestWinner(finals);
  const winnerName = winnerId === firstId ? firstName : winnerId === secondId ? secondName : 'FET/manual winner needed';
  const decidingLeg = [...finals].reverse().find((leg) => leg.decided_by || leg.home_extra_time_score !== null || leg.away_extra_time_score !== null || leg.home_penalty_score !== null || leg.away_penalty_score !== null);
  const decision = firstAgg === secondAgg ? decisionText(winnerName, firstAway, secondAway, decidingLeg) : null;
  return { bracket, winnerName, firstName, secondName, aggregate: `${firstAgg}-${secondAgg}`, decision, legs: finals };
}
function groupMatches(matches) {
  return matches.reduce((groups, match) => {
    const key = match.stage === 'group' ? `Group ${match.groups?.code || 'Ungrouped'}` : `${match.bracket || 'Knockout'} · ${match.round || 'Round'}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(match);
    return groups;
  }, {});
}
function bracketsFrom(matches) { return [...new Set(matches.filter((match) => match.stage === 'knockout').map((match) => match.bracket || 'Cup'))]; }
function matchSideClass(match, side) {
  if (!isCompleted(match) || match.home_score === null || match.away_score === null) return 'result-side';
  const homeWon = Number(match.home_score) > Number(match.away_score);
  const awayWon = Number(match.away_score) > Number(match.home_score);
  if (side === 'home' && homeWon) return 'result-side winner';
  if (side === 'away' && awayWon) return 'result-side winner';
  if ((side === 'home' && awayWon) || (side === 'away' && homeWon)) return 'result-side loser';
  return 'result-side draw';
}

export default function PublicTournamentPage({ tournamentId }) {
  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('Loading tournament...');

  useEffect(() => { if (hasSupabaseConfig && supabase && tournamentId) loadTournament(); }, [tournamentId]);

  const winners = useMemo(() => bracketsFrom(matches).map((bracket) => finalSummary(matches, bracket)).filter(Boolean), [matches]);
  const groupResults = useMemo(() => groupMatches(matches.filter((match) => match.stage === 'group').sort(groupSort)), [matches]);
  const knockoutResults = useMemo(() => groupMatches(matches.filter((match) => match.stage === 'knockout').sort(roundSort)), [matches]);
  const knockoutBrackets = useMemo(() => bracketsFrom(matches), [matches]);
  const fixtureCount = matches.filter((match) => !isCompleted(match)).length;
  const resultCount = matches.filter(isCompleted).length;

  async function loadTournament() {
    setStatus('Loading tournament page...');
    const tournamentResult = await supabase.from('tournaments').select('id, name, status, rules_notes, secondary_bracket_name').eq('id', tournamentId).maybeSingle();
    if (tournamentResult.error || !tournamentResult.data) { setStatus('Tournament not found.'); return; }
    const matchesResult = await supabase.from('matches').select('id, stage, round, leg, match_order, fixture_date, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, decided_by, home_extra_time_score, away_extra_time_score, home_penalty_score, away_penalty_score, status, bracket, home_placeholder, away_placeholder, groups(id, code, name), home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(id, name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(id, name))').eq('tournament_id', tournamentId);
    if (matchesResult.error) { setStatus('Could not load results: ' + matchesResult.error.message); return; }
    setTournament(tournamentResult.data);
    setMatches(matchesResult.data || []);
    setStatus('Tournament page loaded.');
  }

  if (!hasSupabaseConfig || !supabase) return <main className="app-shell"><section className="warning-card"><strong>Supabase is not connected.</strong></section></main>;
  if (!tournament) return <main className="app-shell"><section className="card"><h1>Tournament page</h1><p className="status">{status}</p></section></main>;

  return <main className="app-shell public-archive">
    <section className="hero"><p className="eyebrow">Top 100 Tournament</p><h1>{tournament.name}</h1><p>Status: {tournament.status || 'draft'} · {resultCount} results · {fixtureCount} fixtures remaining</p></section>
    <section className="card winners-card"><p className="eyebrow">Winners</p><div className="overview-metrics compact-metrics">{winners.length ? winners.map((winner) => <article className="winner-summary-card" key={winner.bracket}><span>🏆 {winner.bracket} winner</span><strong>{winner.winnerName}</strong><small>{winner.firstName} {winner.aggregate} {winner.secondName}{winner.decision ? ` · ${winner.decision}` : ''}</small><div className="mini-results">{winner.legs.map((leg) => <p key={leg.id}>{Number(leg.leg) === 1 ? '1st leg' : '2nd leg'}: {teamName(leg.home_entry, leg.home_placeholder)} {leg.home_score}-{leg.away_score} {teamName(leg.away_entry, leg.away_placeholder)}</p>)}</div></article>) : <p className="muted">No completed finals yet.</p>}</div></section>
    {knockoutBrackets.length > 0 && <section className="card"><p className="eyebrow">Bracket</p><div className="public-bracket-stack">{knockoutBrackets.map((bracket) => <KnockoutBracket key={bracket} title={`${bracket} bracket`} matches={matches.filter((match) => (match.bracket || 'Cup') === bracket)} />)}</div></section>}
    <section className="card"><p className="eyebrow">Knockout fixtures and results</p><ResultSections sections={knockoutResults} /></section>
    <section className="card"><p className="eyebrow">Group fixtures and results</p><ResultSections sections={groupResults} /></section>
  </main>;
}

function ResultSections({ sections }) {
  const entries = Object.entries(sections);
  if (!entries.length) return <p className="muted">No fixtures or results yet.</p>;
  return <div className="fixture-sections">{entries.map(([title, matches]) => <section className="fixture-section" key={title}><div className="fixture-section-header"><h3>{title}</h3><span>{matches.length} fixtures</span></div><div className="fixture-card-list">{matches.map((match) => <article className={isCompleted(match) ? 'fixture-card played result-highlight-card' : 'fixture-card'} key={match.id}><div className="fixture-teams result-teams"><strong className={matchSideClass(match, 'home')}>{teamName(match.home_entry, match.home_placeholder)}</strong><span className="fixture-score">{isCompleted(match) ? `${match.home_score} - ${match.away_score}` : 'v'}</span><strong className={matchSideClass(match, 'away')}>{teamName(match.away_entry, match.away_placeholder)}</strong></div><div className="fixture-actions"><span>{match.round}{match.leg ? ` · ${Number(match.leg) === 1 ? '1st leg' : '2nd leg'}` : ''}</span></div></article>)}</div></section>)}</div>;
}
