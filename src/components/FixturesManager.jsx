import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import { calculateFetFromStats, describeFetStep, tieSnapshot } from '../lib/knockoutResolution';

const ROUND_ORDER = ['R64', 'R32', 'R16', 'QF', 'SF', 'Final'];
const EMPTY_FET = { home_possession: '', away_possession: '', home_shots_on_target: '', away_shots_on_target: '' };

function teamNameFromEntry(entry, fallback) {
  return entry?.teams?.name || entry?.team?.name || fallback || 'TBC';
}

function isCompleted(fixture) {
  return fixture.status === 'played' || fixture.status === 'forfeit';
}

function isDoubleForfeit(fixture) {
  return fixture.status === 'forfeit'
    && Number(fixture.home_score) === 0
    && Number(fixture.away_score) === 0
    && !fixture.winner_entry_id
    && !fixture.loser_entry_id;
}

function fixtureGroupLabel(fixture) {
  return fixture.stage === 'knockout'
    ? fixture.bracket || 'Knockout'
    : fixture.groups?.code || fixture.group_code || 'Ungrouped';
}

function roundLabel(fixture) {
  return fixture.round || 'Unscheduled';
}

function roundSortValue(round) {
  const index = ROUND_ORDER.indexOf(round);
  return index === -1 ? 99 : index;
}

function knockoutResultLockReason(fixture, fixtures, knockoutOnly) {
  if (!knockoutOnly || fixture.stage !== 'knockout') return '';
  const explicitBye = fixture.decided_by === 'bye';
  const legacyBye = !fixture.away_entry_id && String(fixture.away_placeholder || '').trim().toUpperCase() === 'BYE';
  if (explicitBye || legacyBye) return 'Automatic BYE result — fixed by the draw.';

  const currentRank = roundSortValue(fixture.round);
  if (currentRank === 99) return '';
  const bracket = fixture.bracket || 'Cup';
  const advanced = fixtures.some((other) => {
    if (other.stage !== 'knockout' || (other.bracket || 'Cup') !== bracket) return false;
    const otherRank = roundSortValue(other.round);
    return otherRank !== 99 && otherRank > currentRank;
  });
  return advanced ? `${fixture.round} result locked after the next round was generated.` : '';
}

function hasSecondLeg(bracket, round) {
  if (round === 'R32') return false;
  if (bracket === 'Shield' && round === 'R16') return false;
  return true;
}

