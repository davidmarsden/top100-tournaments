import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const SETUP_ID = '239138';
const HAMBURG_ID = '48506708';

function outcomeFor(match, side) {
  const gf = side === 'h' ? Number(match.homeScore) : Number(match.awayScore);
  const ga = side === 'h' ? Number(match.awayScore) : Number(match.homeScore);
  return gf > ga ? 'W' : gf === ga ? 'D' : 'L';
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
    return { oneSided, wins, draws, losses, multi, hamburg, byDivision };
  }, [matches]);

  if (status) return <section className="card"><h2>Red Card Lab</h2><p className="muted">{status}</p></section>;

  const avoidDefeat = analysis.oneSided.length ? (analysis.wins + analysis.draws) / analysis.oneSided.length : 0;
  return <section className="card">
    <h2>🟥 Red Card Lab</h2>
    <p className="muted">Does Soccer Manager really make ten men harder to beat? This first pass uses the latest archived version of every S28 league fixture across all five Top 100 divisions. It separates one-sided dismissals from matches where both teams had reds. These are descriptive outcomes: without a reliable score-at-dismissal timeline they do not yet prove a post-red-card boost.</p>

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

    <h3>Hamburg's red-card files</h3>
    <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Date</th><th>Match</th><th>Score</th><th>Reds</th><th>Dismissed players</th></tr></thead><tbody>
      {[...analysis.hamburg].reverse().map((match) => <tr key={match.fixtureId}><td>{match.date || '—'}</td><td><strong>{match.home} v {match.away}</strong></td><td>{match.homeScore}–{match.awayScore}</td><td>{match.homeReds}–{match.awayReds}</td><td>{match.redCards.map((card) => `${card.playerName || 'Unknown'}${card.minute ? ` ${card.minute}'` : ''}`).join(' · ')}</td></tr>)}
    </tbody></table></div>

    <h3>Extreme cases</h3>
    {analysis.multi.length ? <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Match</th><th>Score</th><th>Reduced side</th><th>Reds</th><th>Result</th></tr></thead><tbody>
      {analysis.multi.map(({ match, side, result }) => <tr key={match.fixtureId}><td>{match.home} v {match.away}</td><td>{match.homeScore}–{match.awayScore}</td><td>{side === 'h' ? match.home : match.away}</td><td>{side === 'h' ? match.homeReds : match.awayReds}</td><td><strong>{result}</strong></td></tr>)}
    </tbody></table></div> : <p className="muted">No one-sided multiple-dismissal matches in the current archive.</p>}

    <p className="muted"><strong>Next experiment:</strong> add score state at the first dismissal, dismissal minute, XI-strength gap and tactical changes after the card. That is the test that can distinguish a genuine “ten-man boost” from stronger teams, teams already leading, or memorable freak results.</p>
  </section>;
}