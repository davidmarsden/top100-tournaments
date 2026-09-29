import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const SETUP_ID = '239138';
const HAMBURG_ID = '48506708';

function outcomeFor(match, side) {
  const gf = side === 'h' ? Number(match.homeScore) : Number(match.awayScore);
  const ga = side === 'h' ? Number(match.awayScore) : Number(match.homeScore);
  return gf > ga ? 'W' : gf === ga ? 'D' : 'L';
}

function scoreState(match, side) {
  if (!match.scoreAtFirstRedReliable) return 'Unknown';
  const gf = side === 'h' ? Number(match.homeScoreAtFirstRed) : Number(match.awayScoreAtFirstRed);
  const ga = side === 'h' ? Number(match.awayScoreAtFirstRed) : Number(match.homeScoreAtFirstRed);
  return gf > ga ? 'Leading' : gf === ga ? 'Level' : 'Behind';
}

function strengthBand(gap) {
  if (gap === null || gap === undefined) return 'Unknown';
  const n = Number(gap);
  return n >= 1 ? 'Stronger XI' : n <= -1 ? 'Weaker XI' : 'Similar XI';
}

function tacticStateCount(tactics) {
  const instructions = tactics?.instructions || {};
  return Math.max(0, ...Object.values(instructions).map((value) => Array.isArray(value) ? value.length : 0));
}

