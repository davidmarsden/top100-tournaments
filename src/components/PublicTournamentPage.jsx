import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const ROUND_ORDER = ['R32', 'R16', 'QF', 'SF', 'Final'];

function isCompleted(match) { return match.status === 'played' || match.status === 'forfeit'; }
function teamName(entry, fallback) { return entry?.teams?.name || fallback || 'TBC'; }
function roundSort(a, b) { return String(a.bracket || '').localeCompare(String(b.bracket || '')) || ROUND_ORDER.indexOf(a.round) - ROUND_ORDER.indexOf(b.round) || Number(a.match_order || 0) - Number(b.match_order || 0) || Number(a.leg || 1) - Number(b.leg || 1); }
function groupSort(a, b) { return String(a.groups?.code || '').localeCompare(String(b.groups?.code || '')) || String(a.round || '').localeCompare(String(b.round || ''), undefined, { numeric: true }) || Number(a.match_order || 0) - Number(b.match_order || 0); }
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
  return { bracket, winnerName: winnerId === firstId ? firstName : winnerId === secondId ? secondName : 'FET/manual winner needed', firstName, secondName, aggregate: `${firstAgg}-${secondAgg}`, legs: finals };
}
function groupMatches(matches) {
  return matches.reduce((groups, match) => {
    const key = match.stage === 'group' ? `Group ${match.groups?.code || 'Ungrouped'}` : `${match.bracket || 'Knockout'} · ${match.round || 'Round'}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(match);
    return groups;
  }, {});
}

export default function PublicTournamentPage({ tournamentId }) {
  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('Loading tournament...');

  useEffect(() => { if (hasSupabaseConfig && supabase && tournamentId) loadTournament(); }, [tournamentId]);

  const winners = useMemo(() => ['Cup', 'Shield'].map((bracket) => finalSummary(matches, bracket)).filter(Boolean), [matches]);
  const groupResults = useMemo(() => groupMatches(matches.filter((match) => match.stage === 'group').sort(groupSort)), [matches]);
  const knockoutResults = useMemo(() => groupMatches(matches.filter((match) => match.stage === 'knockout').sort(roundSort)), [matches]);

  async function loadTournament() {
    setStatus('Loading tournament archive...');
    const tournamentResult = await supabase.from('tournaments').select('id, name, status, rules_notes, secondary_bracket_name').eq('id', tournamentId).maybeSingle();
    if (tournamentResult.error || !tournamentResult.data) { setStatus('Tournament not found.'); return; }
    const matchesResult = await supabase.from('matches').select('id, stage, round, leg, match_order, fixture_date, home_entry_id, away_entry_id, home_score, away_score, status, bracket, home_placeholder, away_placeholder, groups(id, code, name), home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(id, name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(id, name))').eq('tournament_id', tournamentId);
    if (matchesResult.error) { setStatus('Could not load results: ' + matchesResult.error.message); return; }
    setTournament(tournamentResult.data);
    setMatches(matchesResult.data || []);
    setStatus('Archive loaded.');
  }

  if (!hasSupabaseConfig || !supabase) return <main className="app-shell"><section className="warning-card"><strong>Supabase is not connected.</strong></section></main>;
  if (!tournament) return <main className="app-shell"><section className="card"><h1>Tournament archive</h1><p className="status">{status}</p></section></main>;

  return <main className="app-shell public-archive"><section className="hero"><p className="eyebrow">Top 100 Tournament Archive</p><h1>{tournament.name}</h1><p>Status: {tournament.status || 'draft'}</p></section><section className="card"><p className="eyebrow">Winners</p><div className="overview-metrics compact-metrics">{winners.length ? winners.map((winner) => <article key={winner.bracket}><span>{winner.bracket} winner</span><strong>{winner.winnerName}</strong><small>{winner.firstName} {winner.aggregate} {winner.secondName}</small><div className="mini-results">{winner.legs.map((leg) => <p key={leg.id}>{Number(leg.leg) === 1 ? '1st leg' : '2nd leg'}: {teamName(leg.home_entry, leg.home_placeholder)} {leg.home_score}-{leg.away_score} {teamName(leg.away_entry, leg.away_placeholder)}</p>)}</div></article>) : <p className="muted">No completed finals yet.</p>}</div></section><section className="card"><p className="eyebrow">Knockout results</p><ResultSections sections={knockoutResults} /></section><section className="card"><p className="eyebrow">Group results</p><ResultSections sections={groupResults} /></section></main>;
}

function ResultSections({ sections }) {
  const entries = Object.entries(sections);
  if (!entries.length) return <p className="muted">No results yet.</p>;
  return <div className="fixture-sections">{entries.map(([title, matches]) => <section className="fixture-section" key={title}><div className="fixture-section-header"><h3>{title}</h3><span>{matches.length} fixtures</span></div><div className="fixture-card-list">{matches.map((match) => <article className={isCompleted(match) ? 'fixture-card played' : 'fixture-card'} key={match.id}><div className="fixture-teams"><strong>{teamName(match.home_entry, match.home_placeholder)}</strong><span className="fixture-score">{isCompleted(match) ? `${match.home_score} - ${match.away_score}` : 'v'}</span><strong>{teamName(match.away_entry, match.away_placeholder)}</strong></div><div className="fixture-actions"><span>{match.round}{match.leg ? ` · ${Number(match.leg) === 1 ? '1st leg' : '2nd leg'}` : ''}</span></div></article>)}</div></section>)}</div>;
}
