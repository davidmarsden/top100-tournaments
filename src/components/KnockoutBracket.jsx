import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const ROUND_LABELS = {
  R64: 'Round of 64',
  R32: 'Round of 32',
  R16: 'Round of 16',
  QF: 'Quarter Finals',
  SF: 'Semi Finals',
  Final: 'Final',
};

const DEFAULT_ORDER = ['R64', 'R32', 'R16', 'QF', 'SF', 'Final'];

function completed(match) {
  return match.status === 'played' || match.status === 'forfeit';
}

function teamName(match, side) {
  const entry = side === 'home' ? match.home_entry : match.away_entry;
  const fallback = side === 'home' ? match.home_placeholder : match.away_placeholder;
  return entry?.teams?.name || fallback || 'TBC';
}

function roundRank(round) {
  const index = DEFAULT_ORDER.indexOf(round);
  return index >= 0 ? index : 99;
}

function roundLabel(round) {
  return ROUND_LABELS[round] || round || 'Round';
}

function scoreText(match) {
  return completed(match) ? `${match.home_score ?? 0} - ${match.away_score ?? 0}` : 'v';
}

function sideId(match, side) {
  return side === 'home'
    ? match.home_entry_id || match.home_placeholder || 'home'
    : match.away_entry_id || match.away_placeholder || 'away';
}

function latestExplicitWinner(ordered) {
  return [...ordered].reverse().find((leg) => leg.winner_entry_id)?.winner_entry_id || null;
}

function decisionLabel(tie) {
  if (!tie.allPlayed) return null;
  if (tie.firstAgg !== tie.secondAgg) return null;
  if (tie.firstAway !== tie.secondAway) {
    const leader = tie.firstAway > tie.secondAway ? tie.firstName : tie.secondName;
    return `${leader} lead on away goals (${tie.firstAway}-${tie.secondAway})`;
  }
  const decidingLeg = [...tie.ordered].reverse().find((leg) => leg.decided_by || leg.home_extra_time_score !== null || leg.away_extra_time_score !== null || leg.home_penalty_score !== null || leg.away_penalty_score !== null);
  if (!decidingLeg) return tie.winnerName ? `${tie.winnerName} advance after tie-break` : 'Tie-break decision needed';
  const decidedBy = String(decidingLeg.decided_by || '').replace(/_/g, ' ');
  if (decidingLeg.home_extra_time_score !== null || decidingLeg.away_extra_time_score !== null) {
    return `${tie.winnerName || 'Winner'} after FET (${decidingLeg.home_extra_time_score ?? 0}-${decidingLeg.away_extra_time_score ?? 0})`;
  }
  if (decidingLeg.home_penalty_score !== null || decidingLeg.away_penalty_score !== null) {
    return `${tie.winnerName || 'Winner'} on penalties (${decidingLeg.home_penalty_score ?? 0}-${decidingLeg.away_penalty_score ?? 0})`;
  }
  return decidedBy ? `${tie.winnerName || 'Winner'} after ${decidedBy}` : null;
}

function aggregateTie(legs) {
  const ordered = [...legs].sort((a, b) => Number(a.leg || 1) - Number(b.leg || 1));
  const first = ordered[0];
  const firstId = sideId(first, 'home');
  const secondId = sideId(first, 'away');
  const firstName = teamName(first, 'home');
  const secondName = teamName(first, 'away');
  let firstAgg = 0;
  let secondAgg = 0;
  let firstAway = 0;
  let secondAway = 0;
  let allPlayed = true;

  ordered.forEach((leg) => {
    if (!completed(leg)) allPlayed = false;
    const home = Number(leg.home_score || 0);
    const away = Number(leg.away_score || 0);
    const homeId = sideId(leg, 'home');
    if (homeId === firstId) {
      firstAgg += home;
      secondAgg += away;
      secondAway += away;
    } else {
      firstAgg += away;
      secondAgg += home;
      firstAway += away;
    }
  });

  let winnerId = null;
  if (allPlayed) {
    if (firstAgg > secondAgg) winnerId = firstId;
    else if (secondAgg > firstAgg) winnerId = secondId;
    else if (firstAway > secondAway) winnerId = firstId;
    else if (secondAway > firstAway) winnerId = secondId;
    else winnerId = latestExplicitWinner(ordered);
  }

  const winnerName = winnerId === firstId ? firstName : winnerId === secondId ? secondName : null;
  const tie = { first, ordered, firstId, secondId, firstName, secondName, firstAgg, secondAgg, firstAway, secondAway, allPlayed, winnerId, winnerName };
  return { ...tie, decision: decisionLabel(tie) };
}

function buildTies(matches) {
  const byRound = new Map();
  matches.forEach((match) => {
    const round = match.round || 'Round';
    if (!byRound.has(round)) byRound.set(round, new Map());
    const key = match.match_order || match.id;
    if (!byRound.get(round).has(key)) byRound.get(round).set(key, []);
    byRound.get(round).get(key).push(match);
  });

  return [...byRound.entries()]
    .sort(([a], [b]) => roundRank(a) - roundRank(b) || String(a).localeCompare(String(b)))
    .map(([round, ties]) => ({
      round,
      ties: [...ties.entries()]
        .sort(([a], [b]) => Number(a || 0) - Number(b || 0))
        .map(([key, legs]) => ({ key, ...aggregateTie(legs) })),
    }));
}

