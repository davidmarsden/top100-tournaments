import { useEffect, useMemo, useState } from 'react';
import KnockoutBracket from './KnockoutBracket.jsx';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function isCompleted(match) { return match.status === 'played' || match.status === 'forfeit'; }
function teamNameFromEntry(entry, fallback) { return entry?.teams?.name || fallback || 'TBC'; }
function latestWinner(ordered) { return [...ordered].reverse().find((leg) => leg.winner_entry_id)?.winner_entry_id || null; }
function decisionText(winnerName, firstAway, secondAway, decidingLeg) {
  if (firstAway !== secondAway) return `away goals ${firstAway}-${secondAway}`;
  if (!decidingLeg) return winnerName === 'FET/manual winner needed' ? 'FET/manual decision needed' : 'tie-break';
  if (decidingLeg.home_extra_time_score !== null || decidingLeg.away_extra_time_score !== null) return `FET ${decidingLeg.home_extra_time_score ?? 0}-${decidingLeg.away_extra_time_score ?? 0}`;
  if (decidingLeg.home_penalty_score !== null || decidingLeg.away_penalty_score !== null) return `penalties ${decidingLeg.home_penalty_score ?? 0}-${decidingLeg.away_penalty_score ?? 0}`;
  return String(decidingLeg.decided_by || 'tie-break').replace(/_/g, ' ');
}
function resolveFinal(matches, bracket) {
  const finals = matches.filter((match) => match.stage === 'knockout' && match.bracket === bracket && match.round === 'Final');
  if (!finals.length || finals.some((match) => !isCompleted(match))) return null;
  const ordered = [...finals].sort((a, b) => Number(a.leg || 1) - Number(b.leg || 1));
  const first = ordered[0];
  const firstId = first.home_entry_id;
  const secondId = first.away_entry_id;
  const firstName = teamNameFromEntry(first.home_entry, first.home_placeholder);
  const secondName = teamNameFromEntry(first.away_entry, first.away_placeholder);
  let firstAgg = 0, secondAgg = 0, firstAway = 0, secondAway = 0;
  ordered.forEach((leg) => {
    const home = Number(leg.home_score || 0), away = Number(leg.away_score || 0);
    if (leg.home_entry_id === firstId) { firstAgg += home; secondAgg += away; secondAway += away; }
    else { firstAgg += away; secondAgg += home; firstAway += away; }
  });
  let winnerId = null;
  if (firstAgg > secondAgg) winnerId = firstId;
  else if (secondAgg > firstAgg) winnerId = secondId;
  else if (firstAway > secondAway) winnerId = firstId;
  else if (secondAway > firstAway) winnerId = secondId;
  else winnerId = latestWinner(ordered);
  const winnerName = winnerId === firstId ? firstName : winnerId === secondId ? secondName : 'FET/manual winner needed';
  const decidingLeg = [...ordered].reverse().find((leg) => leg.decided_by || leg.home_extra_time_score !== null || leg.away_extra_time_score !== null || leg.home_penalty_score !== null || leg.away_penalty_score !== null);
  const decision = firstAgg === secondAgg ? decisionText(winnerName, firstAway, secondAway, decidingLeg) : null;
  return { bracket, winnerName, firstName, secondName, aggregate: `${firstAgg}-${secondAgg}`, decision, needsFet: !winnerId, legs: ordered };
}
function bracketsFrom(matches) { return [...new Set(matches.filter((match) => match.stage === 'knockout').map((match) => match.bracket || 'Cup'))]; }

