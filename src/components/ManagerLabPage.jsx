import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const SETUP_ID = '239138';

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
  const instructionKeys = {
    passingStyle: 'passing',
    attackingStyle: 'attackingStyle',
    tempo: 'tempo',
    pressing: 'pressing',
    defensiveLine: 'defensiveLine',
    width: 'width',
    aggression: 'aggression',
    creativity: 'creativity',
    counterAttack: 'counterAttack',
    tightMarking: 'tightMarking',
    menBehindBall: 'menBehindBall',
    sweeperKeeper: 'sweeperKeeper',
  };
  const instructionKey = instructionKeys[key];
  return firstValue(instructionKey ? tactics.instructions?.[instructionKey] : tactics[key]);
}

function normalizedTacticValue(match, key) {
  const value = tacticValue(match, key);
  return value === null || value === undefined || value === '' ? null : String(value);
}

function displayTacticValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  const text = String(value);
  if (['counterAttack', 'tightMarking', 'menBehindBall', 'sweeperKeeper'].includes(key)) {
    if (text === '1' || text === 'true') return 'On';
    if (text === '0' || text === 'false') return 'Off';
  }
  const labels = {
    width: { '1': 'Narrow', '2': 'Normal', '3': 'Wide' },
    creativity: { '1': 'Cautious', '2': 'Disciplined', '3': 'Expressive' },
  };
  return labels[key]?.[text] || text;
}

const TACTIC_KEYS = ['formation','mentality','passingStyle','attackingStyle','tempo','pressing','defensiveLine','width','aggression','creativity','counterAttack','tightMarking','menBehindBall','sweeperKeeper'];
const FAMILY_KEYS = ['formation','mentality','passingStyle','attackingStyle','tempo'];

function tacticSignature(match, keys = TACTIC_KEYS) {
  return keys.map((key) => normalizedTacticValue(match, key) ?? '—').join('|');
}

function xiBucket(value) {
  const n = numericValue(value);
  if (n === null) return null;
  return Math.max(-8, Math.min(8, Math.round(n)));
}

function buildStrengthBaseline(matches) {
  const buckets = new Map();
  matches.forEach((match) => {
    const bucket = xiBucket(match.xiRatingDifference);
    if (bucket === null) return;
    const entry = buckets.get(bucket) || { played: 0, points: 0, gd: 0 };
    entry.played += 1;
    entry.points += resultPoints(match.result);
    entry.gd += (Number(match.goalsFor) || 0) - (Number(match.goalsAgainst) || 0);
    buckets.set(bucket, entry);
  });
  return buckets;
}

function adjustedMetrics(sample, baseline) {
  const eligible = sample.filter((match) => xiBucket(match.xiRatingDifference) !== null);
  if (!eligible.length) return { adjustedPpg: null, adjustedGd: null };
  let expectedPoints = 0;
  let expectedGd = 0;
  eligible.forEach((match) => {
    const base = baseline.get(xiBucket(match.xiRatingDifference));
    if (!base?.played) return;
    expectedPoints += base.points / base.played;
    expectedGd += base.gd / base.played;
  });
  const actualPoints = eligible.reduce((sum, match) => sum + resultPoints(match.result), 0);
  const actualGd = eligible.reduce((sum, match) => sum + (Number(match.goalsFor) || 0) - (Number(match.goalsAgainst) || 0), 0);
  return {
    adjustedPpg: (actualPoints - expectedPoints) / eligible.length,
    adjustedGd: (actualGd - expectedGd) / eligible.length,
  };
}

function buildManagerStrengthBaseline(matches) {
  const managers = new Map();
  matches.forEach((match) => {
    const clubId = match.sourceClubId;
    const bucket = xiBucket(match.xiRatingDifference);
    if (!clubId || bucket === null) return;
    const key = `${clubId}|${bucket}`;
    const entry = managers.get(key) || { played: 0, points: 0, gd: 0 };
    entry.played += 1;
    entry.points += resultPoints(match.result);
    entry.gd += (Number(match.goalsFor) || 0) - (Number(match.goalsAgainst) || 0);
    managers.set(key, entry);
  });
  return managers;
}