function formatDate(dateString) {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function addDays(dateString, days) {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function legLabel(leg) {
  if (Number(leg) === 1) return '1st leg';
  if (Number(leg) === 2) return '2nd leg';
  return `Leg ${leg}`;
}

function sortFixtures(a, b) {
  const bracket = fixtureGroupLabel(a).localeCompare(fixtureGroupLabel(b));
  if (bracket) return bracket;
  const round = roundSortValue(roundLabel(a)) - roundSortValue(roundLabel(b));
  if (round) return round;
  const roundName = roundLabel(a).localeCompare(roundLabel(b), undefined, { numeric: true });
  if (roundName) return roundName;
  const match = Number(a.match_order || 0) - Number(b.match_order || 0);
  if (match) return match;
  return Number(a.leg || 1) - Number(b.leg || 1);
}

function sectionDateLabel(sectionFixtures) {
  const dates = [...new Set(sectionFixtures.map((fixture) => fixture.fixture_date).filter(Boolean))].sort();
  if (!dates.length) return '';
  if (dates.length === 1) return formatDate(dates[0]);
  return `${formatDate(dates[0])} / ${formatDate(dates[dates.length - 1])}`;
}

function groupFixtures(fixtures) {
  return [...fixtures].sort(sortFixtures).reduce((sections, fixture) => {
    const groupCode = fixtureGroupLabel(fixture);
    const round = roundLabel(fixture);
    const key = `${groupCode}|${round}`;
    if (!sections[key]) sections[key] = { key, groupCode, round, fixtures: [] };
    sections[key].fixtures.push(fixture);
    return sections;
  }, {});
}

function testScore(fixture) {
  const base = Number(fixture.match_order || fixture.id || 1) + (fixture.round || '').length + Number(fixture.leg || 1);
  const home = (base % 5) + 1;
  const away = base % 4;
  return home === away ? { home_score: home + 1, away_score: away } : { home_score: home, away_score: away };
}

function knockoutTieKey(fixture) {
  return [fixture.bracket || 'Knockout', fixture.round || 'Round', fixture.match_order || 0].join('|');
}

function tieLegs(fixtures, fixture) {
  const key = knockoutTieKey(fixture);
  return fixtures.filter((item) => item.stage === 'knockout' && knockoutTieKey(item) === key && item.status !== 'voided');
}

function buildTieSummaries(fixtures) {
  const ties = new Map();
  fixtures.filter((fixture) => fixture.stage === 'knockout' && fixture.status !== 'voided').forEach((fixture) => {
    const key = knockoutTieKey(fixture);
    if (!ties.has(key)) ties.set(key, []);
    ties.get(key).push(fixture);
  });

  const summaries = new Map();
  ties.forEach((legs, key) => {
    const ordered = [...legs].sort((a, b) => Number(a.leg || 1) - Number(b.leg || 1));
    const completed = ordered.filter(isCompleted);
    if (ordered.length < 2 || completed.length !== ordered.length) return;
    const snapshot = tieSnapshot(ordered);
    if (!snapshot) return;

    const first = ordered[0];
    const firstName = teamNameFromEntry(first.home_entry, first.home_placeholder);
    const secondName = teamNameFromEntry(first.away_entry, first.away_placeholder);
    let detail = `Aggregate after normal time: ${firstName} ${snapshot.firstAgg}-${snapshot.secondAgg} ${secondName}`;
    if (snapshot.firstAgg === snapshot.secondAgg) {
      if (snapshot.firstAway !== snapshot.secondAway) {
        detail += snapshot.firstAway > snapshot.secondAway
          ? ` · ${firstName} advance on away goals (${snapshot.firstAway}-${snapshot.secondAway})`
          : ` · ${secondName} advance on away goals (${snapshot.secondAway}-${snapshot.firstAway})`;
      } else {
        const decidingLeg = [...ordered].reverse().find((leg) => leg.home_extra_time_score !== null && leg.home_extra_time_score !== undefined && leg.away_extra_time_score !== null && leg.away_extra_time_score !== undefined);
        if (decidingLeg) {
          const homeFet = Number(decidingLeg.home_extra_time_score || 0);
          const awayFet = Number(decidingLeg.away_extra_time_score || 0);
          const winner = homeFet > awayFet
            ? teamNameFromEntry(decidingLeg.home_entry, decidingLeg.home_placeholder)
            : teamNameFromEntry(decidingLeg.away_entry, decidingLeg.away_placeholder);
          detail += ` · Away goals level (${snapshot.firstAway}-${snapshot.secondAway}) · ${winner} advance after ${decidingLeg.decided_by === 'manual' ? 'manual FET decider' : `FET ${homeFet}-${awayFet}`}`;
        } else {
          detail += ` · Away goals level (${snapshot.firstAway}-${snapshot.secondAway}) — Fictional Extra Time needed`;
        }
      }
    }
    summaries.set(key, detail);
  });
  return summaries;
}

function rulingLabel(ruling) {
  if (ruling === 'away_forfeited') return 'Away team forfeited — home win';
  if (ruling === 'home_forfeited') return 'Home team forfeited — away win';
  if (ruling === 'double_forfeit') return 'Both teams forfeited — 0-0';
  return 'Played normally';
}

function scoreLabel(fixture) {
  if (!isCompleted(fixture)) return 'v';
  const hasFet = fixture.home_extra_time_score !== null && fixture.home_extra_time_score !== undefined
    && fixture.away_extra_time_score !== null && fixture.away_extra_time_score !== undefined;
  return `${fixture.home_score ?? 0} - ${fixture.away_score ?? 0}${hasFet ? ' FET' : ''}`;
}

export default function FixturesManager({ selectedTournament, preview, stage = 'group', onlyOutstanding = false, onlyCompleted = false, onDataChanged }) {
  const [fixtures, setFixtures] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [scores, setScores] = useState({ home_score: '', away_score: '' });
  const [fetStats, setFetStats] = useState(EMPTY_FET);
  const [manualFetWinner, setManualFetWinner] = useState('');
  const [ruling, setRuling] = useState('played');
  const [resultNote, setResultNote] = useState('');
  const [rescheduleDates, setRescheduleDates] = useState({});
  const [groupFilter, setGroupFilter] = useState('all');
  const [roundFilter, setRoundFilter] = useState('all');
  const [roundDate, setRoundDate] = useState('');
  const tournamentId = selectedTournament?.id;
  const knockoutOnly = selectedTournament?.tournament_structure === 'knockout_only';
  const allowTestAutofill = !knockoutOnly;

  useEffect(() => {
    if (hasSupabaseConfig && supabase && tournamentId) loadFixtures();
  }, [tournamentId, stage]);

  const filteredFixtures = useMemo(() => fixtures
    .filter((fixture) => fixture.status !== 'voided')
    .filter((fixture) => !onlyOutstanding || !isCompleted(fixture))
    .filter((fixture) => !onlyCompleted || isCompleted(fixture))
    .filter((fixture) => groupFilter === 'all' || fixtureGroupLabel(fixture) === groupFilter)
    .filter((fixture) => roundFilter === 'all' || roundLabel(fixture) === roundFilter)
    .sort(sortFixtures), [fixtures, onlyOutstanding, onlyCompleted, groupFilter, roundFilter]);

  const sections = useMemo(() => Object.values(groupFixtures(filteredFixtures)), [filteredFixtures]);
  const tieSummaries = useMemo(() => buildTieSummaries(fixtures), [fixtures]);
  const playedCount = fixtures.filter(isCompleted).length;
  const groupOptions = useMemo(() => [...new Set(fixtures.filter((fixture) => fixture.status !== 'voided').map(fixtureGroupLabel))].sort(), [fixtures]);
  const roundOptions = useMemo(() => [...new Set(fixtures.filter((fixture) => fixture.status !== 'voided').map(roundLabel))]
    .sort((a, b) => roundSortValue(a) - roundSortValue(b) || a.localeCompare(b, undefined, { numeric: true })), [fixtures]);

  async function loadFixtures() {
    if (!tournamentId) return;
    setLoading(true);
    setStatus('Loading from database...');
    let query = supabase
      .from('matches')
      .select('id, tournament_id, group_id, stage, round, leg, match_order, fixture_date, home_entry_id, away_entry_id, home_score, away_score, home_normal_time_score, away_normal_time_score, home_extra_time_score, away_extra_time_score, home_possession, away_possession, home_shots_on_target, away_shots_on_target, winner_entry_id, loser_entry_id, status, played_at, decided_by, home_placeholder, away_placeholder, bracket, groups(id, code, name), home_entry:tournament_entries!matches_home_entry_id_fkey(id, seed, teams(id, name), managers(id, name, display_name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, seed, teams(id, name), managers(id, name, display_name))')
      .eq('tournament_id', tournamentId)
      .order('bracket', { ascending: true })
      .order('round', { ascending: true })
      .order('match_order', { ascending: true })
      .order('leg', { ascending: true });
    if (stage) query = query.eq('stage', stage);

    const { data, error } = await query;
    if (error) {
      setStatus(`Could not load fixtures: ${error.message}`);
      setFixtures([]);
    } else {
      setFixtures((data || []).sort(sortFixtures));
      setStatus(`${data?.length || 0} fixtures loaded from database.`);
    }
    setLoading(false);
  }

  function startEdit(fixture) {
    const lockReason = knockoutResultLockReason(fixture, fixtures, knockoutOnly);
    if (lockReason) return setStatus(lockReason);
    setEditingId(fixture.id);
    setScores({
      home_score: fixture.home_normal_time_score ?? fixture.home_score ?? '',
      away_score: fixture.away_normal_time_score ?? fixture.away_score ?? '',
    });
    setFetStats({
      home_possession: fixture.home_possession ?? '',
      away_possession: fixture.away_possession ?? '',
      home_shots_on_target: fixture.home_shots_on_target ?? '',
      away_shots_on_target: fixture.away_shots_on_target ?? '',
    });
    setManualFetWinner(fixture.decided_by === 'manual'
      ? fixture.winner_entry_id === fixture.home_entry_id ? 'home' : fixture.winner_entry_id === fixture.away_entry_id ? 'away' : ''
      : '');
    setResultNote('');
    if (isDoubleForfeit(fixture)) setRuling('double_forfeit');
    else if (fixture.status === 'forfeit') setRuling(Number(fixture.home_score) > Number(fixture.away_score) ? 'away_forfeited' : 'home_forfeited');
    else setRuling('played');
  }

  function cancelEdit() {
    setEditingId(null);
    setScores({ home_score: '', away_score: '' });
    setFetStats(EMPTY_FET);
    setManualFetWinner('');
    setRuling('played');
    setResultNote('');
  }

  function changeRuling(nextRuling) {
    setRuling(nextRuling);
    setManualFetWinner('');
    if (nextRuling === 'double_forfeit') setScores({ home_score: 0, away_score: 0 });
  }

  function knockoutDraft(fixture, homeScore, awayScore) {
    if (stage !== 'knockout' || ruling !== 'played') return { requiresFet: false, snapshot: null, oneLeg: false };
    const legs = tieLegs(fixtures, fixture);
    const oneLeg = knockoutOnly || !hasSecondLeg(fixture.bracket, fixture.round) || legs.length === 1;
    const override = new Map([[fixture.id, { home_score: homeScore, away_score: awayScore }]]);
    const snapshot = tieSnapshot(legs, override);
    if (!snapshot) return { requiresFet: oneLeg && homeScore === awayScore, snapshot: null, oneLeg };
    const currentIsDecidingLeg = oneLeg || Number(fixture.leg || 1) === Math.max(...legs.map((leg) => Number(leg.leg || 1)));
    return { requiresFet: currentIsDecidingLeg && snapshot.complete && snapshot.reason === 'fet_required', snapshot, oneLeg };
  }

  async function updateResult(fixture, homeScore, awayScore, resultStatus = 'played', resolution = {}) {
    const hasFet = resolution.decided_by === 'fictional_extra_time' || resolution.decided_by === 'manual';
    const storedHomeScore = homeScore + Number(resolution.home_extra_time_score || 0);
    const storedAwayScore = awayScore + Number(resolution.away_extra_time_score || 0);
    let winnerEntryId = resolution.winner_entry_id ?? null;
    let loserEntryId = resolution.loser_entry_id ?? null;
    if (!resolution.overrideWinner) {
      if (storedHomeScore > storedAwayScore) {
        winnerEntryId = fixture.home_entry_id;
        loserEntryId = fixture.away_entry_id;
      } else if (storedAwayScore > storedHomeScore) {
        winnerEntryId = fixture.away_entry_id;
        loserEntryId = fixture.home_entry_id;
      }
    }

    return supabase.from('matches').update({
      home_score: storedHomeScore,
      away_score: storedAwayScore,
      home_normal_time_score: stage === 'knockout' ? homeScore : null,
      away_normal_time_score: stage === 'knockout' ? awayScore : null,
      home_extra_time_score: hasFet ? resolution.home_extra_time_score : null,
      away_extra_time_score: hasFet ? resolution.away_extra_time_score : null,
      home_possession: hasFet ? resolution.home_possession : null,
      away_possession: hasFet ? resolution.away_possession : null,
      home_shots_on_target: hasFet ? resolution.home_shots_on_target : null,
      away_shots_on_target: hasFet ? resolution.away_shots_on_target : null,
      decided_by: resolution.decided_by ?? null,
      winner_entry_id: winnerEntryId,
      loser_entry_id: loserEntryId,
      status: resultStatus,
      played_at: new Date().toISOString(),
    }).eq('id', fixture.id);
  }

  async function saveOfficialResult(fixture) {
    const lockReason = knockoutResultLockReason(fixture, fixtures, knockoutOnly);
    if (lockReason) {
      cancelEdit();
      return setStatus(lockReason);
    }
    const homeScore = ruling === 'double_forfeit' ? 0 : Number(scores.home_score);
    const awayScore = ruling === 'double_forfeit' ? 0 : Number(scores.away_score);
    if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) return setStatus('Enter valid whole-number scores before saving.');
    if (ruling === 'away_forfeited' && homeScore - awayScore < 3) return setStatus('An away-team forfeit must give the home team at least a three-goal advantage.');
    if (ruling === 'home_forfeited' && awayScore - homeScore < 3) return setStatus('A home-team forfeit must give the away team at least a three-goal advantage.');
    if (ruling === 'double_forfeit' && !resultNote.trim()) return setStatus('Add a reason before recording a double forfeit.');

    const homeName = teamNameFromEntry(fixture.home_entry, fixture.home_placeholder);
    const awayName = teamNameFromEntry(fixture.away_entry, fixture.away_placeholder);
    const draft = knockoutDraft(fixture, homeScore, awayScore);
    let resolution = {};
    let confirmationExtra = '';

    if (draft.requiresFet) {
      const fet = calculateFetFromStats({
        homePossession: fetStats.home_possession,
        awayPossession: fetStats.away_possession,
        homeShotsOnTarget: fetStats.home_shots_on_target,
        awayShotsOnTarget: fetStats.away_shots_on_target,
      });
      if (!fet.valid) return setStatus('Enter complete, valid possession percentages and shots-on-target figures to calculate FET.');

      let homeFetGoals = fet.homeGoals;
      let awayFetGoals = fet.awayGoals;
      let decidedBy = 'fictional_extra_time';
      let winnerEntryId;
      let loserEntryId;
      let manualLine = '';

      if (!fet.resolved) {
        if (!manualFetWinner) return setStatus('FET is exactly level after every statistical tiebreak. Choose the manual decider before saving.');
        decidedBy = 'manual';
        if (manualFetWinner === 'home') {
          homeFetGoals += 1;
          winnerEntryId = fixture.home_entry_id;
          loserEntryId = fixture.away_entry_id;
          manualLine = `\nManual decider: ${homeName} +1 deciding FET goal`;
        } else {
          awayFetGoals += 1;
          winnerEntryId = fixture.away_entry_id;
          loserEntryId = fixture.home_entry_id;
          manualLine = `\nManual decider: ${awayName} +1 deciding FET goal`;
        }
      } else {
        winnerEntryId = homeFetGoals > awayFetGoals ? fixture.home_entry_id : fixture.away_entry_id;
        loserEntryId = homeFetGoals > awayFetGoals ? fixture.away_entry_id : fixture.home_entry_id;
      }

      resolution = {
        overrideWinner: true,
        winner_entry_id: winnerEntryId,
        loser_entry_id: loserEntryId,
        home_extra_time_score: homeFetGoals,
        away_extra_time_score: awayFetGoals,
        home_possession: Number(fetStats.home_possession),
        away_possession: Number(fetStats.away_possession),
        home_shots_on_target: Number(fetStats.home_shots_on_target),
        away_shots_on_target: Number(fetStats.away_shots_on_target),
        decided_by: decidedBy,
      };
      const finalHome = homeScore + homeFetGoals;
      const finalAway = awayScore + awayFetGoals;
      confirmationExtra = `\nFET: ${homeFetGoals}–${awayFetGoals}\nFinal score after FET: ${finalHome}–${finalAway}\n${fet.steps.map((step) => describeFetStep(step, homeName, awayName)).join('\n')}${manualLine}`;
    }

    if (!window.confirm(`Save ${homeName} ${homeScore}–${awayScore} ${awayName} after normal time${confirmationExtra}\n\nRuling: ${rulingLabel(ruling)}${resultNote.trim() ? `\nReason: ${resultNote.trim()}` : ''}?`)) return;

    setLoading(true);
    setStatus('Saving official result...');
    const result = ruling === 'double_forfeit'
      ? await supabase.rpc('admin_record_double_forfeit', { target_match_id: fixture.id, note: resultNote.trim() })
      : await updateResult(fixture, homeScore, awayScore, ruling === 'played' ? 'played' : 'forfeit', resolution);
    const { error } = result;
    if (error) setStatus(`Save failed: ${error.message}`);
    else {
      const finalHome = homeScore + Number(resolution.home_extra_time_score || 0);
      const finalAway = awayScore + Number(resolution.away_extra_time_score || 0);
      const decisionText = resolution.decided_by === 'manual' ? ' after manual FET decider' : resolution.decided_by ? ` after FET (${homeScore}–${awayScore} after normal time)` : '';
      setStatus(`Official result saved as ${finalHome}–${finalAway}${decisionText} · ${rulingLabel(ruling)}.`);
      cancelEdit();
      await loadFixtures();
      await onDataChanged?.();
    }
    setLoading(false);
  }

  async function rescheduleFixture(fixture) {
    const date = rescheduleDates[fixture.id];
    if (!date) return setStatus('Choose the new fixture date first.');
    if (isCompleted(fixture)) return setStatus('Reset the completed result before rescheduling this fixture.');
    setLoading(true);
    setStatus('Rescheduling fixture...');
    const { error } = await supabase.from('matches').update({ fixture_date: date, status: 'postponed' }).eq('id', fixture.id);
    if (error) setStatus(`Reschedule failed: ${error.message}`);
    else {
      setStatus(`${fixture.round} fixture rescheduled to ${formatDate(date)}; it remains part of ${fixture.round}.`);
      await loadFixtures();
      await onDataChanged?.();
    }
    setLoading(false);
  }

  async function autoPopulateVisible() {
    if (!allowTestAutofill) return setStatus('Test-score autofill is disabled for knockout-only tournaments.');
    const targets = filteredFixtures.filter((fixture) => !isCompleted(fixture));
    if (!targets.length) return setStatus('No outstanding fixtures visible.');
    setLoading(true);
    setStatus('Saving test scores for visible fixtures...');
    for (const fixture of targets) {
      const score = testScore(fixture);
      const { error } = await updateResult(fixture, score.home_score, score.away_score);
      if (error) {
        setStatus(`Auto-fill failed: ${error.message}`);
        setLoading(false);
        return;
      }
    }
    await loadFixtures();
    await onDataChanged?.();
    setStatus(`${targets.length} test results saved and view refreshed.`);
    setLoading(false);
  }

  async function setVisibleRoundDate() {
    if (!roundDate) return setStatus('Choose a date first.');
    const targets = filteredFixtures;
    if (!targets.length) return setStatus('No fixtures visible to date.');
    setLoading(true);
    setStatus('Saving fixture dates...');

    if (stage === 'knockout') {
      const results = await Promise.all(targets.map((fixture) => {
        const oneLegOnly = knockoutOnly || !hasSecondLeg(fixture.bracket, fixture.round);
        const fixtureDate = oneLegOnly || Number(fixture.leg || 1) === 1 ? roundDate : addDays(roundDate, 7);
        return supabase.from('matches').update({ fixture_date: fixtureDate }).eq('id', fixture.id);
      }));
      const error = results.find((result) => result.error)?.error;
      if (error) setStatus(`Date save failed: ${error.message}`);
      else {
        const sample = targets[0];
        const oneLegOnly = knockoutOnly || (sample && !hasSecondLeg(sample.bracket, sample.round));
        setStatus(oneLegOnly ? `Date applied: ${formatDate(roundDate)}.` : `Dates applied: 1st legs ${formatDate(roundDate)}, 2nd legs ${formatDate(addDays(roundDate, 7))}.`);
        await loadFixtures();
      }
    } else {
      const { error } = await supabase.from('matches').update({ fixture_date: roundDate }).in('id', targets.map((fixture) => fixture.id));
      if (error) setStatus(`Date save failed: ${error.message}`);
      else {
        setStatus(`Date applied to ${targets.length} visible fixtures and view refreshed.`);
        await loadFixtures();
      }
    }
    setLoading(false);
  }

  async function resetResult(fixture) {
    const lockReason = knockoutResultLockReason(fixture, fixtures, knockoutOnly);
    if (lockReason) return setStatus(lockReason);
    setLoading(true);
    setStatus('Resetting result...');
    const { error } = await supabase.from('matches').update({
      home_score: null,
      away_score: null,
      home_normal_time_score: null,
      away_normal_time_score: null,
      home_extra_time_score: null,
      away_extra_time_score: null,
      home_possession: null,
      away_possession: null,
      home_shots_on_target: null,
      away_shots_on_target: null,
      decided_by: null,
      winner_entry_id: null,
      loser_entry_id: null,
      status: 'scheduled',
      played_at: null,
    }).eq('id', fixture.id);
    if (error) setStatus(`Reset failed: ${error.message}`);
    else {
      setStatus('Result reset and view refreshed.');
      await loadFixtures();
      await onDataChanged?.();
    }
    setLoading(false);
  }

  if (!selectedTournament) return <p className="muted">Create or select a tournament first.</p>;
  if (!hasSupabaseConfig || !supabase) return <p className="muted">Supabase is not connected yet.</p>;

  const titleText = onlyCompleted ? 'Results archive' : onlyOutstanding ? 'Fixture list' : stage === 'knockout' ? 'Knockout results' : 'Fixture secretary';
  const explainer = onlyCompleted
    ? knockoutOnly
      ? 'Played results are shown here. Automatic BYEs and rounds that have already fed a successor are locked; roll back the current knockout round before correcting a predecessor.'
      : 'Only played results are shown here. Use this page to review, edit or reset saved results.'
    : onlyOutstanding
      ? stage === 'knockout'
        ? knockoutOnly
          ? 'Only unplayed knockout fixtures are shown here. Every tie is one leg.'
          : 'Only unplayed knockout fixtures are shown here. R32 is one leg; two-legged rounds use the chosen date for 1st legs and seven days later for 2nd legs.'
        : 'Only unplayed fixtures are shown here. Results move to the Results page once saved.'
      : 'Load saved fixtures, enter official results, record forfeits, and resolve knockout ties through aggregate, away goals and progressive Fictional Extra Time.';

  return (
    <div className="fixtures-manager">
      <div className="fixtures-toolbar">
        <div>
          <p className="eyebrow">{titleText}</p>
          <h3>{playedCount} / {fixtures.length} {stage === 'knockout' ? 'knockout' : 'group'} fixtures played</h3>
          <p className="muted">{explainer}</p>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={loadFixtures} disabled={loading}>Reload from database</button>
          {!onlyCompleted && allowTestAutofill && <button type="button" className="secondary" onClick={autoPopulateVisible} disabled={loading}>Auto-fill test scores</button>}
        </div>
      </div>

      <div className="filter-row multi">
        <label>{stage === 'knockout' ? 'Bracket' : 'Group'}
          <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
            <option value="all">All</option>
            {groupOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>Round
          <select value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)}>
            <option value="all">All</option>
            {roundOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        {!onlyCompleted && <>
          <label>{stage === 'knockout' ? (knockoutOnly ? 'Apply date to visible ties' : 'Apply 1st-leg date to visible ties') : 'Apply date to visible fixtures'}
            <input type="date" value={roundDate} onChange={(event) => setRoundDate(event.target.value)} />
          </label>
          <button type="button" className="secondary" onClick={setVisibleRoundDate} disabled={loading}>Set date</button>
        </>}
      </div>

      <p className="status">{status}</p>

      {fixtures.length === 0 ? (
        <div className="empty-state">
          <h3>No saved fixtures yet.</h3>
          <p className="muted">{knockoutOnly ? 'Generate the knockout draw first.' : `Approve the draw on the Groups tab first. The preview currently has ${preview?.fixtures?.length || 0} generated fixtures.`}</p>
        </div>
      ) : sections.length === 0 ? (
        <div className="empty-state"><h3>No fixtures match this view.</h3><p className="muted">Try another group/bracket, round, or reload from the database.</p></div>
      ) : (
        <div className="fixture-sections">
          {sections.map((section) => (
            <section className="fixture-section" key={section.key}>
              <div className="fixture-section-header">
                <h3>{stage === 'knockout' ? section.groupCode : `Group ${section.groupCode}`} · {section.round}{sectionDateLabel(section.fixtures) ? ` · ${sectionDateLabel(section.fixtures)}` : ''}</h3>
                <span>{section.fixtures.length} fixtures</span>
              </div>

              <div className="fixture-card-list">
                {section.fixtures.map((fixture) => {
                  const homeName = teamNameFromEntry(fixture.home_entry, fixture.home_placeholder);
                  const awayName = teamNameFromEntry(fixture.away_entry, fixture.away_placeholder);
                  const isEditing = editingId === fixture.id;
                  const completed = isCompleted(fixture);
                  const doubleForfeit = isDoubleForfeit(fixture);
                  const tieSummary = stage === 'knockout' ? tieSummaries.get(knockoutTieKey(fixture)) : null;
                  const resultLockReason = knockoutResultLockReason(fixture, fixtures, knockoutOnly);
                  const draftHome = Number(scores.home_score);
                  const draftAway = Number(scores.away_score);
                  const draftScoresValid = Number.isInteger(draftHome) && Number.isInteger(draftAway) && draftHome >= 0 && draftAway >= 0;
                  const draft = isEditing && draftScoresValid ? knockoutDraft(fixture, draftHome, draftAway) : { requiresFet: false, snapshot: null, oneLeg: false };
                  const fet = draft.requiresFet ? calculateFetFromStats({
                    homePossession: fetStats.home_possession,
                    awayPossession: fetStats.away_possession,
                    homeShotsOnTarget: fetStats.home_shots_on_target,
                    awayShotsOnTarget: fetStats.away_shots_on_target,
                  }) : null;

                  return (
                    <article className="fixture-card" key={fixture.id}>
                      <div className="fixture-teams">
                        <strong>{homeName}</strong>
                        <span className="score-pill">{scoreLabel(fixture)}</span>
                        <strong>{awayName}</strong>
                      </div>
                      <p className="eyebrow">{fixture.status?.replaceAll('_', ' ') || 'scheduled'} · {knockoutOnly && stage === 'knockout' ? 'single leg' : legLabel(fixture.leg || 1)}</p>
                      {(fixture.decided_by === 'fictional_extra_time' || fixture.decided_by === 'manual') && <p className="muted">Normal time: {fixture.home_normal_time_score ?? fixture.home_score}–{fixture.away_normal_time_score ?? fixture.away_score} · FET goals: {fixture.home_extra_time_score ?? 0}–{fixture.away_extra_time_score ?? 0} · Final: {fixture.home_score}–{fixture.away_score}{fixture.decided_by === 'manual' ? ' · manual decider' : ''}</p>}
                      {doubleForfeit && <p className="muted">{stage === 'knockout' ? 'Double forfeit: 0–0, both teams eliminated. No team advances or drops into the consolation bracket.' : 'Double forfeit: 0–0, both teams receive a loss and zero points.'}</p>}
                      {fixture.status === 'forfeit' && !doubleForfeit && <p className="muted">Forfeit ruling recorded.</p>}
                      {fixture.status === 'postponed' && <p className="muted">Rescheduled fixture — still counts as {fixture.round} when played.</p>}
                      {tieSummary && <p className="status">{tieSummary}</p>}
                      {resultLockReason && <p className="muted">🔒 {resultLockReason}</p>}

                      {isEditing && !resultLockReason ? (
                        <div className="result-editor">
                          <div className="mini-grid">
                            <label>{stage === 'knockout' ? 'Home score after normal time' : 'Home score'}
                              <input type="number" min="0" disabled={ruling === 'double_forfeit'} value={ruling === 'double_forfeit' ? 0 : scores.home_score} onChange={(event) => setScores((current) => ({ ...current, home_score: event.target.value }))} />
                            </label>
                            <label>{stage === 'knockout' ? 'Away score after normal time' : 'Away score'}
                              <input type="number" min="0" disabled={ruling === 'double_forfeit'} value={ruling === 'double_forfeit' ? 0 : scores.away_score} onChange={(event) => setScores((current) => ({ ...current, away_score: event.target.value }))} />
                            </label>
                            <label>Official ruling
                              <select value={ruling} onChange={(event) => changeRuling(event.target.value)}>
                                <option value="played">Played normally</option>
                                <option value="away_forfeited">Away team forfeited — home win</option>
                                <option value="home_forfeited">Home team forfeited — away win</option>
                                <option value="double_forfeit">{stage === 'knockout' ? 'Both teams forfeited — both eliminated' : 'Both teams forfeited — 0-0, zero points'}</option>
                              </select>
                            </label>
                            {ruling === 'double_forfeit' && <label>Double-forfeit reason
                              <input value={resultNote} onChange={(event) => setResultNote(event.target.value)} placeholder="Required — why neither team fulfilled the fixture" />
                            </label>}
                          </div>

                          {stage === 'knockout' && ruling === 'played' && draft.snapshot && !draft.oneLeg && <div className="ready-banner">
                            <strong>Live tie calculation</strong>
                            <span>Aggregate after normal time: {draft.snapshot.firstAgg}–{draft.snapshot.secondAgg} · Away goals: {draft.snapshot.firstAway}–{draft.snapshot.secondAway}{draft.snapshot.reason === 'away_goals' ? ' · decided on away goals' : draft.snapshot.reason === 'aggregate' ? ' · decided on aggregate' : draft.requiresFet ? ' · level: FET required' : ''}</span>
                          </div>}

                          {draft.requiresFet && ruling === 'played' && <div className="fet-editor">
                            <p className="eyebrow">Fictional Extra Time</p>
                            <p className="muted">The tie is still level after {draft.oneLeg ? 'normal time' : 'aggregate and away goals'}. Enter the match stats and the app awards FET goals progressively.</p>
                            <div className="mini-grid">
                              <label>{homeName} possession %
                                <input type="number" min="0" max="100" step="0.1" value={fetStats.home_possession} onChange={(event) => { setFetStats((current) => ({ ...current, home_possession: event.target.value })); setManualFetWinner(''); }} />
                              </label>
                              <label>{awayName} possession %
                                <input type="number" min="0" max="100" step="0.1" value={fetStats.away_possession} onChange={(event) => { setFetStats((current) => ({ ...current, away_possession: event.target.value })); setManualFetWinner(''); }} />
                              </label>
                              <label>{homeName} shots on target
                                <input type="number" min="0" step="1" value={fetStats.home_shots_on_target} onChange={(event) => { setFetStats((current) => ({ ...current, home_shots_on_target: event.target.value })); setManualFetWinner(''); }} />
                              </label>
                              <label>{awayName} shots on target
                                <input type="number" min="0" step="1" value={fetStats.away_shots_on_target} onChange={(event) => { setFetStats((current) => ({ ...current, away_shots_on_target: event.target.value })); setManualFetWinner(''); }} />
                              </label>
                            </div>
                            {fet?.valid && <div className="ready-banner ready">
                              <strong>FET: {homeName} {fet.homeGoals}–{fet.awayGoals} {awayName}</strong>
                              <span>{fet.steps.map((step) => describeFetStep(step, homeName, awayName)).join(' · ')}</span>
                              {fet.resolved && <span>Final score after FET: {draftHome + fet.homeGoals}–{draftAway + fet.awayGoals}</span>}
                              {!fet.resolved && <>
                                <span>Every FET criterion is exactly level. Use a manual organiser decision rather than altering the source stats.</span>
                                <label>Manual decider
                                  <select value={manualFetWinner} onChange={(event) => setManualFetWinner(event.target.value)}>
                                    <option value="">Choose winner</option>
                                    <option value="home">{homeName}</option>
                                    <option value="away">{awayName}</option>
                                  </select>
                                </label>
                                {manualFetWinner && <span>Manual deciding FET goal: {manualFetWinner === 'home' ? homeName : awayName} +1.</span>}
                              </>}
                            </div>}
                          </div>}

                          <p className="muted">{stage === 'knockout'
                            ? 'Enter the score at the end of normal time. For two-leg ties the app calculates aggregate and away goals automatically. FET appears only when the tie remains level; its goals are derived from possession, shots on target, then possession + shots on target as the tiebreak. If every criterion is exactly tied, the organiser can record the manual decider without falsifying the stats.'
                            : 'Single forfeits use the normal 3–0 minimum (or a better played scoreline). A double forfeit is always recorded 0–0, gives both teams a loss and zero points, and records both managers in the Forfeits register.'}</p>
                          <div className="button-row">
                            <button type="button" onClick={() => saveOfficialResult(fixture)} disabled={loading}>Save official result</button>
                            <button type="button" className="secondary" onClick={cancelEdit} disabled={loading}>Cancel</button>
                          </div>
                        </div>
                      ) : !resultLockReason ? (
                        <div className="button-row">
                          <button type="button" className="secondary" onClick={() => startEdit(fixture)} disabled={loading}>{completed ? 'Edit official result' : 'Enter official result'}</button>
                          {completed && <button type="button" className="danger" onClick={() => resetResult(fixture)} disabled={loading}>Reset result</button>}
                          {!completed && stage === 'group' && <label className="inline-date-control">New date<input type="date" value={rescheduleDates[fixture.id] || fixture.fixture_date || ''} onChange={(event) => setRescheduleDates((current) => ({ ...current, [fixture.id]: event.target.value }))} /></label>}
                          {!completed && stage === 'group' && <button type="button" className="secondary" onClick={() => rescheduleFixture(fixture)} disabled={loading}>Reschedule</button>}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
