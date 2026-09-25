import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const SETUP_ID = '239138';
const HAMBURG_ID = '48506708';

function numericValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function pct(value) {
  const n = numericValue(value);
  return n === null ? '—' : `${n.toFixed(1)}%`;
}

function avg(rows, key) {
  const values = rows.map((row) => numericValue(row[key])).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function tacticValue(match, key) {
  const tactics = match?.tactics;
  if (!tactics) return null;
  if (key === 'formation') {
    return firstValue(tactics.formationNames) ?? firstValue(tactics.formationName) ?? firstValue(tactics.formation);
  }
  if (key === 'mentality') {
    return firstValue(tactics.instructions?.mentality) ?? firstValue(tactics.mentality);
  }
  return firstValue(tactics[key]);
}

function resultPoints(result) {
  return result === 'W' ? 3 : result === 'D' ? 1 : 0;
}

export default function ManagerLabPage() {
  const [matches, setMatches] = useState([]);
  const [status, setStatus] = useState('Loading the S28 archive…');
  const [competition, setCompetition] = useState('All');
  const [context, setContext] = useState('All');
  const [strength, setStrength] = useState('All');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase.rpc('manager_lab_match_summary', {
        target_setup_id: SETUP_ID,
        target_source_club_id: HAMBURG_ID,
      });
      if (!mounted) return;
      if (error) {
        setStatus(`Manager Lab could not load: ${error.message}`);
        return;
      }
      setMatches(Array.isArray(data?.matches) ? data.matches : []);
      setStatus('');
    })();
    return () => { mounted = false; };
  }, []);

  const competitions = useMemo(() => ['All', ...new Set(matches.map((row) => row.competition).filter(Boolean))], [matches]);
  const contexts = useMemo(() => ['All', ...new Set(matches.map((row) => row.matchContext).filter(Boolean))], [matches]);
  const strengthBand = (row) => {
    const difference = numericValue(row.xiRatingDifference);
    if (difference === null) return 'Unknown XI strength';
    if (difference < -1) return 'Stronger opponent XI';
    if (difference > 1) return 'Weaker opponent XI';
    return 'Similar XI strength';
  };
  const strengthBands = ['All', 'Stronger opponent XI', 'Similar XI strength', 'Weaker opponent XI', 'Unknown XI strength'];
  const rows = matches.filter((row) =>
    (competition === 'All' || row.competition === competition) &&
    (context === 'All' || row.matchContext === context) &&
    (strength === 'All' || strengthBand(row) === strength)
  );
  const wins = rows.filter((row) => row.result === 'W').length;
  const draws = rows.filter((row) => row.result === 'D').length;
  const losses = rows.filter((row) => row.result === 'L').length;
  const points = rows.reduce((sum, row) => sum + resultPoints(row.result), 0);
  const ppg = rows.length ? points / rows.length : 0;
  const gf = rows.reduce((sum, row) => sum + (Number(row.goalsFor) || 0), 0);
  const ga = rows.reduce((sum, row) => sum + (Number(row.goalsAgainst) || 0), 0);

  const tacticGroups = useMemo(() => {
    const map = new Map();
    rows.forEach((match) => {
      const formation = tacticValue(match, 'formation') || 'Unknown';
      const mentality = tacticValue(match, 'mentality') || 'Unknown';
      const key = `${formation} · ${mentality}`;
      const group = map.get(key) || { key, played: 0, points: 0, gf: 0, ga: 0 };
      group.played += 1;
      group.points += resultPoints(match.result);
      group.gf += Number(match.goalsFor) || 0;
      group.ga += Number(match.goalsAgainst) || 0;
      map.set(key, group);
    });
    return [...map.values()].map((group) => ({ ...group, ppg: group.points / group.played }))
      .sort((a, b) => b.played - a.played || b.ppg - a.ppg);
  }, [rows]);

  return <main className="app-shell manager-lab">
    <section className="hero">
      <div className="hero-row"><div>
        <p className="eyebrow">Top 100 · Soccer Manager archive</p>
        <h1>Manager Lab</h1>
        <p>Hamburger SV, S28. Evidence from the archived match reports — results, underlying match numbers and the tactics used.</p>
      </div><div className="button-row">
        <a className="button secondary" href="/admin/soccer-manager-sync">Soccer Manager Sync</a>
        <a className="button secondary" href="/admin">Tournament admin</a>
      </div></div>
    </section>

    {status && <section className="card"><p className="status">{status}</p></section>}
    {!status && <>
      <section className="card">
        <div className="manager-lab-toolbar">
          <div><h2>S28 at a glance</h2><p className="muted">{rows.length} archived matches in this view.</p></div>
          <div className="manager-lab-filters">
            <label>Match context<select value={context} onChange={(event) => setContext(event.target.value)}>{contexts.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>XI strength<select value={strength} onChange={(event) => setStrength(event.target.value)}>{strengthBands.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Competition<select value={competition} onChange={(event) => setCompetition(event.target.value)}>{competitions.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
        </div>
        <div className="manager-lab-kpis">
          <article><span>Record</span><strong>{wins}–{draws}–{losses}</strong><small>W–D–L</small></article>
          <article><span>Points / game</span><strong>{ppg.toFixed(2)}</strong><small>{points} points</small></article>
          <article><span>Goals</span><strong>{gf}–{ga}</strong><small>{rows.length ? ((gf-ga)/rows.length).toFixed(2) : '0.00'} GD / game</small></article>
          <article><span>Possession</span><strong>{pct(avg(rows, 'possession'))}</strong><small>average</small></article>
          <article><span>Shots</span><strong>{avg(rows, 'shots')?.toFixed(1) || '—'}</strong><small>{avg(rows, 'shotsOnTarget')?.toFixed(1) || '—'} on target</small></article>
          <article><span>Starting XI</span><strong>{avg(rows, 'ourXiRating')?.toFixed(1) || '—'}</strong><small>{avg(rows, 'xiRatingDifference') === null ? 'strength difference unavailable' : `${avg(rows, 'xiRatingDifference') >= 0 ? '+' : ''}${avg(rows, 'xiRatingDifference').toFixed(1)} vs opponents`}</small></article>
        </div>
      </section>

      <section className="card">
        <h2>Tactical fingerprints</h2>
        <p className="muted">Grouped by the opening formation and mentality captured in each report. Use Match context and XI strength above to compare like with like instead of mixing league first teams, rotated cup sides and weak SMFA opposition.</p>
        <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Setup</th><th>MP</th><th>PPG</th><th>GF</th><th>GA</th><th>GD/game</th></tr></thead><tbody>
          {tacticGroups.map((group) => <tr key={group.key}><td><strong>{group.key}</strong></td><td>{group.played}</td><td>{group.ppg.toFixed(2)}</td><td>{group.gf}</td><td>{group.ga}</td><td>{((group.gf - group.ga) / group.played).toFixed(2)}</td></tr>)}
        </tbody></table></div>
      </section>

      <section className="card">
        <h2>Match ledger</h2>
        <p className="muted">The audit trail behind the numbers. This deliberately reports what the archive contains rather than inventing xG or other unavailable metrics.</p>
        <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Date</th><th>Context</th><th>Competition</th><th>Opponent</th><th>Result</th><th>Our XI</th><th>Opp XI</th><th>Δ XI</th><th>Poss.</th><th>Shots</th><th>On target</th><th>Corners</th></tr></thead><tbody>
          {[...rows].reverse().map((match) => <tr key={match.fixtureId}><td>{match.date || '—'}</td><td>{match.matchContext || '—'}</td><td>{match.competition}</td><td>{match.venue} · {match.opponent}</td><td><strong className={`lab-result ${match.result}`}>{match.goalsFor}–{match.goalsAgainst}</strong></td><td>{numericValue(match.ourXiRating)?.toFixed(1) || '—'}</td><td>{numericValue(match.opponentXiRating)?.toFixed(1) || '—'}</td><td>{numericValue(match.xiRatingDifference) === null ? '—' : `${numericValue(match.xiRatingDifference) >= 0 ? '+' : ''}${numericValue(match.xiRatingDifference).toFixed(1)}`}</td><td>{pct(match.possession)}</td><td>{match.shots ?? '—'}</td><td>{match.shotsOnTarget ?? '—'}</td><td>{match.corners ?? '—'}</td></tr>)}
        </tbody></table></div>
      </section>
    </>}
  </main>;
}