export default function PublicPageManager({ selectedTournament, onTournamentUpdated }) {
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const tournamentId = selectedTournament?.id;
  useEffect(() => { if (hasSupabaseConfig && supabase && tournamentId) loadSummary(); }, [tournamentId]);
  const summary = useMemo(() => { const groupMatches = matches.filter((match) => match.stage === 'group'); const knockoutMatches = matches.filter((match) => match.stage === 'knockout'); return { groupTotal: groupMatches.length, groupPlayed: groupMatches.filter(isCompleted).length, knockoutTotal: knockoutMatches.length, knockoutPlayed: knockoutMatches.filter(isCompleted).length }; }, [matches]);
  const knockoutBrackets = useMemo(() => bracketsFrom(matches), [matches]);
  const winners = useMemo(() => knockoutBrackets.map((bracket) => resolveFinal(matches, bracket)).filter(Boolean), [matches, knockoutBrackets]);
  async function loadSummary() {
    if (!tournamentId) return;
    setLoading(true); setStatus('Loading tournament summary...');
    const { data, error } = await supabase.from('matches').select('id, stage, status, bracket, round, leg, match_order, fixture_date, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, decided_by, home_extra_time_score, away_extra_time_score, home_penalty_score, away_penalty_score, home_placeholder, away_placeholder, home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(id, name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(id, name))').eq('tournament_id', tournamentId);
    if (error) { setStatus('Could not load summary: ' + error.message); setMatches([]); }
    else { setMatches(data || []); setStatus('Summary loaded.'); }
    setLoading(false);
  }
  async function updateTournamentStatus(nextStatus) {
    if (!tournamentId) return;
    setLoading(true); setStatus('Saving tournament status...');
    const { error } = await supabase.from('tournaments').update({ status: nextStatus }).eq('id', tournamentId);
    if (error) setStatus('Status update failed: ' + error.message);
    else { setStatus('Tournament marked as ' + nextStatus + '.'); await onTournamentUpdated?.(); await loadSummary(); }
    setLoading(false);
  }
  if (!selectedTournament) return <p className="muted">Create or select a tournament first.</p>;
  if (!hasSupabaseConfig || !supabase) return <p className="muted">Supabase is not connected yet.</p>;
  const publicPath = '/tournaments/' + selectedTournament.id;
  const tournamentComplete = summary.knockoutTotal > 0 && summary.knockoutPlayed === summary.knockoutTotal;
  return <div className="public-page-manager"><section className="public-grid"><article className="public-card"><p className="eyebrow">Publishing controls</p><h3>{selectedTournament.name}</h3><p className="muted">Status: <strong>{selectedTournament.status || 'draft'}</strong></p><div className="button-row"><button type="button" onClick={() => updateTournamentStatus('published')} disabled={loading}>Mark published</button><button type="button" className="secondary" onClick={() => updateTournamentStatus('completed')} disabled={loading || !tournamentComplete}>Mark completed</button><button type="button" className="secondary" onClick={() => updateTournamentStatus('archived')} disabled={loading}>Archive tournament</button></div>{!tournamentComplete && <p className="muted">Complete all knockout fixtures before marking the tournament completed.</p>}</article><article className="public-card"><p className="eyebrow">Public tournament page</p><h3>Manager view</h3><code>{publicPath}</code><p className="muted">This is the non-admin page for fixtures, results, brackets and winners. It works while the tournament is live and after it is archived.</p><a className="public-link-button" href={publicPath} target="_blank" rel="noreferrer">Open public page</a></article></section>{knockoutBrackets.length > 0 && <section className="public-card"><p className="eyebrow">Public bracket preview</p><div className="public-bracket-stack">{knockoutBrackets.map((bracket) => <KnockoutBracket key={bracket} title={`${bracket} bracket`} matches={matches.filter((match) => (match.bracket || 'Cup') === bracket)} />)}</div></section>}<section className="public-card"><p className="eyebrow">Winners</p>{winners.length === 0 ? <p className="muted">No completed finals yet.</p> : <div className="overview-metrics compact-metrics">{winners.map((winner) => <article className="winner-summary-card" key={winner.bracket}><span>{winner.bracket} winner</span><strong>{winner.winnerName}</strong><small>{winner.firstName} {winner.aggregate} {winner.secondName}{winner.decision ? ` · ${winner.decision}` : ''}</small><div className="mini-results">{winner.legs.map((leg) => <p key={leg.id}>{Number(leg.leg) === 1 ? '1st leg' : '2nd leg'}: {teamNameFromEntry(leg.home_entry, leg.home_placeholder)} {leg.home_score}-{leg.away_score} {teamNameFromEntry(leg.away_entry, leg.away_placeholder)}</p>)}</div></article>)}</div>}</section><section className="public-card"><p className="eyebrow">Completion summary</p><div className="overview-metrics compact-metrics"><article><span>Group results</span><strong>{summary.groupPlayed}/{summary.groupTotal}</strong></article><article><span>Knockout results</span><strong>{summary.knockoutPlayed}/{summary.knockoutTotal}</strong></article><article><span>Ready to complete</span><strong>{tournamentComplete ? 'Yes' : 'No'}</strong></article></div><p className="status">{status}</p><button type="button" className="secondary" onClick={loadSummary} disabled={loading}>Reload summary</button></section></div>;
}
