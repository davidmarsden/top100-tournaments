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

function aggregateTie(legs) {
  const ordered = [...legs].sort((a, b) => Number(a.leg || 1) - Number(b.leg || 1));
  const first = ordered[0];
  const firstId = first.home_entry_id || first.home_placeholder || 'home';
  const secondId = first.away_entry_id || first.away_placeholder || 'away';
  const firstName = teamName(first, 'home');
  const secondName = teamName(first, 'away');
  let firstAgg = 0;
  let secondAgg = 0;
  let allPlayed = true;

  ordered.forEach((leg) => {
    if (!completed(leg)) allPlayed = false;
    const home = Number(leg.home_score || 0);
    const away = Number(leg.away_score || 0);
    const homeId = leg.home_entry_id || leg.home_placeholder || 'home';
    if (homeId === firstId) {
      firstAgg += home;
      secondAgg += away;
    } else {
      firstAgg += away;
      secondAgg += home;
    }
  });

  let winnerId = null;
  if (allPlayed) {
    const explicitWinner = ordered.find((leg) => leg.winner_entry_id)?.winner_entry_id;
    if (explicitWinner) winnerId = explicitWinner;
    else if (firstAgg > secondAgg) winnerId = firstId;
    else if (secondAgg > firstAgg) winnerId = secondId;
  }

  const winnerName = winnerId === firstId ? firstName : winnerId === secondId ? secondName : null;

  return { first, ordered, firstId, secondId, firstName, secondName, firstAgg, secondAgg, allPlayed, winnerId, winnerName };
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
  const rounds = buildTies(matches.filter((match) => match.stage === 'knockout'));
  const finalRound = rounds.find((round) => round.round === 'Final') || rounds[rounds.length - 1];
  const finalTie = finalRound?.ties?.find((tie) => tie.winnerName) || null;

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
                {round.ties.map((tie) => <BracketTie tie={tie} key={`${round.round}-${tie.key}`} />)}
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
                {finalTie && <em>{finalTie.firstName} {finalTie.firstAgg}-{finalTie.secondAgg} {finalTie.secondName}</em>}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function BracketTie({ tie }) {
  const firstWon = tie.winnerId && tie.winnerId === tie.firstId;
  const secondWon = tie.winnerId && tie.winnerId === tie.secondId;
  const hasAggregate = tie.ordered.length > 1 && tie.allPlayed;

  return (
    <article className={tie.allPlayed ? 'bracket-tie played' : 'bracket-tie'}>
      <div className={firstWon ? 'bracket-team winner' : secondWon ? 'bracket-team loser' : 'bracket-team'}>
        <strong>{tie.firstName}</strong>
        <span>{hasAggregate ? tie.firstAgg : scoreText(tie.ordered[0])?.split(' - ')[0]}</span>
        {firstWon && <b>✓</b>}
      </div>
      <div className={secondWon ? 'bracket-team winner' : firstWon ? 'bracket-team loser' : 'bracket-team'}>
        <strong>{tie.secondName}</strong>
        <span>{hasAggregate ? tie.secondAgg : scoreText(tie.ordered[0])?.split(' - ')[1] || ''}</span>
        {secondWon && <b>✓</b>}
      </div>
      <small>{hasAggregate ? `Aggregate ${tie.firstAgg}-${tie.secondAgg}` : `${tie.ordered[0]?.round || 'Round'} · ${Number(tie.ordered[0]?.leg || 1) === 1 ? '1st leg' : '2nd leg'}`}</small>
    </article>
  );
}