function managerAdjustedMetrics(sample, baseline) {
  const eligible = sample.filter((match) => match.sourceClubId && xiBucket(match.xiRatingDifference) !== null);
  if (!eligible.length) return { managerAdjustedPpg: null, managerAdjustedGd: null, managerBaselineMatches: 0 };
  let expectedPoints = 0, expectedGd = 0, baselineMatches = 0;
  const usedMatches = [];
  eligible.forEach((match) => {
    const base = baseline.get(`${match.sourceClubId}|${xiBucket(match.xiRatingDifference)}`);
    if (!base?.played) return;
    expectedPoints += base.points / base.played;
    expectedGd += base.gd / base.played;
    baselineMatches += base.played;
    usedMatches.push(match);
  });
  const used = usedMatches.length;
  if (!used) return { managerAdjustedPpg: null, managerAdjustedGd: null, managerBaselineMatches: 0 };
  const actualPoints = usedMatches.reduce((sum, match) => sum + resultPoints(match.result), 0);
  const actualGd = usedMatches.reduce((sum, match) => sum + (Number(match.goalsFor) || 0) - (Number(match.goalsAgainst) || 0), 0);
  return {
    managerAdjustedPpg: (actualPoints - expectedPoints) / used,
    managerAdjustedGd: (actualGd - expectedGd) / used,
    managerBaselineMatches: baselineMatches,
  };
}

function resultPoints(result) {
  return result === 'W' ? 3 : result === 'D' ? 1 : 0;
}

const CURRENT_FORMULA_FIELDS = [
  ['Formation','formation'], ['Mentality','mentality'], ['Passing','passingStyle'],
  ['Attack','attackingStyle'], ['Tempo','tempo'], ['Press','pressing'], ['Line','defensiveLine'],
  ['Width','width'], ['Aggression','aggression'], ['Creativity','creativity'],
  ['CA','counterAttack'], ['TM','tightMarking'], ['MBB','menBehindBall'], ['SK','sweeperKeeper'],
];

function formulaText(match) {
  return CURRENT_FORMULA_FIELDS
    .map(([label, key]) => `${label}: ${displayTacticValue(key, tacticValue(match, key))}`)
    .join(' · ');
}