export default function RedCardLab() {
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('Loading red-card matches…');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase.rpc('manager_lab_red_cards', { target_setup_id: SETUP_ID });
      if (!mounted) return;
      if (error) { setStatus(`Red Card Lab could not load: ${error.message}`); return; }
      setMatches(Array.isArray(data?.matches) ? data.matches : []);
      setStatus('');
    })();
    return () => { mounted = false; };
  }, []);

  const analysis = useMemo(() => {
    const oneSided = [];
    matches.forEach((match) => {
      if (match.homeReds > 0 && match.awayReds === 0) oneSided.push({ match, side: 'h', result: outcomeFor(match, 'h') });
      if (match.awayReds > 0 && match.homeReds === 0) oneSided.push({ match, side: 'a', result: outcomeFor(match, 'a') });
    });
    const wins = oneSided.filter((row) => row.result === 'W').length;
    const draws = oneSided.filter((row) => row.result === 'D').length;
    const losses = oneSided.filter((row) => row.result === 'L').length;
    const multi = oneSided.filter(({ match, side }) => (side === 'h' ? match.homeReds : match.awayReds) >= 2);
    const hamburg = matches.filter((match) => match.homeClubId === HAMBURG_ID || match.awayClubId === HAMBURG_ID);
    const byDivision = ['Division 1','Division 2','Division 3','Division 4','Division 5'].map((division) => {
      const sample = oneSided.filter(({ match }) => match.competition === division);
      return {
        division, played: sample.length,
        wins: sample.filter((row) => row.result === 'W').length,
        draws: sample.filter((row) => row.result === 'D').length,
        losses: sample.filter((row) => row.result === 'L').length,
      };
    });
    const contextual = oneSided.map((row) => ({
      ...row,
      scoreState: scoreState(row.match, row.side),
      strengthBand: strengthBand(row.match.dismissedXiGap),
      tacticStates: tacticStateCount(row.side === 'h' ? row.match.homeTactics : row.match.awayTactics),
    }));
    const byContext = (field, values) => values.map((label) => {
      const sample = contextual.filter((row) => row[field] === label);
      return { label, played: sample.length, wins: sample.filter((row) => row.result === 'W').length, draws: sample.filter((row) => row.result === 'D').length, losses: sample.filter((row) => row.result === 'L').length };
    });
    return { oneSided, wins, draws, losses, multi, hamburg, byDivision, contextual,
      byScoreState: byContext('scoreState',['Leading','Level','Behind','Unknown']),
      byStrength: byContext('strengthBand',['Stronger XI','Similar XI','Weaker XI','Unknown']) };
  
  }, [matches]);

  if (status) return <section className="card"><h2>Red Card Lab</h2><p className="muted">{status}</p></section>;

  const avoidDefeat = analysis.oneSided.length ? (analysis.wins + analysis.draws) / analysis.oneSided.length : 0;
  return <section className="card">
    <h2>🟥 Red Card Lab</h2>
    <p className="muted">Does Soccer Manager really make ten men harder to beat? This first pass uses the latest archived version of every S28 league fixture across all five Top 100 divisions. It separates one-sided dismissals from matches where both teams had reds. Experiment 2 controls for dismissal timing, score state where the event timeline is complete, and starting-XI strength. These remain descriptive associations rather than proof that going down to ten causes a boost.</p>

    <div className="lab-stat-grid">
      <div><strong>{matches.length}</strong><span>matches with reds</span></div>
      <div><strong>{analysis.oneSided.length}</strong><span>one-sided red matches</span></div>
      <div><strong>{analysis.wins}</strong><span>reduced team wins</span></div>
      <div><strong>{analysis.draws}</strong><span>reduced team draws</span></div>
      <div><strong>{(avoidDefeat * 100).toFixed(1)}%</strong><span>reduced team avoids defeat</span></div>
    </div>

    <h3>By division</h3>
    <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Division</th><th>One-sided reds</th><th>Reduced team W</th><th>D</th><th>L</th><th>Avoid defeat</th></tr></thead><tbody>
      {analysis.byDivision.map((row) => <tr key={row.division}><td><strong>{row.division}</strong></td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.played ? (((row.wins + row.draws) / row.played) * 100).toFixed(1) + '%' : '—'}</td></tr>)}
    </tbody></table></div>

    <h3>Score state at first dismissal</h3>
    <p className="muted">Score state is shown only when every goal in the archived event stream has a usable minute. Untimed goals make the state unknown rather than guessed.</p>
    <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>State</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>Avoid defeat</th></tr></thead><tbody>
      {analysis.byScoreState.map((row) => <tr key={row.label}><td><strong>{row.label}</strong></td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.played ? (((row.wins+row.draws)/row.played)*100).toFixed(1)+'%' : '—'}</td></tr>)}
    </tbody></table></div>

    <h3>XI strength of the dismissed side</h3>
    <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>XI band</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>Avoid defeat</th></tr></thead><tbody>
      {analysis.byStrength.map((row) => <tr key={row.label}><td><strong>{row.label}</strong></td><td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td><td>{row.played ? (((row.wins+row.draws)/row.played)*100).toFixed(1)+'%' : '—'}</td></tr>)}
    </tbody></table></div>

    <h3>One-sided dismissal detail</h3>
    <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Match</th><th>Red</th><th>State</th><th>XI gap</th><th>Tactic states</th><th>Result</th></tr></thead><tbody>
      {analysis.contextual.map(({match,side,result,scoreState:state,tacticStates}) => <tr key={match.fixtureId}><td>{match.home} v {match.away}</td><td>{match.firstRedMinute ? match.firstRedMinute+"'" : '—'} · {side==='h'?match.home:match.away}</td><td>{state}{match.scoreAtFirstRedReliable ? ` · ${match.homeScoreAtFirstRed}–${match.awayScoreAtFirstRed}` : ''}</td><td>{match.dismissedXiGap===null||match.dismissedXiGap===undefined?'—':`${Number(match.dismissedXiGap)>=0?'+':''}${Number(match.dismissedXiGap).toFixed(1)}`}</td><td>{tacticStates || '—'}</td><td><strong>{result}</strong></td></tr>)}
    </tbody></table></div>
    <p className="muted">The archive exposes multiple captured tactical states, but the current match-report payload does not give us a verified minute for each tactical state. So this version reports how many states were captured without pretending we can yet label a change “after the red”. Decoding that timeline is the next data task.</p>

    <h3>Hamburg's red-card files</h3>
    <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Date</th><th>Match</th><th>Score</th><th>Reds</th><th>Dismissed players</th></tr></thead><tbody>
      {[...analysis.hamburg].reverse().map((match) => <tr key={match.fixtureId}><td>{match.date || '—'}</td><td><strong>{match.home} v {match.away}</strong></td><td>{match.homeScore}–{match.awayScore}</td><td>{match.homeReds}–{match.awayReds}</td><td>{match.redCards.map((card) => `${card.playerName || 'Unknown'}${card.minute ? ` ${card.minute}'` : ''}`).join(' · ')}</td></tr>)}
    </tbody></table></div>

    <h3>Extreme cases</h3>
    {analysis.multi.length ? <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Match</th><th>Score</th><th>Reduced side</th><th>Reds</th><th>Result</th></tr></thead><tbody>
      {analysis.multi.map(({ match, side, result }) => <tr key={match.fixtureId}><td>{match.home} v {match.away}</td><td>{match.homeScore}–{match.awayScore}</td><td>{side === 'h' ? match.home : match.away}</td><td>{side === 'h' ? match.homeReds : match.awayReds}</td><td><strong>{result}</strong></td></tr>)}
    </tbody></table></div> : <p className="muted">No one-sided multiple-dismissal matches in the current archive.</p>}

    <p className="muted"><strong>Experiment 2:</strong> dismissal minute, reliable score state and XI-strength gap are now controlled explicitly. Tactical-state changes are exposed with a timing caveat until Soccer Manager's tactic-action timeline is decoded. These are still descriptive associations, not evidence that a dismissal itself improves performance.</p>
  </section>;
}