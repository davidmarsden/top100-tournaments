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

export default function RedCardLab({ onExportData }) {
  const [matches, setMatches] = useState([]);
  const [controls, setControls] = useState([]);
  const [status, setStatus] = useState('Loading red-card matches…');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const [{ data, error }, { data: controlData, error: controlError }] = await Promise.all([
        supabase.rpc('manager_lab_red_cards', { target_setup_id: SETUP_ID }),
        supabase.rpc('manager_lab_red_card_controls', { target_setup_id: SETUP_ID }),
      ]);
      if (!mounted) return;
      if (error || controlError) { setStatus(`Red Card Lab could not load: ${error?.message || controlError?.message}`); return; }
      setMatches(Array.isArray(data?.matches) ? data.matches : []);
      setControls(Array.isArray(controlData?.matches) ? controlData.matches : []);
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
    const reliable = contextual.filter((row) => row.match.scoreAtFirstRedReliable && row.match.firstRedMinute != null && row.match.dismissedXiGap != null);
    const stateAt = (match, side, minute, sequence) => {
      let h=0,a=0;
      (match.goalEvents||[]).forEach((g)=>{
        const goalMinute=Number(g.minute);
        const beforeCutoff=goalMinute<Number(minute) ||
          (goalMinute===Number(minute) && sequence!=null && Number(g.sequence)<Number(sequence));
        if(beforeCutoff){ if(g.side==='h')h++; if(g.side==='a')a++; }
      });
      const gf=side==='h'?h:a, ga=side==='h'?a:h;
      return gf>ga?'Leading':gf===ga?'Level':'Behind';
    };
    const matched = reliable.map((row) => {
      const targetGap=Number(row.match.dismissedXiGap), sample=[];
      controls.forEach((m)=>{
        const side=row.side;
        if(m.competition!==row.match.competition) return;
        const gap=side==='h'?Number(m.homeXiRating)-Number(m.awayXiRating):Number(m.awayXiRating)-Number(m.homeXiRating);
        const firstRedSequence=(row.match.redCards||[])
          .filter((card)=>Number(card.minute)===Number(row.match.firstRedMinute))
          .map((card)=>Number(card.sequence))
          .filter(Number.isFinite)
          .sort((a,b)=>a-b)[0];
        if(Math.abs(gap-targetGap)>1 || stateAt(m,side,row.match.firstRedMinute,firstRedSequence)!==row.scoreState) return;
        sample.push(outcomeFor(m,side));
      });
      return {fixtureId:row.match.fixtureId,result:row.result,controls:sample.length,
        controlWinRate:sample.length?sample.filter(x=>x==='W').length/sample.length:null,
        controlAvoidRate:sample.length?sample.filter(x=>x!=='L').length/sample.length:null};
    }).filter((row)=>row.controls>=5);
    const avg=(key)=>matched.length?matched.reduce((s,r)=>s+r[key],0)/matched.length:null;
    const experiment3={eligibleRedCases:reliable.length,matchedRedCases:matched.length,controlPoolMatches:controls.length,
      actualWinRate:matched.length?matched.filter(r=>r.result==='W').length/matched.length:null,
      expectedWinRate:avg('controlWinRate'),
      actualAvoidRate:matched.length?matched.filter(r=>r.result!=='L').length/matched.length:null,
      expectedAvoidRate:avg('controlAvoidRate'),matches:matched};
    return { oneSided, wins, draws, losses, multi, hamburg, byDivision, contextual, experiment3,
      byScoreState: byContext('scoreState',['Leading','Level','Behind','Unknown']),
      byStrength: byContext('strengthBand',['Stronger XI','Similar XI','Weaker XI','Unknown']) };
  
  }, [matches, controls]);

  useEffect(() => {
    if (!onExportData || status) return;
    onExportData({
      version: 2,
      matchCount: matches.length,
      oneSidedCount: analysis.oneSided.length,
      wins: analysis.wins,
      draws: analysis.draws,
      losses: analysis.losses,
      avoidDefeatRate: analysis.oneSided.length ? (analysis.wins + analysis.draws) / analysis.oneSided.length : null,
      byDivision: analysis.byDivision,
      byScoreState: analysis.byScoreState,
      byStrength: analysis.byStrength,
      experiment3: analysis.experiment3,
      matches: analysis.contextual.map(({ match, side, result, scoreState: state, strengthBand: band, tacticStates }) => ({
        fixtureId: match.fixtureId,
        date: match.date ?? null,
        competition: match.competition ?? null,
        homeClubId: match.homeClubId ?? null,
        awayClubId: match.awayClubId ?? null,
        home: match.home ?? null,
        away: match.away ?? null,
        finalScore: [match.homeScore, match.awayScore],
        dismissedSide: side,
        dismissedTeam: side === 'h' ? match.home : match.away,
        result,
        redCards: match.redCards,
        firstRedMinute: match.firstRedMinute ?? null,
        scoreStateAtFirstRed: state,
        scoreAtFirstRedReliable: Boolean(match.scoreAtFirstRedReliable),
        scoreAtFirstRed: match.scoreAtFirstRedReliable ? [match.homeScoreAtFirstRed, match.awayScoreAtFirstRed] : null,
        dismissedXiGap: match.dismissedXiGap ?? null,
        strengthBand: band,
        homeXiRating: match.homeXiRating ?? null,
        awayXiRating: match.awayXiRating ?? null,
        tacticStateCount: tacticStates,
        dismissedTeamTactics: side === 'h' ? match.homeTactics : match.awayTactics,
        opponentTactics: side === 'h' ? match.awayTactics : match.homeTactics,
      })),
      caveats: [
        'Score state is unknown unless the archived goal timeline is complete, attributed and reconciles with the final score.',
        'Captured tactical states do not yet have verified event minutes, so they cannot be labelled as post-dismissal changes.',
        'Associations are descriptive and do not establish that a dismissal causes improved performance.',
      ],
    });
  }, [analysis, matches, onExportData, status]);

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

    <h3>Experiment 3 · matched 11-v-11 control</h3>
    <p className="muted">Each reliable one-sided dismissal is compared with ordinary no-red league matches from the same division, viewed at the exact dismissal minute, from the same home/away perspective, with the same score state and a starting-XI gap within ±1.0 rating point. Cases need at least five controls.</p>
    <div className="lab-stat-grid">
      <div><strong>{analysis.experiment3.matchedRedCases}</strong><span>matched red cases</span></div>
      <div><strong>{analysis.experiment3.actualWinRate==null?'—':(analysis.experiment3.actualWinRate*100).toFixed(1)+'%'}</strong><span>reduced-team wins</span></div>
      <div><strong>{analysis.experiment3.expectedWinRate==null?'—':(analysis.experiment3.expectedWinRate*100).toFixed(1)+'%'}</strong><span>matched 11-v-11 wins</span></div>
      <div><strong>{analysis.experiment3.actualAvoidRate==null?'—':(analysis.experiment3.actualAvoidRate*100).toFixed(1)+'%'}</strong><span>reduced avoids defeat</span></div>
      <div><strong>{analysis.experiment3.expectedAvoidRate==null?'—':(analysis.experiment3.expectedAvoidRate*100).toFixed(1)+'%'}</strong><span>11-v-11 avoids defeat</span></div>
    </div>
    <p className="muted">This is a matched observational benchmark, not a randomized counterfactual. Re-used control matches are averaged within each red-card case before the overall comparison.</p>

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