export default function ManagerLabPage() {
  const [matches, setMatches] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [clubId, setClubId] = useState('48506708');
  const [status, setStatus] = useState('Loading the S28 archive…');
  const [competition, setCompetition] = useState('All');
  const [context, setContext] = useState('All');
  const [strength, setStrength] = useState('All');
  const [formation, setFormation] = useState('All');
  const [mentality, setMentality] = useState('All');
  const [passing, setPassing] = useState('All');
  const [attackingStyle, setAttackingStyle] = useState('All');
  const [tempo, setTempo] = useState('All');
  const [pressing, setPressing] = useState('All');
  const [defensiveLine, setDefensiveLine] = useState('All');
  const [width, setWidth] = useState('All');
  const [aggression, setAggression] = useState('All');
  const [counterAttack, setCounterAttack] = useState('All');
  const [tightMarking, setTightMarking] = useState('All');
  const [menBehindBall, setMenBehindBall] = useState('All');
  const [sweeperKeeper, setSweeperKeeper] = useState('All');
  const [venue, setVenue] = useState('All');
  const [worldFormulaMatches, setWorldFormulaMatches] = useState([]);
  const [worldFormulaStatus, setWorldFormulaStatus] = useState('');
  const [worldFormulaStrength, setWorldFormulaStrength] = useState('Stronger opponent XI');

  useEffect(() => {
    let mounted = true;
    (async () => {
      const { data, error } = await supabase.rpc('manager_lab_clubs', { target_setup_id: SETUP_ID });
      if (!mounted) return;
      if (!error) setClubs(Array.isArray(data?.clubs) ? data.clubs : []);
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    let mounted = true;
    setStatus('Loading the S28 archive…');
    (async () => {
      const { data, error } = await supabase.rpc('manager_lab_match_summary', {
        target_setup_id: SETUP_ID,
        target_source_club_id: clubId,
      });
      if (!mounted) return;
      if (error) {
        setStatus(`Manager Lab could not load: ${error.message}`);
        return;
      }
      setMatches(Array.isArray(data?.matches) ? data.matches : []);
      setCompetition('All');
      setContext('All');
      setStrength('All');
      setFormation('All');
      setMentality('All');
      setPassing('All');
      setAttackingStyle('All');
      setTempo('All');
      setPressing('All');
      setDefensiveLine('All');
      setWidth('All');
      setAggression('All');
      setCounterAttack('All');
      setTightMarking('All');
      setMenBehindBall('All');
      setSweeperKeeper('All');
      setVenue('All');
      setStatus('');
    })();
    return () => { mounted = false; };
  }, [clubId]);

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
  const tacticOptions = (key) => ['All', ...new Set(matches.map((row) => normalizedTacticValue(row, key)).filter((value) => value !== null))];
  const formations = tacticOptions('formation');
  const mentalities = tacticOptions('mentality');
  const passings = tacticOptions('passingStyle');
  const attackingStyles = tacticOptions('attackingStyle');
  const tempos = tacticOptions('tempo');
  const pressings = tacticOptions('pressing');
  const defensiveLines = tacticOptions('defensiveLine');
  const widths = tacticOptions('width');
  const aggressions = tacticOptions('aggression');
  const counterAttacks = tacticOptions('counterAttack');
  const tightMarkings = tacticOptions('tightMarking');
  const menBehindBalls = tacticOptions('menBehindBall');
  const sweeperKeepers = tacticOptions('sweeperKeeper');
  const selectedClub = clubs.find((club) => club.sourceClubId === clubId);
  const rows = matches.filter((row) =>
    (competition === 'All' || row.competition === competition) &&
    (venue === 'All' || row.venue === venue) &&
    (context === 'All' || row.matchContext === context) &&
    (strength === 'All' || strengthBand(row) === strength) &&
    (formation === 'All' || normalizedTacticValue(row, 'formation') === formation) &&
    (mentality === 'All' || normalizedTacticValue(row, 'mentality') === mentality) &&
    (passing === 'All' || normalizedTacticValue(row, 'passingStyle') === passing) &&
    (attackingStyle === 'All' || normalizedTacticValue(row, 'attackingStyle') === attackingStyle) &&
    (tempo === 'All' || normalizedTacticValue(row, 'tempo') === tempo) &&
    (pressing === 'All' || normalizedTacticValue(row, 'pressing') === pressing) &&
    (defensiveLine === 'All' || normalizedTacticValue(row, 'defensiveLine') === defensiveLine) &&
    (width === 'All' || normalizedTacticValue(row, 'width') === width) &&
    (aggression === 'All' || normalizedTacticValue(row, 'aggression') === aggression) &&
    (counterAttack === 'All' || normalizedTacticValue(row, 'counterAttack') === counterAttack) &&
    (tightMarking === 'All' || normalizedTacticValue(row, 'tightMarking') === tightMarking) &&
    (menBehindBall === 'All' || normalizedTacticValue(row, 'menBehindBall') === menBehindBall) &&
    (sweeperKeeper === 'All' || normalizedTacticValue(row, 'sweeperKeeper') === sweeperKeeper)
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

  const leagueRows = rows.filter((row) => row.matchContext === 'League');
  const mentalityMatrix = useMemo(() => {
    const bands = ['Stronger opponent XI', 'Similar XI strength', 'Weaker opponent XI'];
    const mentalities = ['Attacking', 'Normal', 'Defensive'];
    return bands.map((band) => ({
      band,
      cells: mentalities.map((mentality) => {
        const sample = leagueRows.filter((match) =>
          strengthBand(match) === band && (tacticValue(match, 'mentality') || 'Unknown') === mentality
        );
        const samplePoints = sample.reduce((sum, match) => sum + resultPoints(match.result), 0);
        const sampleGf = sample.reduce((sum, match) => sum + (Number(match.goalsFor) || 0), 0);
        const sampleGa = sample.reduce((sum, match) => sum + (Number(match.goalsAgainst) || 0), 0);
        return {
          mentality,
          played: sample.length,
          ppg: sample.length ? samplePoints / sample.length : null,
          gdPerGame: sample.length ? (sampleGf - sampleGa) / sample.length : null,
          xiDifference: avg(sample, 'xiRatingDifference'),
        };
      }),
    }));
  }, [rows]);

  const formulaGroups = useMemo(() => {
    const map = new Map();
    rows.forEach((match) => {
      const key = tacticSignature(match);
      const group = map.get(key) || { key, sample: match, played: 0, points: 0, gf: 0, ga: 0, xi: [] };
      group.played += 1;
      group.points += resultPoints(match.result);
      group.gf += Number(match.goalsFor) || 0;
      group.ga += Number(match.goalsAgainst) || 0;
      const xi = numericValue(match.xiRatingDifference);
      if (xi !== null) group.xi.push(xi);
      map.set(key, group);
    });
    return [...map.values()].map((group) => ({
      ...group,
      ppg: group.points / group.played,
      gd: (group.gf - group.ga) / group.played,
      xiDifference: group.xi.length ? group.xi.reduce((a,b) => a+b, 0) / group.xi.length : null,
      share: rows.length ? group.played / rows.length : 0,
      confidence: group.played >= 8 ? 'Established' : group.played >= 4 ? 'Developing' : 'Exploratory',
    })).sort((a,b) => b.played - a.played || b.ppg - a.ppg);
  }, [rows]);

  const worldStrengthBaseline = useMemo(() => buildStrengthBaseline(worldFormulaMatches), [worldFormulaMatches]);
  const worldManagerBaseline = useMemo(() => buildManagerStrengthBaseline(worldFormulaMatches), [worldFormulaMatches]);

  const worldFormulaGroups = useMemo(() => {
    const filtered = worldFormulaMatches.filter((match) =>
      worldFormulaStrength === 'All' || strengthBand(match) === worldFormulaStrength
    );
    const map = new Map();
    filtered.forEach((match) => {
      const key = tacticSignature(match);
      const group = map.get(key) || {
        key, sample: match, played: 0, points: 0, gf: 0, ga: 0, xi: [], clubs: new Set(),
        home: 0, away: 0, matches: [],
      };
      group.played += 1;
      group.matches.push(match);
      group.points += resultPoints(match.result);
      group.gf += Number(match.goalsFor) || 0;
      group.ga += Number(match.goalsAgainst) || 0;
      const xi = numericValue(match.xiRatingDifference);
      if (xi !== null) group.xi.push(xi);
      if (match.sourceClubId) group.clubs.add(match.sourceClubId);
      if (match.venue === 'H') group.home += 1; else if (match.venue === 'A') group.away += 1;
      map.set(key, group);
    });
    return [...map.values()].map((group) => ({
      ...group,
      clubCount: group.clubs.size,
      ppg: group.points / group.played,
      gd: (group.gf - group.ga) / group.played,
      xiDifference: group.xi.length ? group.xi.reduce((a,b) => a+b, 0) / group.xi.length : null,
      evidence: group.played >= 12 && group.clubs.size >= 3 ? 'Broad' :
        group.played >= 6 && group.clubs.size >= 2 ? 'Developing' : 'Exploratory',
      ...adjustedMetrics(group.matches, worldStrengthBaseline),
      ...managerAdjustedMetrics(group.matches, worldManagerBaseline),
    })).sort((a,b) => b.played - a.played || b.clubCount - a.clubCount || b.ppg - a.ppg);
  }, [worldFormulaMatches, worldFormulaStrength, worldStrengthBaseline, worldManagerBaseline]);

  const worldFamilyGroups = useMemo(() => {
    const filtered = worldFormulaMatches.filter((match) =>
      worldFormulaStrength === 'All' || strengthBand(match) === worldFormulaStrength
    );
    const map = new Map();
    filtered.forEach((match) => {
      const key = tacticSignature(match, FAMILY_KEYS);
      const group = map.get(key) || { key, sample: match, matches: [], clubs: new Set() };
      group.matches.push(match);
      if (match.sourceClubId) group.clubs.add(match.sourceClubId);
      map.set(key, group);
    });
    return [...map.values()].map((group) => {
      const points = group.matches.reduce((sum, match) => sum + resultPoints(match.result), 0);
      const gd = group.matches.reduce((sum, match) => sum + (Number(match.goalsFor) || 0) - (Number(match.goalsAgainst) || 0), 0);
      const adjusted = adjustedMetrics(group.matches, worldStrengthBaseline);
      return {
        ...group,
        played: group.matches.length,
        clubCount: group.clubs.size,
        ppg: points / group.matches.length,
        gd: gd / group.matches.length,
        xiDifference: avg(group.matches, 'xiRatingDifference'),
        ...adjusted,
        ...managerAdjustedMetrics(group.matches, worldManagerBaseline),
      };
    }).sort((a,b) => b.played - a.played || b.clubCount - a.clubCount || (b.adjustedPpg ?? -99) - (a.adjustedPpg ?? -99));
  }, [worldFormulaMatches, worldFormulaStrength, worldStrengthBaseline, worldManagerBaseline]);

  const instructionEffects = useMemo(() => {
    const filtered = worldFormulaMatches.filter((match) =>
      worldFormulaStrength === 'All' || strengthBand(match) === worldFormulaStrength
    );
    const fields = CURRENT_FORMULA_FIELDS.filter(([, key]) => !FAMILY_KEYS.includes(key));
    const effects = [];
    fields.forEach(([label, key]) => {
      const controls = TACTIC_KEYS.filter((candidate) => candidate !== key);
      const strata = new Map();
      filtered.forEach((match) => {
        const value = normalizedTacticValue(match, key);
        if (value === null) return;
        const stratumKey = tacticSignature(match, controls);
        const stratum = strata.get(stratumKey) || new Map();
        const sample = stratum.get(value) || [];
        sample.push(match);
        stratum.set(value, sample);
        strata.set(stratumKey, stratum);
      });
      const pairTotals = new Map();
      strata.forEach((values) => {
        const variants = [...values.entries()];
        if (variants.length < 2) return;
        variants.forEach(([value, sample]) => {
          const alternatives = variants.filter(([other]) => other !== value).flatMap(([, rows]) => rows);
          if (!alternatives.length) return;
          const actual = sample.reduce((sum, match) => sum + resultPoints(match.result), 0) / sample.length;
          const comparison = alternatives.reduce((sum, match) => sum + resultPoints(match.result), 0) / alternatives.length;
          const id = value;
          const entry = pairTotals.get(id) || { label, key, value, strata: 0, matches: 0, weightedDelta: 0, clubs: new Set() };
          entry.strata += 1;
          entry.matches += sample.length;
          entry.weightedDelta += (actual - comparison) * sample.length;
          sample.forEach((match) => match.sourceClubId && entry.clubs.add(match.sourceClubId));
          pairTotals.set(id, entry);
        });
      });
      pairTotals.forEach((entry) => {
        if (entry.strata >= 2 && entry.matches >= 3) effects.push({
          ...entry,
          deltaPpg: entry.weightedDelta / entry.matches,
          clubCount: entry.clubs.size,
        });
      });
    });
    return effects.sort((a,b) => b.matches - a.matches || b.strata - a.strata || b.deltaPpg - a.deltaPpg).slice(0, 20);
  }, [worldFormulaMatches, worldFormulaStrength]);

  async function loadWorldFormulaLab() {
    setWorldFormulaStatus('Loading league formulas across the archived world…');
    const { data, error } = await supabase.rpc('manager_lab_formula_matches', { target_setup_id: SETUP_ID });
    if (error) {
      setWorldFormulaStatus(`Formula Lab could not load: ${error.message}`);
      return;
    }
    setWorldFormulaMatches(Array.isArray(data?.matches) ? data.matches : []);
    setWorldFormulaStatus('');
  }

  const tacticProfile = useMemo(() => {
    const keys = [
      ['Formation', 'formation'], ['Mentality', 'mentality'], ['Passing', 'passingStyle'],
      ['Attacking style', 'attackingStyle'], ['Tempo', 'tempo'], ['Pressing', 'pressing'],
      ['Defensive line', 'defensiveLine'], ['Width', 'width'], ['Aggression', 'aggression'],
      ['Creativity', 'creativity'], ['Counter attack', 'counterAttack'], ['Tight marking', 'tightMarking'],
      ['Men behind ball', 'menBehindBall'], ['Sweeper keeper', 'sweeperKeeper'],
    ];
    return keys.map(([label, key]) => {
      const counts = new Map();
      rows.forEach((match) => {
        const value = tacticValue(match, key);
        if (value !== null && value !== undefined && value !== '') counts.set(String(value), (counts.get(String(value)) || 0) + 1);
      });
      return { label, key, values: [...counts.entries()].sort((a, b) => b[1] - a[1]) };
    }).filter((item) => item.values.length);
  }, [rows]);

  return <main className="app-shell manager-lab">
    <section className="hero">
      <div className="hero-row"><div>
        <p className="eyebrow">Top 100 · Soccer Manager archive</p>
        <h1>Manager Lab</h1>
        <p>{selectedClub?.name || 'Club'}, S28. Evidence from the archived match reports — results, underlying match numbers and the tactics used.</p>
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
            <label>Club<select value={clubId} onChange={(event) => setClubId(event.target.value)}>{clubs.map((club) => <option key={club.sourceClubId} value={club.sourceClubId}>{club.name} ({club.matchCount})</option>)}</select></label>
            <label>Match context<select value={context} onChange={(event) => setContext(event.target.value)}>{contexts.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>XI strength<select value={strength} onChange={(event) => setStrength(event.target.value)}>{strengthBands.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Competition<select value={competition} onChange={(event) => setCompetition(event.target.value)}>{competitions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Venue<select value={venue} onChange={(event) => setVenue(event.target.value)}><option>All</option><option value="H">Home</option><option value="A">Away</option></select></label>
            <label>Formation<select value={formation} onChange={(event) => setFormation(event.target.value)}>{formations.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Mentality<select value={mentality} onChange={(event) => setMentality(event.target.value)}>{mentalities.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Passing<select value={passing} onChange={(event) => setPassing(event.target.value)}>{passings.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Attacking style<select value={attackingStyle} onChange={(event) => setAttackingStyle(event.target.value)}>{attackingStyles.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Tempo<select value={tempo} onChange={(event) => setTempo(event.target.value)}>{tempos.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Pressing<select value={pressing} onChange={(event) => setPressing(event.target.value)}>{pressings.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Defensive line<select value={defensiveLine} onChange={(event) => setDefensiveLine(event.target.value)}>{defensiveLines.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Width<select value={width} onChange={(event) => setWidth(event.target.value)}>{widths.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Aggression<select value={aggression} onChange={(event) => setAggression(event.target.value)}>{aggressions.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Counter attack<select value={counterAttack} onChange={(event) => setCounterAttack(event.target.value)}>{counterAttacks.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Tight marking<select value={tightMarking} onChange={(event) => setTightMarking(event.target.value)}>{tightMarkings.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Men behind ball<select value={menBehindBall} onChange={(event) => setMenBehindBall(event.target.value)}>{menBehindBalls.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label>Sweeper keeper<select value={sweeperKeeper} onChange={(event) => setSweeperKeeper(event.target.value)}>{sweeperKeepers.map((item) => <option key={item}>{item}</option>)}</select></label>
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
        <h2>Strength × mentality</h2>
        <p className="muted">Division 1 matches within the active filters. This separates opponent XI strength from opening mentality; changing a tactical filter above now changes this matrix too. Each cell shows matches played, PPG, GD/game and the average XI rating gap.</p>
        <div className="table-wrap"><table className="manager-lab-table manager-lab-matrix"><thead><tr><th>Opponent XI</th><th>Attacking</th><th>Normal</th><th>Defensive</th></tr></thead><tbody>
          {mentalityMatrix.map((row) => <tr key={row.band}><td><strong>{row.band}</strong></td>{row.cells.map((cell) => <td key={cell.mentality}>{cell.played ? <><strong>{cell.ppg.toFixed(2)} PPG</strong><small>{cell.played} MP · {cell.gdPerGame >= 0 ? '+' : ''}{cell.gdPerGame.toFixed(2)} GD/g<br />Δ XI {cell.xiDifference >= 0 ? '+' : ''}{cell.xiDifference.toFixed(1)}</small></> : <span className="muted">No matches</span>}</td>)}</tr>)}
        </tbody></table></div>
      </section>

      <section className="card">
        <h2>Winning formulas</h2>
        <p className="muted">Exact current-game opening tactical packages in the current view. Repeatability and consistency matter alongside results: Share is how often the formula was used in this view, while Evidence stops tiny samples masquerading as a magic tactic.</p>
        <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Formula</th><th>MP</th><th>Share</th><th>Evidence</th><th>PPG</th><th>GD/game</th><th>Δ XI</th></tr></thead><tbody>
          {formulaGroups.slice(0, 12).map((group) => {
            const m = group.sample;
            const formula = formulaText(m);
            return <tr key={group.key}><td><strong>{formula}</strong></td><td>{group.played}</td><td>{(group.share * 100).toFixed(0)}%</td><td>{group.confidence}</td><td>{group.ppg.toFixed(2)}</td><td>{group.gd >= 0 ? '+' : ''}{group.gd.toFixed(2)}</td><td>{group.xiDifference === null ? '—' : `${group.xiDifference >= 0 ? '+' : ''}${group.xiDifference.toFixed(1)}`}</td></tr>;
          })}
        </tbody></table></div>
      </section>

      <section className="card">
        <div className="manager-lab-toolbar">
          <div>
            <h2>Formula Lab · whole world</h2>
            <p className="muted">Division 1 evidence across every archived club, viewed from both sides of each match. This is the cross-manager test: recurring formulas become more interesting when they survive different squads and opponents.</p>
          </div>
          <div className="button-row">
            {!worldFormulaMatches.length && <button className="button secondary" type="button" onClick={loadWorldFormulaLab}>Load world evidence</button>}
          </div>
        </div>
        {worldFormulaStatus && <p className="status">{worldFormulaStatus}</p>}
        {worldFormulaMatches.length > 0 && <>
          <div className="manager-lab-filters">
            <label>Opponent XI<select value={worldFormulaStrength} onChange={(event) => setWorldFormulaStrength(event.target.value)}>{strengthBands.map((item) => <option key={item}>{item}</option>)}</select></label>
          </div>
          <p className="muted">{worldFormulaGroups.reduce((sum, group) => sum + group.played, 0)} team-match observations in this strength band. Evidence requires both repetition and use by multiple clubs; it is not a claim that a tactic causes the result.</p>
          <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Formula</th><th>MP</th><th>Clubs</th><th>Evidence</th><th>PPG</th><th>GD/game</th><th>Δ XI</th><th>Adj PPG</th><th>Mgr Adj</th><th>H/A</th></tr></thead><tbody>
            {worldFormulaGroups.slice(0, 20).map((group) => <tr key={group.key}>
              <td><strong>{formulaText(group.sample)}</strong></td>
              <td>{group.played}</td><td>{group.clubCount}</td><td>{group.evidence}</td>
              <td>{group.ppg.toFixed(2)}</td><td>{group.gd >= 0 ? '+' : ''}{group.gd.toFixed(2)}</td>
              <td>{group.xiDifference === null ? '—' : `${group.xiDifference >= 0 ? '+' : ''}${group.xiDifference.toFixed(1)}`}</td>
              <td>{group.adjustedPpg === null ? '—' : `${group.adjustedPpg >= 0 ? '+' : ''}${group.adjustedPpg.toFixed(2)}`}</td>
              <td>{group.managerAdjustedPpg === null ? '—' : `${group.managerAdjustedPpg >= 0 ? '+' : ''}${group.managerAdjustedPpg.toFixed(2)}`}</td>
              <td>{group.home}/{group.away}</td>
            </tr>)}
          </tbody></table></div>
        </>}
      </section>

      {worldFormulaMatches.length > 0 && <section className="card">
        <h2>Formula families · whole world</h2>
        <p className="muted">Core tactical identities collapse the exact formulas to formation, mentality, passing, attacking style and tempo. Adj PPG/GD compare with the Division 1 baseline at roughly the same XI-rating gap. Mgr Adj compares with that same club's own results at the same strength gap, helping separate a manager/team effect from a tactical one. Positive values beat the relevant baseline.</p>
        <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Family</th><th>MP</th><th>Clubs</th><th>PPG</th><th>GD/game</th><th>Δ XI</th><th>Adj PPG</th><th>Mgr Adj</th><th>Adj GD</th></tr></thead><tbody>
          {worldFamilyGroups.slice(0, 20).map((group) => <tr key={group.key}>
            <td><strong>{FAMILY_KEYS.map((key) => displayTacticValue(key, tacticValue(group.sample, key))).join(' · ')}</strong></td>
            <td>{group.played}</td><td>{group.clubCount}</td><td>{group.ppg.toFixed(2)}</td><td>{group.gd >= 0 ? '+' : ''}{group.gd.toFixed(2)}</td>
            <td>{group.xiDifference === null ? '—' : `${group.xiDifference >= 0 ? '+' : ''}${group.xiDifference.toFixed(1)}`}</td>
            <td>{group.adjustedPpg === null ? '—' : `${group.adjustedPpg >= 0 ? '+' : ''}${group.adjustedPpg.toFixed(2)}`}</td>
            <td>{group.managerAdjustedPpg === null ? '—' : `${group.managerAdjustedPpg >= 0 ? '+' : ''}${group.managerAdjustedPpg.toFixed(2)}`}</td>
            <td>{group.adjustedGd === null ? '—' : `${group.adjustedGd >= 0 ? '+' : ''}${group.adjustedGd.toFixed(2)}`}</td>
          </tr>)}
        </tbody></table></div>
      </section>}

      {worldFormulaMatches.length > 0 && <section className="card">
        <h2>Instruction effects · matched formulas</h2>
        <p className="muted">Near-controlled comparisons: matches are only compared when every other current tactical instruction is identical. Δ PPG is the observed difference against the alternative instruction values in those matched strata. This is evidence of association, not proof of causation.</p>
        {instructionEffects.length ? <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Instruction</th><th>Value</th><th>Matched strata</th><th>MP</th><th>Clubs</th><th>Δ PPG</th></tr></thead><tbody>
          {instructionEffects.map((effect) => <tr key={`${effect.key}:${effect.value}`}><td><strong>{effect.label}</strong></td><td>{displayTacticValue(effect.key, effect.value)}</td><td>{effect.strata}</td><td>{effect.matches}</td><td>{effect.clubCount}</td><td>{effect.deltaPpg >= 0 ? '+' : ''}{effect.deltaPpg.toFixed(2)}</td></tr>)}
        </tbody></table></div> : <p className="muted">Not enough exact near-matches yet to isolate a single instruction. More archived league matches will make this view progressively stronger.</p>}
      </section>}

      <section className="card">
        <h2>Opening tactical profile</h2>
        <p className="muted">The complete opening instruction package for the matches in the current view. Counts make it easy to spot a manager's defaults and the alternatives they actually used.</p>
        <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Instruction</th><th>Observed values</th></tr></thead><tbody>
          {tacticProfile.map((item) => <tr key={item.label}><td><strong>{item.label}</strong></td><td>{item.values.map(([value, count]) => `${displayTacticValue(item.key, value)} (${count})`).join(' · ')}</td></tr>)}
        </tbody></table></div>
      </section>

      <section className="card">
        <h2>Tactical fingerprints</h2>
        <p className="muted">Grouped by opening formation and mentality after every active filter has been applied. The tactical profile above exposes the rest of the instruction package, so identical-looking formations can be separated by passing, tempo, pressing, defensive line and other instructions.</p>
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
