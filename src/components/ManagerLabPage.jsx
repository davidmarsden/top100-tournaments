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

function indexedValues(value) {
  if (Array.isArray(value)) return value.map((item, index) => [index, item]);
  if (value && typeof value === 'object') {
    return Object.entries(value)
      .map(([index, item]) => [Number(index), item])
      .filter(([index]) => Number.isFinite(index))
      .sort((a, b) => a[0] - b[0]);
  }
  return [];
}

const PLAYER_ROLE_LABELS = {
  '0': 'None',
  '1': 'Modern Keeper',
  '2': 'Keeper',
  '3': 'Stopper',
  '4': 'General Defender',
  '5': 'Ball Playing Defender',
  '6': 'Fullback',
  '7': 'Wingback',
  '8': 'Ball-Winning Midfielder',
  '9': 'Deep Playmaker',
  '10': 'General Midfielder',
  '11': 'Box-To-Box Midfielder',
  '12': 'Play Maker',
  '13': 'Advanced Playmaker',
  '14': 'Support Striker',
  '15': 'Wide Midfielder',
  '16': 'Winger',
  '17': 'General Forward',
  '18': 'Wide Forward',
  '19': 'Finisher',
  '20': 'Deep Forward',
  '21': 'Target Man',
};

function playerRoleLabel(code) {
  return PLAYER_ROLE_LABELS[String(code)] || 'Unknown role';
}

function roleCodeValues(value) {
  // Archived match reports use two shapes here. Usually PlayerRole is wrapped
  // once by the match-engine snapshot/timeline, so the first indexed value is
  // the complete XI role vector. Older captures may store that vector directly.
  const outer = indexedValues(value);
  if (!outer.length) return [];
  const firstNested = indexedValues(outer[0][1]);
  if (firstNested.length) return firstNested;
  return outer;
}

function playerRoleEncoding(value) {
  const outer = indexedValues(value);
  if (!outer.length) return { kind: 'no-role-data', openingAssigned: 0, openingEntries: [] };

  const opening = outer[0]?.[1];
  const openingEntries = indexedValues(opening);
  if (openingEntries.length) {
    const isFullArray = Array.isArray(opening) && opening.length >= 11;
    const isSparseObject = !Array.isArray(opening) && opening && typeof opening === 'object';
    const assigned = openingEntries.filter(([, role]) =>
      role !== null && role !== undefined && role !== '' && String(role) !== '0' && typeof role !== 'object'
    ).length;
    return {
      kind: isFullArray ? 'complete-xi-timeline' : isSparseObject ? 'sparse-keyed-timeline' : 'nested-other',
      openingAssigned: assigned,
      openingEntries,
    };
  }

  const assigned = outer.filter(([, role]) =>
    role !== null && role !== undefined && role !== '' && String(role) !== '0' && typeof role !== 'object'
  ).length;
  return {
    kind: Array.isArray(value) && value.length >= 11 ? 'direct-xi' : 'direct-other',
    openingAssigned: assigned,
    openingEntries: outer,
  };
}

function playerRoleEntries(match) {
  return roleCodeValues(match?.tactics?.playerRoles)
    .filter(([, value]) => value !== null && value !== undefined && value !== '' && typeof value !== 'object')
    .map(([slot, value]) => ({ slot, code: String(value), role: playerRoleLabel(value) }));
}

const ROLE_FAMILIES = {
  keeper: new Set(['0','1','2']),
  defender: new Set(['0','3','4','5']),
  fullback: new Set(['0','6','7']),
  midfield: new Set(['0','8','9','10','11','12']),
  attacking: new Set(['0','13','14','15','16','18']),
  forward: new Set(['0','17','19','20','21']),
};

const FORMATION_4231B_SLOT_FAMILIES = [
  'keeper', 'fullback', 'fullback', 'defender', 'defender',
  'midfield', 'attacking', 'midfield', 'forward', 'attacking', 'attacking',
];

function impossible4231BRoleEntries(match) {
  // Only complete XI encodings prove that an array index is a formation slot.
  // Sparse keyed timelines are audited separately until their key semantics are
  // independently corroborated by complete-XI observations.
  const encoding = playerRoleEncoding(match?.tactics?.playerRoles);
  if (!['complete-xi-timeline', 'direct-xi'].includes(encoding.kind)) return [];
  return playerRoleEntries(match).filter(({ slot, code }) => {
    const family = FORMATION_4231B_SLOT_FAMILIES[slot];
    return family && !ROLE_FAMILIES[family]?.has(code);
  });
}

function playerRoleFingerprint(match) {
  const values = roleCodeValues(match?.tactics?.playerRoles);
  if (!values.length) return null;
  // Keep the formation-slot identity even when an archived slot is empty or
  // malformed, so distinct XI vectors can never collapse to the same key.
  return values
    .map(([slot, value]) => {
      const code = value === null || value === undefined || value === '' || typeof value === 'object'
        ? '—'
        : String(value);
      const role = code === '—' ? 'Unknown role' : playerRoleLabel(code);
      return `${slot + 1}:${code} ${role}`;
    })
    .join('|');
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
    fluidity: 'fluidity',
    forwards: 'forwards',
    widePlay: 'widePlay',
    usePlaymaker: 'usePlaymaker',
    useTargetMan: 'useTargetMan',
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
  if (['counterAttack', 'usePlaymaker', 'useTargetMan', 'tightMarking', 'menBehindBall', 'sweeperKeeper'].includes(key)) {
    if (text === '1' || text === 'true') return 'On';
    if (text === '0' || text === 'false') return 'Off';
  }
  const labels = {
    width: { '1': 'Narrow', '2': 'Normal', '3': 'Wide' },
    creativity: { '1': 'Cautious', '2': 'Disciplined', '3': 'Expressive' },
  };
  return labels[key]?.[text] || text;
}

const TACTIC_KEYS = ['formation','mentality','passingStyle','attackingStyle','tempo','pressing','defensiveLine','width','aggression','creativity','fluidity','forwards','widePlay','usePlaymaker','useTargetMan','counterAttack','tightMarking','menBehindBall','sweeperKeeper'];
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