export default function KnockoutBracket({ matches = [], title = 'Knockout bracket', showChampion = true }) {
  const [seedByEntryId, setSeedByEntryId] = useState(new Map());
  const entryIds = useMemo(() => [...new Set(matches.flatMap((match) => [match.home_entry_id, match.away_entry_id]).filter(Boolean))], [matches]);
  const rounds = useMemo(() => buildTies(matches.filter((match) => match.stage === 'knockout')), [matches]);
  const finalRound = rounds.find((round) => round.round === 'Final') || rounds[rounds.length - 1];
  const finalTie = finalRound?.ties?.find((tie) => tie.winnerName) || null;

  useEffect(() => {
    let cancelled = false;
    async function loadSeeds() {
      if (!entryIds.length || !supabase) {
        setSeedByEntryId(new Map());
        return;
      }
      const { data, error } = await supabase.from('tournament_entries').select('id, seed').in('id', entryIds);
      if (cancelled || error) return;
      setSeedByEntryId(new Map((data || []).map((row) => [row.id, row.seed])));
    }
    loadSeeds();
    return () => { cancelled = true; };
  }, [entryIds.join(',')]);

  if (!rounds.length) return <p className="muted">No knockout bracket yet.</p>;

  return (
    <section className="visual-bracket-card">
      <div className="visual-bracket-header">
        <div>
          <p className="eyebrow">Bracket view</p>
          <h3>{title}</h3>
        </div>
        <div className="bracket-legend">
          <span><i className="legend-win" /> Winner</span>
          <span><i className="legend-loss" /> Loser</span>
          <span>🏆 Champion</span>
        </div>
      </div>

      <div className="visual-bracket-scroll">
        <div className="visual-bracket" style={{ gridTemplateColumns: `repeat(${rounds.length + (showChampion ? 1 : 0)}, minmax(210px, 1fr))` }}>
          {rounds.map((round) => (
            <div className="bracket-round-column" key={round.round}>
              <div className="bracket-round-title">{roundLabel(round.round)}</div>
              <div className="bracket-tie-stack">
                {round.ties.map((tie) => <BracketTie tie={tie} seedByEntryId={seedByEntryId} key={`${round.round}-${tie.key}`} />)}
              </div>
            </div>
          ))}
          {showChampion && (
            <div className="bracket-champion-column">
              <div className="bracket-round-title">Champion</div>
              <div className="champion-card">
                <div className="champion-trophy">🏆</div>
                <span>{finalTie?.winnerName ? 'Champion' : 'Awaiting winner'}</span>
                <strong>{finalTie?.winnerName || 'TBC'}</strong>
                {finalTie && <em>{finalTie.firstName} {finalTie.firstAgg}-{finalTie.secondAgg} {finalTie.secondName}{finalTie.decision ? ` · ${finalTie.decision}` : ''}</em>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function BracketTie({ tie, seedByEntryId }) {
  const firstWon = tie.winnerId && tie.winnerId === tie.firstId;
  const secondWon = tie.winnerId && tie.winnerId === tie.secondId;
  const hasAggregate = tie.ordered.length > 1 && tie.allPlayed;
  const firstSeed = seedByEntryId.get(tie.firstId);
  const secondSeed = seedByEntryId.get(tie.secondId);

  return (
    <article className={tie.allPlayed ? 'bracket-tie played' : 'bracket-tie'}>
      <div className={firstWon ? 'bracket-team winner' : secondWon ? 'bracket-team loser' : 'bracket-team'}>
        <strong className="bracket-team-name">{firstSeed ? <span className="bracket-seed-pill">{firstSeed}</span> : null}{tie.firstName}</strong>
        <span>{hasAggregate ? tie.firstAgg : scoreText(tie.ordered[0])?.split(' - ')[0]}</span>
        {firstWon && <b>✓</b>}
      </div>
      <div className={secondWon ? 'bracket-team winner' : firstWon ? 'bracket-team loser' : 'bracket-team'}>
        <strong className="bracket-team-name">{secondSeed ? <span className="bracket-seed-pill">{secondSeed}</span> : null}{tie.secondName}</strong>
        <span>{hasAggregate ? tie.secondAgg : scoreText(tie.ordered[0])?.split(' - ')[1] || ''}</span>
        {secondWon && <b>✓</b>}
      </div>
      <small>{hasAggregate ? `Aggregate ${tie.firstAgg}-${tie.secondAgg}${tie.decision ? ` · ${tie.decision}` : ''}` : `${tie.ordered[0]?.round || 'Round'} · ${Number(tie.ordered[0]?.leg || 1) === 1 ? '1st leg' : '2nd leg'}`}</small>
    </article>
  );
}