function managerAdjustedMetrics(sample, allMatches, signatureKeys) {
  const MIN_ALTERNATIVE_MATCHES = 3;
  if (!sample.length) return { managerAdjustedPpg: null, managerAdjustedGd: null, managerBaselineMatches: 0 };
  let actualPoints = 0, actualGd = 0, expectedPoints = 0, expectedGd = 0, used = 0, baselineMatches = 0;
  sample.forEach((match) => {
    const clubId = match.sourceClubId;
    const bucket = xiBucket(match.xiRatingDifference);
    if (!clubId || bucket === null) return;
    const excludedSignature = tacticSignature(match, signatureKeys);
    const alternatives = allMatches.filter((candidate) =>
      candidate.sourceClubId === clubId &&
      xiBucket(candidate.xiRatingDifference) === bucket &&
      tacticSignature(candidate, signatureKeys) !== excludedSignature
    );
    if (alternatives.length < MIN_ALTERNATIVE_MATCHES) return;
    actualPoints += resultPoints(match.result);
    actualGd += (Number(match.goalsFor) || 0) - (Number(match.goalsAgainst) || 0);
    expectedPoints += alternatives.reduce((sum, candidate) => sum + resultPoints(candidate.result), 0) / alternatives.length;
    expectedGd += alternatives.reduce((sum, candidate) => sum + (Number(candidate.goalsFor) || 0) - (Number(candidate.goalsAgainst) || 0), 0) / alternatives.length;
    baselineMatches += alternatives.length;
    used += 1;
  });
  if (!used) return { managerAdjustedPpg: null, managerAdjustedGd: null, managerBaselineMatches: 0 };
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
  ['Fluidity','fluidity'], ['Forwards','forwards'], ['Wide play','widePlay'],
  ['Use PM','usePlaymaker'], ['Use TM','useTargetMan'],
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
  const [worldFormulaDivision, setWorldFormulaDivision] = useState('All Top 100 divisions');

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

  const worldDivisionMatches = useMemo(() => worldFormulaMatches.filter((match) =>
    worldFormulaDivision === 'All Top 100 divisions' || match.competition === worldFormulaDivision
  ), [worldFormulaMatches, worldFormulaDivision]);
  const worldStrengthBaseline = useMemo(() => buildStrengthBaseline(worldDivisionMatches), [worldDivisionMatches]);

  const worldFormulaGroups = useMemo(() => {
    const filtered = worldFormulaMatches.filter((match) =>
      (worldFormulaDivision === 'All Top 100 divisions' || match.competition === worldFormulaDivision) &&
      (worldFormulaStrength === 'All' || strengthBand(match) === worldFormulaStrength)
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
      ...managerAdjustedMetrics(group.matches, worldDivisionMatches, TACTIC_KEYS),
    })).sort((a,b) => b.played - a.played || b.clubCount - a.clubCount || b.ppg - a.ppg);
  }, [worldFormulaMatches, worldDivisionMatches, worldFormulaDivision, worldFormulaStrength, worldStrengthBaseline]);

  const worldFamilyGroups = useMemo(() => {
    const filtered = worldFormulaMatches.filter((match) =>
      (worldFormulaDivision === 'All Top 100 divisions' || match.competition === worldFormulaDivision) &&
      (worldFormulaStrength === 'All' || strengthBand(match) === worldFormulaStrength)
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
        ...managerAdjustedMetrics(group.matches, worldDivisionMatches, FAMILY_KEYS),
      };
    }).sort((a,b) => b.played - a.played || b.clubCount - a.clubCount || (b.adjustedPpg ?? -99) - (a.adjustedPpg ?? -99));
  }, [worldFormulaMatches, worldDivisionMatches, worldFormulaDivision, worldFormulaStrength, worldStrengthBaseline]);

  const crossDivisionFamilies = useMemo(() => {
    const divisions = ['Division 1', 'Division 2', 'Division 3', 'Division 4', 'Division 5'];
    const byFamily = new Map();

    divisions.forEach((division) => {
      const divisionMatches = worldFormulaMatches.filter((match) => match.competition === division);
      const baseline = buildStrengthBaseline(divisionMatches);
      const filtered = divisionMatches.filter((match) =>
        worldFormulaStrength === 'All' || strengthBand(match) === worldFormulaStrength
      );
      const groups = new Map();
      filtered.forEach((match) => {
        const key = tacticSignature(match, FAMILY_KEYS);
        const group = groups.get(key) || { key, sample: match, matches: [], clubs: new Set() };
        group.matches.push(match);
        if (match.sourceClubId) group.clubs.add(match.sourceClubId);
        groups.set(key, group);
      });
      groups.forEach((group) => {
        const adjusted = adjustedMetrics(group.matches, baseline);
        const entry = byFamily.get(group.key) || {
          key: group.key, sample: group.sample, divisions: {}, clubs: new Set(), played: 0,
        };
        group.clubs.forEach((club) => entry.clubs.add(club));
        entry.played += group.matches.length;
        entry.divisions[division] = {
          played: group.matches.length,
          adjustedPpg: adjusted.adjustedPpg,
          adjustedGd: adjusted.adjustedGd,
        };
        byFamily.set(group.key, entry);
      });
    });

    return [...byFamily.values()].map((group) => {
      const observed = Object.values(group.divisions);
      const ppgValues = observed.map((item) => item.adjustedPpg).filter((value) => value !== null);
      const gdValues = observed.map((item) => item.adjustedGd).filter((value) => value !== null);
      const adjustedPpgWeight = observed.reduce((sum, item) => sum + (item.adjustedPpg === null ? 0 : item.played), 0);
      const adjustedGdWeight = observed.reduce((sum, item) => sum + (item.adjustedGd === null ? 0 : item.played), 0);
      const weightedAdjustedPpg = adjustedPpgWeight
        ? observed.reduce((sum, item) => sum + (item.adjustedPpg ?? 0) * item.played, 0) / adjustedPpgWeight
        : null;
      const weightedAdjustedGd = adjustedGdWeight
        ? observed.reduce((sum, item) => sum + (item.adjustedGd ?? 0) * item.played, 0) / adjustedGdWeight
        : null;
      return {
        ...group,
        clubCount: group.clubs.size,
        observedDivisions: observed.length,
        positiveDivisions: ppgValues.filter((value) => value > 0).length,
        positiveGdDivisions: gdValues.filter((value) => value > 0).length,
        weightedAdjustedPpg,
        weightedAdjustedGd,
        ppgRange: ppgValues.length ? Math.max(...ppgValues) - Math.min(...ppgValues) : null,
      };
    }).sort((a, b) =>
      b.positiveDivisions - a.positiveDivisions ||
      b.observedDivisions - a.observedDivisions ||
      b.positiveGdDivisions - a.positiveGdDivisions ||
      b.clubCount - a.clubCount ||
      b.played - a.played
    );
  }, [worldFormulaMatches, worldFormulaStrength]);

  const replicatedFamily = useMemo(() =>
    crossDivisionFamilies.find((group) =>
      FAMILY_KEYS.every((key) => normalizedTacticValue(group.sample, key) === ({
        formation: '4-2-3-1 B',
        mentality: 'Attacking',
        passingStyle: 'Mixed',
        attackingStyle: 'Down Both Flanks',
        tempo: 'Fast',
      })[key])
    ) || null
  , [crossDivisionFamilies]);

  const replicatedFamilyVariants = useMemo(() => {
    if (!replicatedFamily) return [];
    const matches = worldFormulaMatches.filter((match) =>
      (worldFormulaStrength === 'All' || strengthBand(match) === worldFormulaStrength) &&
      tacticSignature(match, FAMILY_KEYS) === replicatedFamily.key
    );
    const baselineByDivision = new Map(
      ['Division 1','Division 2','Division 3','Division 4','Division 5'].map((division) => [
        division,
        buildStrengthBaseline(worldFormulaMatches.filter((match) => match.competition === division)),
      ])
    );
    const variantKeys = TACTIC_KEYS.filter((key) => !FAMILY_KEYS.includes(key));
    return variantKeys.map((key) => {
      const values = new Map();
      matches.forEach((match) => {
        const value = normalizedTacticValue(match, key);
        if (value === null) return;
        const entry = values.get(value) || { value, matches: [], clubs: new Set(), divisions: new Set() };
        entry.matches.push(match);
        if (match.sourceClubId) entry.clubs.add(match.sourceClubId);
        if (match.competition) entry.divisions.add(match.competition);
        values.set(value, entry);
      });
      const variants = [...values.values()].map((entry) => {
        let expectedPoints = 0, expectedGd = 0, actualPoints = 0, actualGd = 0, eligible = 0;
        entry.matches.forEach((match) => {
          const base = baselineByDivision.get(match.competition)?.get(xiBucket(match.xiRatingDifference));
          if (!base?.played) return;
          expectedPoints += base.points / base.played;
          expectedGd += base.gd / base.played;
          actualPoints += resultPoints(match.result);
          actualGd += (Number(match.goalsFor) || 0) - (Number(match.goalsAgainst) || 0);
          eligible += 1;
        });
        return {
          ...entry,
          played: entry.matches.length,
          clubCount: entry.clubs.size,
          divisionCount: entry.divisions.size,
          ppg: actualPoints / entry.matches.length,
          adjustedPpg: eligible ? (actualPoints - expectedPoints) / eligible : null,
          adjustedGd: eligible ? (actualGd - expectedGd) / eligible : null,
        };
      }).sort((a,b) => b.played - a.played || (b.adjustedPpg ?? -99) - (a.adjustedPpg ?? -99));
      return { key, label: CURRENT_FORMULA_FIELDS.find(([, field]) => field === key)?.[0] || key, variants };
    }).filter((row) => row.variants.length);
  }, [worldFormulaMatches, worldFormulaStrength, replicatedFamily]);

  function downloadFormulaLabJson() {
    const filteredObservations = worldFormulaMatches.filter((match) =>
      (worldFormulaDivision === 'All Top 100 divisions' || match.competition === worldFormulaDivision) &&
      (worldFormulaStrength === 'All' || strengthBand(match) === worldFormulaStrength)
    );
    // Formula Lab analyses also depend on matches outside the visible sample:
    // strength baselines use the full selected-division cohort, while cross-division
    // replication and its drill-down use the complete five-division league corpus.
    // Export that full source cohort so every derived result in this payload is reproducible.
    const sourceObservations = worldFormulaMatches;
    const cleanObservation = (match) => ({
      fixtureId: match.fixtureId ?? null,
       division: match.competition ?? null,
      clubId: match.sourceClubId ?? null,
      opponent: match.opponent ?? null,
      venue: match.venue ?? null,
      result: match.result ?? null,
      goalsFor: numericValue(match.goalsFor),
      goalsAgainst: numericValue(match.goalsAgainst),
      ourXiRating: numericValue(match.ourXiRating),
      opponentXiRating: numericValue(match.opponentXiRating),
      xiRatingDifference: numericValue(match.xiRatingDifference),
      xiStrengthBand: strengthBand(match),
      tactics: CURRENT_FORMULA_FIELDS.reduce((values, [, key]) => ({
        ...values,
        [key]: displayTacticValue(key, tacticValue(match, key)),
      }), {}),
      playerRoles: playerRoleEntries(match),
      tacticSignature: tacticSignature(match),
      familySignature: tacticSignature(match, FAMILY_KEYS),
    });
    const cleanFamily = (group) => ({
      family: FAMILY_KEYS.reduce((values, key) => ({
        ...values,
        [key]: displayTacticValue(key, tacticValue(group.sample, key)),
      }), {}),
      matchesPlayed: group.played,
      clubs: group.clubCount,
      ppg: group.ppg,
      gdPerGame: group.gd,
      xiDifference: group.xiDifference,
      adjustedPpg: group.adjustedPpg,
      managerAdjustedPpg: group.managerAdjustedPpg,
      adjustedGd: group.adjustedGd,
    });
    const cleanFormula = (group) => ({
      formula: CURRENT_FORMULA_FIELDS.reduce((values, [label, key]) => ({
        ...values,
        [key]: displayTacticValue(key, tacticValue(group.sample, key)),
      }), {}),
      formulaText: formulaText(group.sample),
      matchesPlayed: group.played,
      clubs: group.clubCount,
      evidence: group.evidence,
      ppg: group.ppg,
      gdPerGame: group.gd,
      xiDifference: group.xiDifference,
      adjustedPpg: group.adjustedPpg,
      managerAdjustedPpg: group.managerAdjustedPpg,
      home: group.home,
      away: group.away,
    });
    const payload = {
      kind: 'top100ManagerLabFormulaResults',
      version: 2,
      setupId: SETUP_ID,
      season: 'S28',
      generatedAt: new Date().toISOString(),
      filters: {
        division: worldFormulaDivision,
        opponentXi: worldFormulaStrength,
      },
      observationCount: filteredObservations.length,
      sourceObservationCount: sourceObservations.length,
      observations: filteredObservations.map(cleanObservation),
      sourceObservations: sourceObservations.map(cleanObservation),
      formulas: worldFormulaGroups.map(cleanFormula),
      families: worldFamilyGroups.map(cleanFamily),
      crossDivisionFamilies: crossDivisionFamilies.map((group) => ({
        family: FAMILY_KEYS.reduce((values, key) => ({
          ...values,
          [key]: displayTacticValue(key, tacticValue(group.sample, key)),
        }), {}),
        matchesPlayed: group.played,
        clubs: group.clubCount,
        observedDivisions: group.observedDivisions,
        positiveDivisions: group.positiveDivisions,
        positiveGdDivisions: group.positiveGdDivisions,
        weightedAdjustedPpg: group.weightedAdjustedPpg,
        weightedAdjustedGd: group.weightedAdjustedGd,
        ppgRange: group.ppgRange,
        divisions: group.divisions,
      })),
      replicatedFamilyVariants: replicatedFamilyVariants.map((row) => ({
        instruction: row.label,
        key: row.key,
        variants: row.variants.map((variant) => ({
          value: displayTacticValue(row.key, variant.value),
          matchesPlayed: variant.played,
          clubs: variant.clubCount,
          divisions: variant.divisionCount,
          ppg: variant.ppg,
          adjustedPpg: variant.adjustedPpg,
          adjustedGd: variant.adjustedGd,
        })),
      })),
      playerRoleDecoder: {
        encodingAudit: playerRoleEncodingAudit,
        validatedRoleAnalysis,
        replicatedFamily: {
          codes: replicatedFamilyRoleCodes,
          integrityIssues: replicatedFamilyRoleIntegrity,
          rawInspector: rawPlayerRoleInspector,
        },
        selectedClub: {
          sourceClubId: clubId,
          club: selectedClub?.name ?? null,
          formation: '4-2-3-1 B',
          codes: selectedClubRoleCodes,
          fingerprints: selectedClubRoleFingerprints,
        },
      },
      instructionEffects: instructionEffects.map((effect) => ({
        instruction: effect.label,
        key: effect.key,
        value: displayTacticValue(effect.key, effect.value),
        matchedStrata: effect.strata,
        matchesPlayed: effect.matches,
        clubs: effect.clubCount,
        deltaPpg: effect.deltaPpg,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const divisionSlug = worldFormulaDivision === 'All Top 100 divisions'
      ? 'all-divisions'
      : worldFormulaDivision.toLowerCase().replace(/\s+/g, '-');
    const strengthSlug = worldFormulaStrength.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    link.href = url;
    link.download = `top100-manager-lab-s28-${divisionSlug}-${strengthSlug}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  const instructionEffects = useMemo(() => {
    const filtered = worldFormulaMatches.filter((match) =>
      (worldFormulaDivision === 'All Top 100 divisions' || match.competition === worldFormulaDivision) &&
      (worldFormulaStrength === 'All' || strengthBand(match) === worldFormulaStrength)
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
  }, [worldFormulaMatches, worldFormulaDivision, worldFormulaStrength]);

  const playerRoleEncodingAudit = useMemo(() => {
    const byKind = new Map();
    const byClub = new Map();
    worldFormulaMatches.forEach((match) => {
      const encoding = playerRoleEncoding(match?.tactics?.playerRoles);
      const kind = byKind.get(encoding.kind) || { kind: encoding.kind, matches: 0, clubs: new Set(), divisions: new Set() };
      kind.matches += 1;
      if (match.sourceClubId) kind.clubs.add(match.sourceClubId);
      if (match.competition) kind.divisions.add(match.competition);
      byKind.set(encoding.kind, kind);

      const clubKey = String(match.sourceClubId ?? match.club ?? 'unknown');
      const club = byClub.get(clubKey) || {
        sourceClubId: match.sourceClubId ?? null,
        club: match.club ?? match.sourceClubName ?? clubKey,
        matches: 0,
        kinds: new Map(),
        assignedCounts: new Map(),
        sampleOpening: null,
      };
      club.matches += 1;
      club.kinds.set(encoding.kind, (club.kinds.get(encoding.kind) || 0) + 1);
      club.assignedCounts.set(encoding.openingAssigned, (club.assignedCounts.get(encoding.openingAssigned) || 0) + 1);
      if (!club.sampleOpening && encoding.kind !== 'no-role-data') {
        const rawPlayerRoles = match?.tactics?.playerRoles ?? null;
        club.sampleOpening = encoding.kind.startsWith('direct-')
          ? rawPlayerRoles
          : rawPlayerRoles?.[0] ?? rawPlayerRoles ?? null;
      }
      byClub.set(clubKey, club);
    });
    const assignmentCounts = new Map();
    worldFormulaMatches.forEach((match) => {
      const encoding = playerRoleEncoding(match?.tactics?.playerRoles);
      assignmentCounts.set(encoding.openingAssigned, (assignmentCounts.get(encoding.openingAssigned) || 0) + 1);
    });

    const sparseKeyProfiles = new Map();
    worldFormulaMatches.forEach((match) => {
      const encoding = playerRoleEncoding(match?.tactics?.playerRoles);
      if (encoding.kind !== 'sparse-keyed-timeline') return;
      encoding.openingEntries.forEach(([key, role]) => {
        if (role === null || role === undefined || role === '' || String(role) === '0' || typeof role === 'object') return;
        const profileKey = `${key}:${String(role)}`;
        const row = sparseKeyProfiles.get(profileKey) || {
          key: String(key), code: String(role), matches: 0, clubs: new Set(), formations: new Set(),
        };
        row.matches += 1;
        if (match.sourceClubId) row.clubs.add(match.sourceClubId);
        const formation = tacticValue(match, 'formation');
        if (formation) row.formations.add(formation);
        sparseKeyProfiles.set(profileKey, row);
      });
    });

    // Cross-check every raw key/code against complete-XI evidence at the same
    // formation position. This lets us distinguish a globally decoded role
    // from a sparse-only value without pretending sparse keys are proven slots.
    const positionCodeEvidence = new Map();
    worldFormulaMatches.forEach((match) => {
      const encoding = playerRoleEncoding(match?.tactics?.playerRoles);
      if (!['complete-xi-timeline', 'direct-xi', 'sparse-keyed-timeline'].includes(encoding.kind)) return;
      const formation = normalizedTacticValue(match, 'formation');
      const hasKnownFormation = Boolean(formation);
      encoding.openingEntries.forEach(([key, role]) => {
        if (role === null || role === undefined || role === '' || String(role) === '0' || typeof role === 'object') return;
        // Unknown formations must never corroborate one another: two records
        // sharing a raw key/code may come from entirely different shapes.
        // Keep them visible in the audit, but isolate each observation.
        const formationKey = hasKnownFormation
          ? formation
          : `Unknown:${match.fixtureId ?? 'fixture'}:${match.sourceClubId ?? 'club'}:${encoding.kind}`;
        const id = `${formationKey}:${key}:${String(role)}`;
        const row = positionCodeEvidence.get(id) || {
          formation: formation || 'Unknown', key: String(key), code: String(role),
          completeMatches: 0, sparseMatches: 0, clubs: new Set(), divisions: new Set(),
          formationKnown: hasKnownFormation,
        };
        if (encoding.kind === 'sparse-keyed-timeline') row.sparseMatches += 1;
        else row.completeMatches += 1;
        if (match.sourceClubId) row.clubs.add(match.sourceClubId);
        if (match.competition) row.divisions.add(match.competition);
        positionCodeEvidence.set(id, row);
      });
    });
    const positionCodeProfiles = [...positionCodeEvidence.values()].map((row) => ({
      formation: row.formation,
      key: row.key,
      apparentSlot: Number(row.key) + 1,
      code: row.code,
      role: playerRoleLabel(row.code),
      completeMatches: row.completeMatches,
      sparseMatches: row.sparseMatches,
      clubCount: row.clubs.size,
      divisionCount: row.divisions.size,
      evidence: !row.formationKnown
        ? (row.sparseMatches > 0 ? 'unknown formation · sparse' : 'unknown formation · complete XI')
        : row.completeMatches > 0
          ? (row.sparseMatches > 0 ? 'complete + sparse' : 'complete XI')
          : 'sparse only',
    })).sort((a, b) =>
      a.formation.localeCompare(b.formation) ||
      Number(a.key) - Number(b.key) ||
      b.completeMatches - a.completeMatches ||
      b.sparseMatches - a.sparseMatches ||
      Number(a.code) - Number(b.code)
    );

    const sparseOnlyProfiles = positionCodeProfiles
      .filter((row) => row.sparseMatches > 0 && row.completeMatches === 0)
      .sort((a, b) => b.sparseMatches - a.sparseMatches || b.clubCount - a.clubCount);

    return {
      positionCodeProfiles,
      sparseOnlyProfiles,
      assignmentCensus: [...assignmentCounts.entries()]
        .map(([assigned, matches]) => ({ assigned, matches, share: worldFormulaMatches.length ? matches / worldFormulaMatches.length : 0 }))
        .sort((a, b) => a.assigned - b.assigned),
      sparseKeyProfiles: [...sparseKeyProfiles.values()]
        .map((row) => ({
          key: row.key,
          code: row.code,
          role: playerRoleLabel(row.code),
          matches: row.matches,
          clubCount: row.clubs.size,
          formations: [...row.formations].sort(),
        }))
        .sort((a, b) => Number(a.key) - Number(b.key) || b.matches - a.matches || Number(a.code) - Number(b.code)),
      shapes: [...byKind.values()].map((row) => ({
        kind: row.kind,
        matches: row.matches,
        clubCount: row.clubs.size,
        divisionCount: row.divisions.size,
      })).sort((a, b) => b.matches - a.matches || a.kind.localeCompare(b.kind)),
      clubs: [...byClub.values()].map((row) => ({
        sourceClubId: row.sourceClubId,
        club: row.club,
        matches: row.matches,
        encodings: [...row.kinds.entries()].sort((a,b) => b[1] - a[1]).map(([kind, count]) => `${kind} (${count})`).join(' · '),
        assignedCounts: [...row.assignedCounts.entries()].sort((a,b) => a[0] - b[0]).map(([count, matches]) => `${count} assigned (${matches})`).join(' · '),
        sampleOpening: row.sampleOpening,
      })).sort((a, b) => {
        const aSparse = a.encodings.includes('sparse-keyed-timeline');
        const bSparse = b.encodings.includes('sparse-keyed-timeline');
        return Number(bSparse) - Number(aSparse) || a.club.localeCompare(b.club);
      }),
    };
  }, [worldFormulaMatches]);

  const replicatedFamilyRoleCodes = useMemo(() => {
    if (!replicatedFamily) return [];
    const matches = worldFormulaMatches.filter((match) =>
      (worldFormulaStrength === 'All' || strengthBand(match) === worldFormulaStrength) &&
      tacticSignature(match, FAMILY_KEYS) === replicatedFamily.key
    );
    const groups = new Map();
    matches.forEach((match) => {
      const encoding = playerRoleEncoding(match?.tactics?.playerRoles);
      if (!['complete-xi-timeline', 'direct-xi'].includes(encoding.kind)) return;
      playerRoleEntries(match).forEach(({ slot, code }) => {
        const key = `${slot}:${code}`;
        const group = groups.get(key) || { slot, code, matches: 0, clubs: new Set(), divisions: new Set() };
        group.matches += 1;
        if (match.sourceClubId) group.clubs.add(match.sourceClubId);
        if (match.competition) group.divisions.add(match.competition);
        groups.set(key, group);
      });
    });
    return [...groups.values()]
      .map((group) => ({
        slot: group.slot,
        code: group.code,
        matches: group.matches,
        clubCount: group.clubs.size,
        divisionCount: group.divisions.size,
      }))
      .sort((a, b) => a.slot - b.slot || b.matches - a.matches || a.code.localeCompare(b.code));
  }, [worldFormulaMatches, worldFormulaStrength, replicatedFamily]);

  const replicatedFamilyRoleIntegrity = useMemo(() => {
    const familyMatches = worldFormulaMatches.filter((match) =>
      (worldFormulaStrength === 'All' || strengthBand(match) === worldFormulaStrength) &&
      tacticSignature(match, FAMILY_KEYS) === '4-2-3-1 B|Attacking|Mixed|Down Both Flanks|Fast'
    );
    return familyMatches.flatMap((match) => {
      const impossible = impossible4231BRoleEntries(match);
      if (!impossible.length) return [];
      return [{
        fixtureId: match.fixtureId ?? null,
        club: match.club ?? match.sourceClubName ?? match.sourceClubId ?? 'Unknown club',
        sourceClubId: match.sourceClubId ?? null,
        division: match.competition ?? '—',
        fingerprint: playerRoleFingerprint(match),
        issues: impossible.map(({ slot, code, role }) => `Slot ${slot + 1}: ${role} (${code})`).join(' · '),
      }];
    });
  }, [worldFormulaMatches, worldFormulaStrength]);

  const rawPlayerRoleInspector = useMemo(() => {
    const suspectKeys = new Set(replicatedFamilyRoleIntegrity.map((row) => `${row.fixtureId}:${row.sourceClubId}`));
    const suspects = worldFormulaMatches
      .filter((match) => suspectKeys.has(`${match.fixtureId}:${match.sourceClubId}`))
      .map((match) => ({
        kind: 'suspect',
        fixtureId: match.fixtureId ?? null,
        club: match.club ?? match.sourceClubName ?? match.sourceClubId ?? 'Unknown club',
        sourceClubId: match.sourceClubId ?? null,
        division: match.competition ?? '—',
        date: match.date ?? null,
        opponent: match.opponent ?? match.opponentName ?? null,
        venue: match.venue ?? null,
        score: match.goalsFor !== null && match.goalsFor !== undefined && match.goalsAgainst !== null && match.goalsAgainst !== undefined
          ? `${match.goalsFor}–${match.goalsAgainst}`
          : null,
        rawPlayerRoles: match?.tactics?.playerRoles ?? null,
      }));
    const hamburg = worldFormulaMatches.find((match) =>
      String(match.sourceClubId) === '48506708' &&
      normalizedTacticValue(match, 'formation') === '4-2-3-1 B' &&
      roleCodeValues(match?.tactics?.playerRoles).length >= 11
    );
    return [
      ...suspects,
      ...(hamburg ? [{
        kind: 'known-good',
        fixtureId: hamburg.fixtureId ?? null,
        club: hamburg.club ?? hamburg.sourceClubName ?? 'Hamburger SV',
        sourceClubId: hamburg.sourceClubId ?? '48506708',
        division: hamburg.competition ?? '—',
        date: hamburg.date ?? null,
        opponent: hamburg.opponent ?? hamburg.opponentName ?? null,
        venue: hamburg.venue ?? null,
        score: hamburg.goalsFor !== null && hamburg.goalsFor !== undefined && hamburg.goalsAgainst !== null && hamburg.goalsAgainst !== undefined
          ? `${hamburg.goalsFor}–${hamburg.goalsAgainst}`
          : null,
        rawPlayerRoles: hamburg?.tactics?.playerRoles ?? null,
      }] : []),
    ];
  }, [worldFormulaMatches, replicatedFamilyRoleIntegrity]);

  const validatedRoleAnalysis = useMemo(() => {
    if (!worldFormulaMatches.length || !playerRoleEncodingAudit?.positionCodeProfiles?.length) return { assignments: [], anomalies: [], severity: [], clubs: [], switchers: [], persistence: [], roleQuarantine: [], roleSwitchExperiments: [] };
    const corroborated = new Set(playerRoleEncodingAudit.positionCodeProfiles.filter((r) => r.completeMatches > 0).map((r) => `${r.formation}:${r.key}:${r.code}`));
    const observations = worldFormulaMatches.map((match) => {
      const encoding = playerRoleEncoding(match?.tactics?.playerRoles);
      const formation = normalizedTacticValue(match, 'formation');
      let anomalous = 0;
      const assignments = [];
      if (formation && ['complete-xi-timeline', 'direct-xi', 'sparse-keyed-timeline'].includes(encoding.kind)) {
        encoding.openingEntries.forEach(([key, rawCode]) => {
          const code = String(rawCode ?? '');
          if (!code || code === '0' || typeof rawCode === 'object') return;
          const complete = encoding.kind !== 'sparse-keyed-timeline';
          const validated = complete || corroborated.has(`${formation}:${key}:${code}`);
          if (!validated) anomalous += 1;
          assignments.push({ key: String(key), code, role: playerRoleLabel(code), validated, complete });
        });
      }
      const analyzable = Boolean(formation) &&
        ['complete-xi-timeline', 'direct-xi', 'sparse-keyed-timeline'].includes(encoding.kind) &&
        assignments.length > 0;
      return { match, formation, anomalous, assignments, analyzable };
    });
    const analyzableObservations = observations.filter((row) => row.analyzable);
    const metric = (rows) => {
      if (!rows.length) return { matches: 0, ppg: null, gd: null, winRate: null };
      const pts = rows.map((r) => resultPoints(r.match.result));
      return { matches: rows.length, ppg: pts.reduce((a,b)=>a+b,0)/rows.length, gd: rows.reduce((s,r)=>s+(Number(r.match.goalsFor)-Number(r.match.goalsAgainst)),0)/rows.length, winRate: pts.filter((p)=>p===3).length/rows.length };
    };
    const allClubMap = new Map();
    analyzableObservations.forEach((r) => {
      const id = String(r.match.sourceClubId || r.match.club || 'unknown');
      const x = allClubMap.get(id) || { sourceClubId: r.match.sourceClubId, club: r.match.club || id, clean: [], anomalous: [] };
      (r.anomalous ? x.anomalous : x.clean).push(r);
      allClubMap.set(id, x);
    });
    const allClubs = [...allClubMap.values()].filter((x) => x.anomalous.length);
    const quarantinedClubIds = new Set(allClubs.filter((club) => {
      const total = club.clean.length + club.anomalous.length;
      return total > 0 && club.anomalous.length / total >= 0.8;
    }).map((club) => String(club.sourceClubId || club.club || 'unknown')));
    const roleObservations = analyzableObservations.filter((row) =>
      !quarantinedClubIds.has(String(row.match.sourceClubId || row.match.club || 'unknown'))
    );

    const sev = new Map();
    roleObservations.forEach((r) => { const k=r.anomalous>=4?'4+':String(r.anomalous); if(!sev.has(k)) sev.set(k,[]); sev.get(k).push(r); });
    const severity=[...sev].map(([anomalies,rows])=>({anomalies,...metric(rows)})).sort((a,b)=>(a.anomalies==='4+'?99:+a.anomalies)-(b.anomalies==='4+'?99:+b.anomalies));
    const cm=new Map();
    roleObservations.forEach((r)=>{const id=String(r.match.sourceClubId||r.match.club||'unknown');const x=cm.get(id)||{sourceClubId:r.match.sourceClubId,club:r.match.club||id,clean:[],anomalous:[]};(r.anomalous?x.anomalous:x.clean).push(r);cm.set(id,x);});
    const clubs=[...cm.values()].filter((x)=>x.anomalous.length).map((x)=>({...x,cleanMetrics:metric(x.clean),anomalyMetrics:metric(x.anomalous)})).sort((a,b)=>b.anomalous.length-a.anomalous.length);
    const build=(wantValidated)=>{
      const m=new Map();
      roleObservations.forEach((r)=>r.assignments.filter((a)=>a.validated===wantValidated).forEach((a)=>{const id=`${r.formation}:${a.key}:${a.code}`;const x=m.get(id)||{formation:r.formation,key:a.key,code:a.code,role:a.role,rows:[],clubs:new Set(),complete:0,sparse:0};x.rows.push(r);if(r.match.sourceClubId)x.clubs.add(r.match.sourceClubId);if(a.complete)x.complete++;else x.sparse++;m.set(id,x);}));
      return [...m.values()].map((x)=>({formation:x.formation,key:x.key,code:x.code,role:x.role,clubCount:x.clubs.size,complete:x.complete,sparse:x.sparse,...metric(x.rows)})).sort((a,b)=>b.matches-a.matches);
    };
    // Club-level natural experiments are more informative than pooling clubs
    // with permanently different serialisation patterns. Compare only clubs
    // that have both clean and anomalous observations, and report the raw
    // within-club delta alongside XI-strength-adjusted deltas.
    const switchers = clubs
      .filter((club) => club.clean.length >= 2 && club.anomalous.length >= 2)
      .map((club) => {
        const cleanMetrics = metric(club.clean);
        const anomalyMetrics = metric(club.anomalous);
        const cleanMatches = club.clean.map((row) => row.match);
        const anomalyMatches = club.anomalous.map((row) => row.match);
        const cleanBuckets = new Set(cleanMatches.map((match) => xiBucket(match.xiRatingDifference)).filter((bucket) => bucket !== null));
        const anomalyBuckets = new Set(anomalyMatches.map((match) => xiBucket(match.xiRatingDifference)).filter((bucket) => bucket !== null));
        const commonBuckets = new Set([...cleanBuckets].filter((bucket) => anomalyBuckets.has(bucket)));
        const comparableClean = cleanMatches.filter((match) => commonBuckets.has(xiBucket(match.xiRatingDifference)));
        const comparableAnomaly = anomalyMatches.filter((match) => commonBuckets.has(xiBucket(match.xiRatingDifference)));
        const clubBaseline = buildStrengthBaseline([...comparableClean, ...comparableAnomaly]);
        const cleanAdjusted = commonBuckets.size ? adjustedMetrics(comparableClean, clubBaseline) : { adjustedPpg: null, adjustedGd: null };
        const anomalyAdjusted = commonBuckets.size ? adjustedMetrics(comparableAnomaly, clubBaseline) : { adjustedPpg: null, adjustedGd: null };
        return {
          sourceClubId: club.sourceClubId,
          club: club.club,
          cleanMetrics,
          anomalyMetrics,
          deltaPpg: anomalyMetrics.ppg - cleanMetrics.ppg,
          deltaGd: anomalyMetrics.gd - cleanMetrics.gd,
          adjustedDeltaPpg: anomalyAdjusted.adjustedPpg === null || cleanAdjusted.adjustedPpg === null
            ? null : anomalyAdjusted.adjustedPpg - cleanAdjusted.adjustedPpg,
          adjustedDeltaGd: anomalyAdjusted.adjustedGd === null || cleanAdjusted.adjustedGd === null
            ? null : anomalyAdjusted.adjustedGd - cleanAdjusted.adjustedGd,
          commonXiBuckets: commonBuckets.size,
          comparableCleanMatches: comparableClean.length,
          comparableAnomalyMatches: comparableAnomaly.length,
        };
      })
      .sort((a,b) => (a.adjustedDeltaPpg ?? a.deltaPpg) - (b.adjustedDeltaPpg ?? b.deltaPpg));

    // Persistence separates a stable club-specific encoding from a genuine
    // within-season change. A combination seen in nearly every analyzable
    // match for one club is a serialisation convention candidate, even when
    // it has no complete-XI corroboration elsewhere.
    const persistenceMap = new Map();
    analyzableObservations.forEach((row) => {
      const clubId = String(row.match.sourceClubId || row.match.club || 'unknown');
      row.assignments.forEach((assignment) => {
        const id = `${clubId}:${row.formation}:${assignment.key}:${assignment.code}`;
        const entry = persistenceMap.get(id) || {
          sourceClubId: row.match.sourceClubId ?? null,
          club: row.match.club || clubId,
          formation: row.formation,
          key: assignment.key,
          code: assignment.code,
          role: assignment.role,
          validated: assignment.validated,
          matches: 0,
          fixtures: new Set(),
        };
        entry.matches += 1;
        if (row.match.fixtureId) entry.fixtures.add(String(row.match.fixtureId));
        persistenceMap.set(id, entry);
      });
    });
    const clubTotals = new Map();
    analyzableObservations.forEach((row) => {
      const id = String(row.match.sourceClubId || row.match.club || 'unknown');
      clubTotals.set(id, (clubTotals.get(id) || 0) + 1);
    });
    const persistence = [...persistenceMap.values()].map((entry) => {
      const clubId = String(entry.sourceClubId || entry.club || 'unknown');
      const clubMatches = clubTotals.get(clubId) || 0;
      const share = clubMatches ? entry.matches / clubMatches : 0;
      return {
        ...entry,
        fixtures: [...entry.fixtures],
        clubMatches,
        share,
        classification: share >= 0.8 && entry.matches >= 4
          ? 'stable club encoding'
          : share <= 0.2
            ? 'occasional/change candidate'
            : 'variable',
      };
    }).sort((a,b) => Number(a.validated) - Number(b.validated) || b.share - a.share || b.matches - a.matches);

    // Keep unresolved role encodings out of role-dependent conclusions. Do
    // not discard these clubs from ordinary Formula Lab analyses: the anomaly
    // is currently isolated to PlayerRole serialisation, while the other
    // tactical fields remain independently readable.
    const roleQuarantine = allClubs
      .map((club) => {
        const total = club.clean.length + club.anomalous.length;
        const anomalyShare = total ? club.anomalous.length / total : 0;
        return {
          sourceClubId: club.sourceClubId,
          club: club.club,
          matches: total,
          anomalousMatches: club.anomalous.length,
          anomalyShare,
          roleAnalysisEligible: anomalyShare < 0.8,
          reason: anomalyShare >= 0.8
            ? 'stable unresolved PlayerRole encoding'
            : 'mixed/mostly corroborated PlayerRole encoding',
        };
      })
      .sort((a,b) => b.anomalyShare - a.anomalyShare || b.matches - a.matches);

    // Compare genuine, validated role switches within the same club, formation and
    // formation slot. A switch is eligible only when both role codes are decoded
    // by complete-XI evidence (directly or by sparse corroboration). This avoids
    // feeding quarantined serialisation artefacts back into football conclusions.
    const validatedSwitchMap = new Map();
    roleObservations.forEach((row) => {
      row.assignments.filter((assignment) => assignment.validated).forEach((assignment) => {
        const clubId = String(row.match.sourceClubId || row.match.club || 'unknown');
        const id = `${clubId}:${row.formation}:${assignment.key}`;
        const entry = validatedSwitchMap.get(id) || {
          sourceClubId: row.match.sourceClubId ?? null,
          club: row.match.club || clubId,
          formation: row.formation,
          key: assignment.key,
          roles: new Map(),
        };
        const role = entry.roles.get(assignment.code) || {
          code: assignment.code,
          role: assignment.role,
          rows: [],
        };
        role.rows.push(row);
        entry.roles.set(assignment.code, role);
        validatedSwitchMap.set(id, entry);
      });
    });

    const roleSwitchExperiments = [];
    validatedSwitchMap.forEach((entry) => {
      const variants = [...entry.roles.values()].filter((variant) => variant.rows.length >= 2);
      if (variants.length < 2) return;
      for (let i = 0; i < variants.length - 1; i += 1) {
        for (let j = i + 1; j < variants.length; j += 1) {
          const a = variants[i];
          const b = variants[j];
          const aMatches = a.rows.map((row) => row.match);
          const bMatches = b.rows.map((row) => row.match);
          const aBuckets = new Set(aMatches.map((match) => xiBucket(match.xiRatingDifference)).filter((bucket) => bucket !== null));
          const bBuckets = new Set(bMatches.map((match) => xiBucket(match.xiRatingDifference)).filter((bucket) => bucket !== null));
          const commonBuckets = new Set([...aBuckets].filter((bucket) => bBuckets.has(bucket)));
          const comparableA = aMatches.filter((match) => commonBuckets.has(xiBucket(match.xiRatingDifference)));
          const comparableB = bMatches.filter((match) => commonBuckets.has(xiBucket(match.xiRatingDifference)));
          if (!commonBuckets.size || comparableA.length < 2 || comparableB.length < 2) continue;
          // Estimate the role contrast inside each shared XI bucket first,
          // then aggregate those within-bucket B-vs-A differences. Building a
          // baseline from the pooled A/B cohorts would partially absorb the
          // role effect whenever the role mix differs by strength bucket.
          let weightedPpgDelta = 0;
          let weightedGdDelta = 0;
          let comparisonWeight = 0;
          commonBuckets.forEach((bucket) => {
            const bucketA = comparableA.filter((match) => xiBucket(match.xiRatingDifference) === bucket);
            const bucketB = comparableB.filter((match) => xiBucket(match.xiRatingDifference) === bucket);
            if (!bucketA.length || !bucketB.length) return;
            const ppgA = bucketA.reduce((sum, match) => sum + resultPoints(match.result), 0) / bucketA.length;
            const ppgB = bucketB.reduce((sum, match) => sum + resultPoints(match.result), 0) / bucketB.length;
            const gdA = bucketA.reduce((sum, match) => sum + (Number(match.goalsFor) || 0) - (Number(match.goalsAgainst) || 0), 0) / bucketA.length;
            const gdB = bucketB.reduce((sum, match) => sum + (Number(match.goalsFor) || 0) - (Number(match.goalsAgainst) || 0), 0) / bucketB.length;
            // Harmonic-style overlap weight gives most influence to buckets
            // where both roles have evidence, without letting a one-sided
            // bucket dominate merely because one role was used much more.
            const weight = (2 * bucketA.length * bucketB.length) / (bucketA.length + bucketB.length);
            weightedPpgDelta += (ppgB - ppgA) * weight;
            weightedGdDelta += (gdB - gdA) * weight;
            comparisonWeight += weight;
          });
          const aMetrics = metric(a.rows);
          const bMetrics = metric(b.rows);
          // Separate a genuinely isolated role change from a coordinated role
          // package or a broader tactical rewrite. The strictest comparison
          // holds XI bucket, every non-role tactical instruction and every
          // other validated PlayerRole assignment constant.
          const rowContext = (row) => {
            const encoding = playerRoleEncoding(row.match?.tactics?.playerRoles);
            const tacticValues = TACTIC_KEYS.map((key) => normalizedTacticValue(row.match, key));
            const completeTactics = tacticValues.every((value) => value !== null);
            const completeRoles = ['complete-xi-timeline', 'direct-xi'].includes(encoding.kind) &&
              encoding.openingEntries.length >= 11 &&
              row.assignments.every((assignment) => assignment.validated);
            return {
              xi: xiBucket(row.match.xiRatingDifference),
              tactics: completeTactics ? tacticValues.join('|') : null,
              otherRoles: completeRoles
                ? row.assignments
                    .filter((assignment) => assignment.key !== entry.key)
                    .map((assignment) => `${assignment.key}:${assignment.code}`)
                    .sort()
                    .join('|')
                : null,
              completeTactics,
              completeRoles,
            };
          };
          const contextGroups = (rows, keyFor) => {
            const groups = new Map();
            rows.forEach((row) => {
              const context = rowContext(row);
              if (context.xi === null) return;
              const key = keyFor(context);
              const group = groups.get(key) || [];
              group.push(row.match);
              groups.set(key, group);
            });
            return groups;
          };
          const overlap = (rowsA, rowsB, keyFor) => {
            const groupsA = contextGroups(rowsA, keyFor);
            const groupsB = contextGroups(rowsB, keyFor);
            const keys = [...groupsA.keys()].filter((key) => groupsB.has(key));
            return {
              strata: keys.length,
              matchesA: keys.flatMap((key) => groupsA.get(key)),
              matchesB: keys.flatMap((key) => groupsB.get(key)),
              groupsA,
              groupsB,
              keys,
            };
          };
          const matchedDelta = (overlapResult) => {
            let ppgDelta = 0, gdDelta = 0, weightTotal = 0;
            overlapResult.keys.forEach((key) => {
              const rowsA = overlapResult.groupsA.get(key) || [];
              const rowsB = overlapResult.groupsB.get(key) || [];
              if (!rowsA.length || !rowsB.length) return;
              const ppgA = rowsA.reduce((sum, match) => sum + resultPoints(match.result), 0) / rowsA.length;
              const ppgB = rowsB.reduce((sum, match) => sum + resultPoints(match.result), 0) / rowsB.length;
              const gdA = rowsA.reduce((sum, match) => sum + (Number(match.goalsFor) || 0) - (Number(match.goalsAgainst) || 0), 0) / rowsA.length;
              const gdB = rowsB.reduce((sum, match) => sum + (Number(match.goalsFor) || 0) - (Number(match.goalsAgainst) || 0), 0) / rowsB.length;
              const weight = (2 * rowsA.length * rowsB.length) / (rowsA.length + rowsB.length);
              ppgDelta += (ppgB - ppgA) * weight;
              gdDelta += (gdB - gdA) * weight;
              weightTotal += weight;
            });
            return {
              ppg: weightTotal ? ppgDelta / weightTotal : null,
              gd: weightTotal ? gdDelta / weightTotal : null,
            };
          };
          const isolatedRowsA = a.rows.filter((row) => {
            const context = rowContext(row);
            return context.completeTactics && context.completeRoles;
          });
          const isolatedRowsB = b.rows.filter((row) => {
            const context = rowContext(row);
            return context.completeTactics && context.completeRoles;
          });
          const tacticRowsA = a.rows.filter((row) => rowContext(row).completeTactics);
          const tacticRowsB = b.rows.filter((row) => rowContext(row).completeTactics);
          const isolated = overlap(isolatedRowsA, isolatedRowsB, (context) => `${context.xi}|${context.tactics}|${context.otherRoles}`);
          const sameTactics = overlap(tacticRowsA, tacticRowsB, (context) => `${context.xi}|${context.tactics}`);
          const isolatedDelta = matchedDelta(isolated);
          const tacticMatchedDelta = matchedDelta(sameTactics);
          const isolationClass = isolated.matchesA.length >= 2 && isolated.matchesB.length >= 2
            ? 'isolated role change'
            : sameTactics.matchesA.length >= 2 && sameTactics.matchesB.length >= 2
              ? 'coordinated role package'
              : 'broader tactical change';
          roleSwitchExperiments.push({
            sourceClubId: entry.sourceClubId,
            club: entry.club,
            formation: entry.formation,
            slot: Number(entry.key) + 1,
            roleA: a.role,
            codeA: a.code,
            matchesA: a.rows.length,
            ppgA: aMetrics.ppg,
            gdA: aMetrics.gd,
            roleB: b.role,
            codeB: b.code,
            matchesB: b.rows.length,
            ppgB: bMetrics.ppg,
            gdB: bMetrics.gd,
            deltaPpgBvsA: bMetrics.ppg - aMetrics.ppg,
            deltaGdBvsA: bMetrics.gd - aMetrics.gd,
            adjustedDeltaPpgBvsA: comparisonWeight ? weightedPpgDelta / comparisonWeight : null,
            adjustedDeltaGdBvsA: comparisonWeight ? weightedGdDelta / comparisonWeight : null,
            commonXiBuckets: commonBuckets.size,
            comparableMatchesA: comparableA.length,
            comparableMatchesB: comparableB.length,
            isolationClass,
            isolatedStrata: isolated.strata,
            isolatedMatchesA: isolated.matchesA.length,
            isolatedMatchesB: isolated.matchesB.length,
            isolatedDeltaPpgBvsA: isolatedDelta.ppg,
            isolatedDeltaGdBvsA: isolatedDelta.gd,
            tacticMatchedStrata: sameTactics.strata,
            tacticMatchedMatchesA: sameTactics.matchesA.length,
            tacticMatchedMatchesB: sameTactics.matchesB.length,
            tacticMatchedDeltaPpgBvsA: tacticMatchedDelta.ppg,
            tacticMatchedDeltaGdBvsA: tacticMatchedDelta.gd,
          });
        }
      }
    });
    roleSwitchExperiments.sort((a, b) =>
      (b.comparableMatchesA + b.comparableMatchesB) - (a.comparableMatchesA + a.comparableMatchesB) ||
      Math.abs(b.adjustedDeltaPpgBvsA ?? 0) - Math.abs(a.adjustedDeltaPpgBvsA ?? 0)
    );

    return { assignments: build(true), anomalies: build(false), severity, clubs, switchers, persistence, roleQuarantine, roleSwitchExperiments };
  }, [worldFormulaMatches, playerRoleEncodingAudit]);

  const selectedClubRoleCodes = useMemo(() => {
    const roleMatches = matches.filter((match) => normalizedTacticValue(match, 'formation') === '4-2-3-1 B');
    const groups = new Map();
    roleMatches.forEach((match) => {
      playerRoleEntries(match).forEach(({ slot, code }) => {
        const key = `${slot}:${code}`;
        const group = groups.get(key) || { slot, code, matches: 0 };
        group.matches += 1;
        groups.set(key, group);
      });
    });
    return [...groups.values()].sort((a, b) => a.slot - b.slot || b.matches - a.matches || a.code.localeCompare(b.code));
  }, [matches]);

  const selectedClubRoleFingerprints = useMemo(() => {
    const groups = new Map();
    matches
      .filter((match) => normalizedTacticValue(match, 'formation') === '4-2-3-1 B')
      .forEach((match) => {
        const fingerprint = playerRoleFingerprint(match);
        if (fingerprint) groups.set(fingerprint, (groups.get(fingerprint) || 0) + 1);
      });
    return [...groups.entries()]
      .map(([fingerprint, matchesPlayed]) => ({ fingerprint, matchesPlayed }))
      .sort((a, b) => b.matchesPlayed - a.matchesPlayed || a.fingerprint.localeCompare(b.fingerprint));
  }, [matches]);

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
            <h2>Formula Lab · {worldFormulaDivision}</h2>
            <p className="muted">League evidence across all five Top 100 divisions, viewed from both sides of each match. Use the division filter to test whether a formula survives different competitive levels, squads and opponents.</p>
          </div>
          <div className="button-row">
            {!worldFormulaMatches.length && <button className="button secondary" type="button" onClick={loadWorldFormulaLab}>Load world evidence</button>}
            {worldFormulaMatches.length > 0 && <button className="button secondary" type="button" onClick={downloadFormulaLabJson}>Download JSON results</button>}
          </div>
        </div>
        {worldFormulaStatus && <p className="status">{worldFormulaStatus}</p>}
        {worldFormulaMatches.length > 0 && <>
          <div className="manager-lab-filters">
            <label>Division<select value={worldFormulaDivision} onChange={(event) => setWorldFormulaDivision(event.target.value)}><option>All Top 100 divisions</option><option>Division 1</option><option>Division 2</option><option>Division 3</option><option>Division 4</option><option>Division 5</option></select></label>
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
        <h2>Cross-division replication · {worldFormulaStrength}</h2>
        <p className="muted">The same core tactical family compared independently in Divisions 1–5. Each division cell shows matches played and strength-adjusted PPG. “Positive” counts only divisions where that family beat the XI-strength baseline; missing divisions are shown as — rather than treated as failures.</p>
        <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Family</th><th>D1</th><th>D2</th><th>D3</th><th>D4</th><th>D5</th><th>MP</th><th>Clubs</th><th>Positive PPG</th><th>Positive GD</th><th>Weighted Adj</th></tr></thead><tbody>
          {crossDivisionFamilies.slice(0, 30).map((group) => <tr key={group.key}>
            <td><strong>{FAMILY_KEYS.map((key) => displayTacticValue(key, tacticValue(group.sample, key))).join(' · ')}</strong></td>
            {['Division 1','Division 2','Division 3','Division 4','Division 5'].map((division) => {
              const cell = group.divisions[division];
              return <td key={division}>{cell ? <>{cell.played} MP<br /><small>{cell.adjustedPpg === null ? '—' : `${cell.adjustedPpg >= 0 ? '+' : ''}${cell.adjustedPpg.toFixed(2)} Adj`}</small></> : '—'}</td>;
            })}
            <td>{group.played}</td><td>{group.clubCount}</td><td>{group.positiveDivisions}/{group.observedDivisions}</td>
            <td>{group.positiveGdDivisions}/{group.observedDivisions}</td>
            <td>{group.weightedAdjustedPpg === null ? '—' : <>{group.weightedAdjustedPpg >= 0 ? '+' : ''}{group.weightedAdjustedPpg.toFixed(2)} PPG<br /><small>{group.weightedAdjustedGd === null ? '—' : `${group.weightedAdjustedGd >= 0 ? '+' : ''}${group.weightedAdjustedGd.toFixed(2)} GD`}</small></>}</td>
          </tr>)}
        </tbody></table></div>
      </section>}

      {worldFormulaMatches.length > 0 && <section className="card">
        <h2>PlayerRole encoding audit · whole world</h2>
        <p className="muted">Opponent player roles are the one tactical choice Soccer Manager does not expose in the match report UI, so this treats the archived representation as evidence rather than assuming every shape is an XI. “Assigned” counts non-zero values in the opening archived state; sparse keyed timelines may represent managers who only assigned some roles, but that remains a hypothesis until independently verified.</p>
        <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Encoding</th><th>MP</th><th>Clubs</th><th>Divisions</th></tr></thead><tbody>
          {playerRoleEncodingAudit.shapes.map((row) => <tr key={row.kind}><td><strong>{row.kind}</strong></td><td>{row.matches}</td><td>{row.clubCount}</td><td>{row.divisionCount}</td></tr>)}
        </tbody></table></div>
        <h3>Opening role-assignment census</h3>
        <p className="muted">How many non-zero PlayerRole values are present in each opening archived state. This is an apparent assignment count, not yet proof that sparse keys are formation slots.</p>
        <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Assigned roles</th><th>Observations</th><th>Share</th></tr></thead><tbody>
          {playerRoleEncodingAudit.assignmentCensus.map((row) => <tr key={row.assigned}><td><strong>{row.assigned}</strong></td><td>{row.matches}</td><td>{(row.share * 100).toFixed(1)}%</td></tr>)}
        </tbody></table></div>
        <details>
          <summary><strong>Sparse key × role census</strong> · test whether sparse keys behave like formation slots</summary>
          <p className="muted">For sparse keyed timelines only. Repeated role codes at keys where that role would be positionally impossible are evidence that the sparse keys have different semantics and should not be decoded as formation slots.</p>
          <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Raw key</th><th>Role</th><th>Code</th><th>MP</th><th>Clubs</th><th>Formations</th></tr></thead><tbody>
            {playerRoleEncodingAudit.sparseKeyProfiles.map((row) => <tr key={`${row.key}:${row.code}`}><td><strong>{row.key}</strong></td><td>{row.role}</td><td><code>{row.code}</code></td><td>{row.matches}</td><td>{row.clubCount}</td><td>{row.formations.join(', ') || '—'}</td></tr>)}
          </tbody></table></div>
        </details>
        <details open>
          <summary><strong>Position × raw-code decoder</strong> · complete XI corroboration for sparse values</summary>
          <p className="muted">For each formation and raw key, this compares sparse observations with complete-XI observations carrying the same code at the same index. “Complete + sparse” is strong evidence that the sparse key behaves like that formation position. “Sparse only” is unresolved: the familiar role label is shown as a hypothesis, not treated as a decoded formation-slot assignment.</p>
          <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Formation</th><th>Raw key</th><th>Apparent slot</th><th>Raw code</th><th>Candidate role</th><th>Complete XI</th><th>Sparse</th><th>Clubs</th><th>Evidence</th></tr></thead><tbody>
            {playerRoleEncodingAudit.positionCodeProfiles.map((row) => <tr key={`${row.formation}:${row.key}:${row.code}`}><td><strong>{row.formation}</strong></td><td><code>{row.key}</code></td><td>{row.apparentSlot}</td><td><code>{row.code}</code></td><td>{row.role}</td><td>{row.completeMatches}</td><td>{row.sparseMatches}</td><td>{row.clubCount}</td><td>{row.evidence}</td></tr>)}
          </tbody></table></div>
          <h4>Unresolved sparse-only combinations</h4>
          <p className="muted">These combinations occur in sparse records but have no complete-XI observation at the same formation/index/code in the current corpus. They are leads for decoding, not integrity failures.</p>
          <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Formation</th><th>Raw key</th><th>Raw code</th><th>Candidate role</th><th>MP</th><th>Clubs</th><th>Divisions</th></tr></thead><tbody>
            {playerRoleEncodingAudit.sparseOnlyProfiles.map((row) => <tr key={`unresolved:${row.formation}:${row.key}:${row.code}`}><td><strong>{row.formation}</strong></td><td><code>{row.key}</code></td><td><code>{row.code}</code></td><td>{row.role}</td><td>{row.sparseMatches}</td><td>{row.clubCount}</td><td>{row.divisionCount}</td></tr>)}
          </tbody></table></div>
        </details>
        <details>
          <summary><strong>Club-by-club role encoding</strong> · {playerRoleEncodingAudit.clubs.length} clubs</summary>
          <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Club</th><th>MP</th><th>Encoding shapes</th><th>Opening non-zero values</th><th>Sample opening raw state</th></tr></thead><tbody>
            {playerRoleEncodingAudit.clubs.map((row) => <tr key={row.sourceClubId || row.club}><td><strong>{row.club}</strong><br /><small>{row.sourceClubId || '—'}</small></td><td>{row.matches}</td><td>{row.encodings}</td><td>{row.assignedCounts}</td><td><code>{row.sampleOpening === null ? '—' : JSON.stringify(row.sampleOpening)}</code></td></tr>)}
          </tbody></table></div>
        </details>
      </section>}

      {worldFormulaMatches.length > 0 && <section className="card">
        <h2>Player Role validation & anomaly performance</h2>
        <p className="muted">Complete-XI assignments are trusted. Sparse assignments are validated only when the same formation, raw key and role code is corroborated by complete-XI evidence. Sparse-only combinations are quarantined as anomalies. Outcomes below are descriptive associations, not proof that an anomalous encoding affected the match engine.</p>
        <h3>Anomaly severity</h3>
        <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Anomalies / XI</th><th>MP</th><th>PPG</th><th>GD/game</th><th>Win %</th></tr></thead><tbody>
          {validatedRoleAnalysis.severity.map((r)=><tr key={r.anomalies}><td><strong>{r.anomalies}</strong></td><td>{r.matches}</td><td>{r.ppg===null?'—':r.ppg.toFixed(2)}</td><td>{r.gd===null?'—':`${r.gd>=0?'+':''}${r.gd.toFixed(2)}`}</td><td>{r.winRate===null?'—':`${(r.winRate*100).toFixed(1)}%`}</td></tr>)}
        </tbody></table></div>
        <details><summary><strong>Clubs with anomalous role encodings</strong> · {validatedRoleAnalysis.clubs.length}</summary>
          <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Club</th><th>Anom MP</th><th>Anom PPG</th><th>Anom GD</th><th>Clean MP</th><th>Clean PPG</th><th>Clean GD</th></tr></thead><tbody>
            {validatedRoleAnalysis.clubs.map((r)=><tr key={r.sourceClubId||r.club}><td><strong>{r.club}</strong></td><td>{r.anomalyMetrics.matches}</td><td>{r.anomalyMetrics.ppg===null?'—':r.anomalyMetrics.ppg.toFixed(2)}</td><td>{r.anomalyMetrics.gd===null?'—':r.anomalyMetrics.gd.toFixed(2)}</td><td>{r.cleanMetrics.matches}</td><td>{r.cleanMetrics.ppg===null?'—':r.cleanMetrics.ppg.toFixed(2)}</td><td>{r.cleanMetrics.gd===null?'—':r.cleanMetrics.gd.toFixed(2)}</td></tr>)}
          </tbody></table></div>
        </details>
        <details open><summary><strong>Within-club natural experiments</strong> · {validatedRoleAnalysis.switchers.length} clubs switch between clean and unresolved role encodings</summary>
          <p className="muted">Only clubs with at least two matches on each side are shown. Δ compares anomalous/unresolved PlayerRole matches with that same club's clean matches. Adjusted Δ additionally accounts for rounded XI-strength within that club. This is still observational: tactical changes can coincide with role-encoding changes.</p>
          {validatedRoleAnalysis.switchers.length ? <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Club</th><th>Clean MP</th><th>Clean PPG</th><th>Unresolved MP</th><th>Unresolved PPG</th><th>Δ PPG</th><th>XI-adj Δ</th><th>Δ GD</th></tr></thead><tbody>
            {validatedRoleAnalysis.switchers.map((r)=><tr key={`switch:${r.sourceClubId||r.club}`}><td><strong>{r.club}</strong></td><td>{r.cleanMetrics.matches}</td><td>{r.cleanMetrics.ppg?.toFixed(2) ?? '—'}</td><td>{r.anomalyMetrics.matches}</td><td>{r.anomalyMetrics.ppg?.toFixed(2) ?? '—'}</td><td>{r.deltaPpg>=0?'+':''}{r.deltaPpg.toFixed(2)}</td><td>{r.adjustedDeltaPpg===null?'—':`${r.adjustedDeltaPpg>=0?'+':''}${r.adjustedDeltaPpg.toFixed(2)}`}</td><td>{r.deltaGd>=0?'+':''}{r.deltaGd.toFixed(2)}</td></tr>)}
          </tbody></table></div> : <p className="muted">No club currently has enough clean and unresolved matches for a within-club comparison.</p>}
        </details>
        <details open><summary><strong>Validated role switches</strong> · {validatedRoleAnalysis.roleSwitchExperiments.length} within-club experiments</summary>
          <p className="muted">Same club, same formation and same formation slot. The context column now separates isolated role changes from coordinated role packages and broader tactical changes. “Isolated” means shared XI-strength bucket, identical opening tactical formula and identical validated roles in every other slot. Use the isolated Δ where available; XI-adj Δ remains the broader strength-matched comparison. This is observational evidence, not proof that the role caused the result.</p>
          {validatedRoleAnalysis.roleSwitchExperiments.length ? <>
            <p className="muted"><strong>Context census:</strong> {['isolated role change','coordinated role package','broader tactical change'].map((kind) => `${kind}: ${validatedRoleAnalysis.roleSwitchExperiments.filter((row) => row.isolationClass === kind).length}`).join(' · ')}</p>
            <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Club</th><th>Formation</th><th>Slot</th><th>Role A</th><th>Role B</th><th>Context</th><th>Strict MP</th><th>Strict Δ PPG</th><th>Strict Δ GD</th><th>XI-adj Δ PPG</th><th>XI-adj Δ GD</th><th>All MP</th></tr></thead><tbody>
            {validatedRoleAnalysis.roleSwitchExperiments.map((r, index)=><tr key={`role-switch:${r.sourceClubId||r.club}:${r.formation}:${r.slot}:${r.codeA}:${r.codeB}:${index}`}><td><strong>{r.club}</strong></td><td>{r.formation}</td><td>{r.slot}</td><td>{r.roleA} <code>{r.codeA}</code><br/><small>{r.matchesA} MP · {r.ppgA?.toFixed(2) ?? '—'} PPG</small></td><td>{r.roleB} <code>{r.codeB}</code><br/><small>{r.matchesB} MP · {r.ppgB?.toFixed(2) ?? '—'} PPG</small></td><td><strong>{r.isolationClass}</strong><br/><small>{r.tacticMatchedMatchesA}+{r.tacticMatchedMatchesB} tactic-matched</small></td><td>{r.isolatedMatchesA}+{r.isolatedMatchesB}<br/><small>{r.isolatedStrata} strata</small></td><td>{r.isolatedDeltaPpgBvsA===null?'—':`${r.isolatedDeltaPpgBvsA>=0?'+':''}${r.isolatedDeltaPpgBvsA.toFixed(2)}`}</td><td>{r.isolatedDeltaGdBvsA===null?'—':`${r.isolatedDeltaGdBvsA>=0?'+':''}${r.isolatedDeltaGdBvsA.toFixed(2)}`}</td><td>{r.adjustedDeltaPpgBvsA===null?'—':`${r.adjustedDeltaPpgBvsA>=0?'+':''}${r.adjustedDeltaPpgBvsA.toFixed(2)}`}</td><td>{r.adjustedDeltaGdBvsA===null?'—':`${r.adjustedDeltaGdBvsA>=0?'+':''}${r.adjustedDeltaGdBvsA.toFixed(2)}`}</td><td>{r.comparableMatchesA}+{r.comparableMatchesB}<br/><small>{r.commonXiBuckets} XI buckets</small></td></tr>)}
          </tbody></table></div></> : <p className="muted">No validated role pair yet has at least two comparable matches on both sides. More archived matches will make this view progressively stronger.</p>}
        </details>
        <details><summary><strong>Role-encoding quarantine</strong> · keep stable unresolved clubs out of role conclusions</summary>
          <p className="muted">Clubs with unresolved PlayerRole encodings in at least 80% of analyzable matches are quarantined from role-dependent interpretation. They remain in ordinary tactical/formula analysis because we have not found evidence that formation, mentality or the other archived instructions are corrupted. Sevilla therefore stays in Formula Lab, but its PlayerRole values do not get treated as decoded roles.</p>
          <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Club</th><th>MP</th><th>Unresolved MP</th><th>Share</th><th>Role analysis</th><th>Reason</th></tr></thead><tbody>
            {validatedRoleAnalysis.roleQuarantine.filter((r)=>!r.roleAnalysisEligible).map((r)=><tr key={`quarantine:${r.sourceClubId||r.club}`}><td><strong>{r.club}</strong></td><td>{r.matches}</td><td>{r.anomalousMatches}</td><td>{(r.anomalyShare*100).toFixed(0)}%</td><td>Quarantined</td><td>{r.reason}</td></tr>)}
          </tbody></table></div>
        </details>
        <details><summary><strong>Club persistence of raw role encodings</strong> · {validatedRoleAnalysis.persistence.length} combinations</summary>
          <p className="muted">Persistence is calculated within each club. ≥80% across at least four matches is treated as a stable club encoding candidate; ≤20% is an occasional/change candidate. This classification describes the archive pattern — it does not claim the sparse code has been semantically decoded.</p>
          <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Club</th><th>Formation</th><th>Key</th><th>Code</th><th>Candidate role</th><th>MP</th><th>Share</th><th>Status</th></tr></thead><tbody>
            {validatedRoleAnalysis.persistence.slice(0,150).map((r)=><tr key={`persist:${r.sourceClubId||r.club}:${r.formation}:${r.key}:${r.code}`}><td><strong>{r.club}</strong></td><td>{r.formation}</td><td><code>{r.key}</code></td><td><code>{r.code}</code></td><td>{r.role}</td><td>{r.matches}/{r.clubMatches}</td><td>{(r.share*100).toFixed(0)}%</td><td>{r.classification}</td></tr>)}
          </tbody></table></div>
        </details>
                <details><summary><strong>Quarantined sparse-only combinations</strong> · {validatedRoleAnalysis.anomalies.length}</summary>
          <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Formation</th><th>Key</th><th>Code</th><th>Candidate role</th><th>MP</th><th>Clubs</th><th>PPG</th><th>GD/game</th></tr></thead><tbody>
            {validatedRoleAnalysis.anomalies.map((r)=><tr key={`${r.formation}:${r.key}:${r.code}`}><td>{r.formation}</td><td><code>{r.key}</code></td><td><code>{r.code}</code></td><td>{r.role}</td><td>{r.matches}</td><td>{r.clubCount}</td><td>{r.ppg===null?'—':r.ppg.toFixed(2)}</td><td>{r.gd===null?'—':r.gd.toFixed(2)}</td></tr>)}
          </tbody></table></div>
        </details>
        <details><summary><strong>Validated role assignments</strong> · {validatedRoleAnalysis.assignments.length}</summary>
          <p className="muted">Complete-XI assignments plus sparse assignments corroborated by complete-XI evidence. Raw outcomes are a first descriptive view; XI-strength and tactical adjustment can follow once the decoder is stable.</p>
          <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Formation</th><th>Slot</th><th>Role</th><th>MP</th><th>Complete</th><th>Validated sparse</th><th>Clubs</th><th>PPG</th><th>GD/game</th></tr></thead><tbody>
            {validatedRoleAnalysis.assignments.map((r)=><tr key={`${r.formation}:${r.key}:${r.code}`}><td>{r.formation}</td><td>{Number(r.key)+1}</td><td>{r.role} <code>{r.code}</code></td><td>{r.matches}</td><td>{r.complete}</td><td>{r.sparse}</td><td>{r.clubCount}</td><td>{r.ppg===null?'—':r.ppg.toFixed(2)}</td><td>{r.gd===null?'—':r.gd.toFixed(2)}</td></tr>)}
          </tbody></table></div>
        </details>
      </section>}

      {worldFormulaMatches.length > 0 && replicatedFamily && <section className="card">
        <h2>Player roles · replicated 4-2-3-1 B</h2>
        <p className="muted">Complete-XI PlayerRole codes decoded from the current role menus and the archived Hamburger reference lineup. Sparse keyed timelines are excluded from this slot table and handled by the position × raw-code audit above, because their keys are not yet proven to be formation slots.</p>
        {replicatedFamilyRoleCodes.length ? <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Formation slot</th><th>Player role</th><th>Raw code</th><th>MP</th><th>Clubs</th><th>Divisions</th></tr></thead><tbody>
          {replicatedFamilyRoleCodes.map((role) => <tr key={`${role.slot}:${role.code}`}><td><strong>Slot {role.slot + 1}</strong></td><td>{playerRoleLabel(role.code)}</td><td><code>{role.code}</code></td><td>{role.matches}</td><td>{role.clubCount}</td><td>{role.divisionCount}</td></tr>)}
        </tbody></table></div> : <p className="muted">No PlayerRole values were archived for this family.</p>}
        <h3>Role-data integrity</h3>
        <p className="muted">Flags role codes that cannot belong to their 4-2-3-1 B formation slot, but only where the archive contains a complete XI vector. Sparse keyed timelines are no longer treated as integrity failures.</p>
        {replicatedFamilyRoleIntegrity.length ? <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Club</th><th>Division</th><th>Fixture</th><th>Impossible assignment</th><th>Complete raw vector</th></tr></thead><tbody>
          {replicatedFamilyRoleIntegrity.map((row, index) => <tr key={`${row.fixtureId || 'fixture'}:${row.sourceClubId || 'club'}:${index}`}><td><strong>{row.club}</strong><br /><small>{row.sourceClubId || '—'}</small></td><td>{row.division}</td><td>{row.fixtureId || '—'}</td><td>{row.issues}</td><td><code>{row.fingerprint || '—'}</code></td></tr>)}
        </tbody></table></div> : <p className="muted">No impossible 4-2-3-1 B role/slot combinations found in this cohort.</p>}
        <h3>Raw PlayerRole inspector</h3>
        <p className="muted">Unmodified archived <code>tactics.playerRoles</code> for every integrity failure, plus one known-good Hamburger 4-2-3-1 B fixture for comparison. This deliberately bypasses the role-vector decoder so we can see the original nesting, keys and sparse values.</p>
        {rawPlayerRoleInspector.length ? rawPlayerRoleInspector.map((row, index) => <details key={`raw-role:${row.kind}:${row.fixtureId || index}`}>
          <summary><strong>{row.kind === 'known-good' ? 'Known-good comparison' : 'Suspect'} · {row.club}</strong> · {row.division} · {row.date || 'date unknown'} · {row.venue ? `${row.venue} · ` : ''}{row.opponent || 'opponent unknown'}{row.score ? ` · ${row.score}` : ''} · fixture {row.fixtureId || '—'}</summary>
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(row.rawPlayerRoles, null, 2)}</pre>
        </details>) : <p className="muted">No raw PlayerRole records available for inspection.</p>}
        <h3>{selectedClub?.name || 'Selected club'} · 4-2-3-1 B reference</h3>
        <p className="muted">The selected club's archived 4-2-3-1 B roles, decoded with the same 0–21 Soccer Manager role dictionary.</p>
        {selectedClubRoleCodes.length ? <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Formation slot</th><th>Player role</th><th>Raw code</th><th>MP</th></tr></thead><tbody>
          {selectedClubRoleCodes.map((role) => <tr key={`club:${role.slot}:${role.code}`}><td><strong>Slot {role.slot + 1}</strong></td><td>{playerRoleLabel(role.code)}</td><td><code>{role.code}</code></td><td>{role.matches}</td></tr>)}
        </tbody></table></div> : <p className="muted">No archived 4-2-3-1 B PlayerRole values for this club.</p>}
        {selectedClubRoleFingerprints.length > 0 && <>
          <h3>Complete XI role fingerprints</h3>
          <p className="muted">Each row is the complete 11-slot PlayerRole vector recorded for an archived 4-2-3-1 B match, now labelled with the decoded role names while retaining each raw code.</p>
          <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Raw XI fingerprint</th><th>MP</th></tr></thead><tbody>
            {selectedClubRoleFingerprints.map((row) => <tr key={row.fingerprint}><td><code>{row.fingerprint}</code></td><td>{row.matchesPlayed}</td></tr>)}
          </tbody></table></div>
        </>}
      </section>}

      {worldFormulaMatches.length > 0 && replicatedFamily && <section className="card">
        <h2>Replicated underdog family · instruction drill-down</h2>
        <p className="muted">The five-field family 4-2-3-1 B · Attacking · Mixed · Down Both Flanks · Fast is held constant here. The table shows how the remaining archived opening instructions vary inside that family. Adj PPG/GD use each match's own division and rounded XI-strength baseline, so this is a drill-down into the replicated signal rather than a raw-results ranking.</p>
        <div className="table-wrap"><table className="manager-lab-table"><thead><tr><th>Instruction</th><th>Value</th><th>MP</th><th>Clubs</th><th>Divisions</th><th>PPG</th><th>Adj PPG</th><th>Adj GD</th></tr></thead><tbody>
          {replicatedFamilyVariants.flatMap((row) => row.variants.map((variant, index) => <tr key={`${row.key}:${variant.value}`}>
            <td>{index === 0 ? <strong>{row.label}</strong> : ''}</td><td>{displayTacticValue(row.key, variant.value)}</td>
            <td>{variant.played}</td><td>{variant.clubCount}</td><td>{variant.divisionCount}</td><td>{variant.ppg.toFixed(2)}</td>
            <td>{variant.adjustedPpg === null ? '—' : `${variant.adjustedPpg >= 0 ? '+' : ''}${variant.adjustedPpg.toFixed(2)}`}</td>
            <td>{variant.adjustedGd === null ? '—' : `${variant.adjustedGd >= 0 ? '+' : ''}${variant.adjustedGd.toFixed(2)}`}</td>
          </tr>))}
        </tbody></table></div>
        <p className="muted">Treat small variants cautiously. A setting appearing across several clubs and divisions is stronger replication evidence than a spectacular result from one club. These are observational associations, not causal estimates.</p>
      </section>}

      {worldFormulaMatches.length > 0 && <section className="card">
        <h2>Formula families · whole world</h2>
        <p className="muted">Core tactical identities collapse the exact formulas to formation, mentality, passing, attacking style and tempo. Adj PPG/GD compare with the selected league cohort's baseline at roughly the same XI-rating gap. Mgr Adj is leave-one-formula-out: it compares with that same club's other tactical formulas at the same rounded XI-strength gap. A comparison is shown only where at least three alternative matches exist, helping separate a manager/team effect from a tactical one. Positive values beat the relevant baseline.</p>
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
