import { useEffect, useMemo, useState } from 'react';
import FixturesManager from './FixturesManager.jsx';
import KnockoutScheduleManager from './KnockoutScheduleManager.jsx';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const FALLBACK_ROUNDS = [
  { bracket: 'Cup', round_name: 'R32', round_order: 1, legs: 1, loser_to_bracket: 'Shield' },
  { bracket: 'Cup', round_name: 'R16', round_order: 2, legs: 2 },
  { bracket: 'Cup', round_name: 'QF', round_order: 3, legs: 2 },
  { bracket: 'Cup', round_name: 'SF', round_order: 4, legs: 2 },
  { bracket: 'Cup', round_name: 'Final', round_order: 5, legs: 2 },
  { bracket: 'Shield', round_name: 'R32', round_order: 1, legs: 1 },
  { bracket: 'Shield', round_name: 'R16', round_order: 2, legs: 1 },
  { bracket: 'Shield', round_name: 'QF', round_order: 3, legs: 2 },
  { bracket: 'Shield', round_name: 'SF', round_order: 4, legs: 2 },
  { bracket: 'Shield', round_name: 'Final', round_order: 5, legs: 2 },
];

const FALLBACK_RULES = [
  { bracket: 'Cup', source_stage: 'group', group_position: 1, rank_order: 1, destination_round: 'R32' },
  { bracket: 'Cup', source_stage: 'group', group_position: 2, rank_order: 2, destination_round: 'R32' },
  { bracket: 'Shield', source_stage: 'group', group_position: 3, rank_order: 1, destination_round: 'R32' },
  { bracket: 'Shield', source_stage: 'drop', drop_from_bracket: 'Cup', rank_order: 2, destination_round: 'R32' },
];

function isCompleted(match) {
  return match.status === 'played' || match.status === 'forfeit';
}

function roundKey(round) {
  return round.round_name || round.name || round.round;
}

function roundSort(rounds, a, b) {
  const aRound = rounds.find((round) => round.bracket === a.bracket && roundKey(round) === a.round);
  const bRound = rounds.find((round) => round.bracket === b.bracket && roundKey(round) === b.round);
  return String(a.bracket || '').localeCompare(String(b.bracket || ''))
    || Number(aRound?.round_order || 99) - Number(bRound?.round_order || 99)
    || Number(a.match_order || 0) - Number(b.match_order || 0)
    || Number(a.leg || 1) - Number(b.leg || 1);
}

function blankRow(entry) {
  return {
    entry_id: entry.id,
    seed: entry.seed,
    team_name: entry.teams?.name || 'Unknown team',
    manager_name: entry.managers?.display_name || entry.managers?.name || 'TBC',
    group_code: entry.group_code,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals_for: 0,
    goals_against: 0,
    goal_difference: 0,
    points: 0,
  };
}

function compareRows(a, b) {
  return b.points - a.points
    || b.goal_difference - a.goal_difference
    || b.goals_for - a.goals_for
    || Number(a.seed || 999) - Number(b.seed || 999)
    || a.team_name.localeCompare(b.team_name);
}

function buildTables(entries, matches) {
  const byGroup = entries.reduce((groups, entry) => {
    const code = entry.group_code || 'Ungrouped';
    if (!groups[code]) groups[code] = [];
    groups[code].push(entry);
    return groups;
  }, {});

  return Object.entries(byGroup).sort(([a], [b]) => a.localeCompare(b)).map(([groupCode, groupEntries]) => {
    const rowsById = new Map(groupEntries.map((entry) => [entry.id, blankRow(entry)]));

    matches
      .filter((match) => (match.groups?.code || groupCode) === groupCode)
      .filter(isCompleted)
      .forEach((match) => {
        const home = rowsById.get(match.home_entry_id);
        const away = rowsById.get(match.away_entry_id);
        if (!home || !away) return;
        const homeScore = Number(match.home_score || 0);
        const awayScore = Number(match.away_score || 0);
        home.played += 1;
        away.played += 1;
        home.goals_for += homeScore;
        home.goals_against += awayScore;
        away.goals_for += awayScore;
        away.goals_against += homeScore;
        if (homeScore > awayScore) {
          home.wins += 1;
          home.points += 3;
          away.losses += 1;
        } else if (awayScore > homeScore) {
          away.wins += 1;
          away.points += 3;
          home.losses += 1;
        } else {
          home.draws += 1;
          away.draws += 1;
          home.points += 1;
          away.points += 1;
        }
      });

    const rows = [...rowsById.values()]
      .map((row) => ({ ...row, goal_difference: row.goals_for - row.goals_against }))
      .sort(compareRows)
      .map((row, index) => ({ ...row, group_position: index + 1 }));

    return { groupCode, rows };
  });
}

function qualifiersForRules(tables, rules, bracket, destinationRound) {
  return rules
    .filter((rule) => rule.bracket === bracket && rule.destination_round === destinationRound && rule.source_stage === 'group')
    .sort((a, b) => Number(a.rank_order || 0) - Number(b.rank_order || 0))
    .flatMap((rule) => tables
      .flatMap((table) => table.rows.filter((row) => row.group_position === Number(rule.group_position)))
      .sort(compareRows)
      .slice(0, rule.slots || undefined)
      .map((row, index) => ({ ...row, knockout_seed: index + 1, rule_rank: rule.rank_order }))
    )
    .map((row, index) => ({ ...row, knockout_seed: index + 1 }));
}

function entryName(entries, entryId, fallback) {
  const entry = entries.find((item) => item.id === entryId);
  return entry?.teams?.name || fallback || 'TBC';
}

function bracketRound(matches, rounds, bracket, round) {
  return [...matches]
    .filter((match) => match.stage === 'knockout' && match.bracket === bracket && match.round === round)
    .sort((a, b) => roundSort(rounds, a, b));
}

function roundsForBracket(rounds, bracket) {
  return rounds
    .filter((round) => round.bracket === bracket)
    .sort((a, b) => Number(a.round_order || 0) - Number(b.round_order || 0));
}

function nextRound(rounds, bracket, currentRound) {
  const list = roundsForBracket(rounds, bracket);
  const index = list.findIndex((round) => roundKey(round) === currentRound);
  return index >= 0 ? list[index + 1] : null;
}

function latestGeneratedRound(matches, rounds, bracket) {
  const generated = roundsForBracket(rounds, bracket).filter((round) => bracketRound(matches, rounds, bracket, roundKey(round)).length > 0);
  return generated[generated.length - 1] || null;
}

function dateFor(presets, bracket, round, leg) {
  const preset = presets.find((item) => item.bracket === bracket && item.round === round);
  if (!preset) return null;
  return Number(leg) === 2 ? preset.leg2_date : preset.leg1_date;
}

function testKnockoutScore(match) {
  const base = Number(match.match_order || 1) + Number(match.leg || 1) + (match.bracket === 'Shield' ? 2 : 0);
  const home = (base % 4) + 1;
  const away = base % 3;
  return home === away ? { home_score: home + 1, away_score: away } : { home_score: home, away_score: away };
}

function winnerLoserFor(match, homeScore, awayScore) {
  if (homeScore > awayScore) return { winner_entry_id: match.home_entry_id, loser_entry_id: match.away_entry_id };
  if (awayScore > homeScore) return { winner_entry_id: match.away_entry_id, loser_entry_id: match.home_entry_id };
  return { winner_entry_id: null, loser_entry_id: null };
}

function resolveTie(legs) {
  const ordered = [...legs].sort((a, b) => Number(a.leg || 1) - Number(b.leg || 1));
  if (ordered.some((leg) => !isCompleted(leg))) return { reason: 'incomplete' };
  const first = ordered[0];
  const firstId = first.home_entry_id;
  const secondId = first.away_entry_id;
  let firstAgg = 0;
  let secondAgg = 0;
  let firstAway = 0;
  let secondAway = 0;

  ordered.forEach((leg) => {
    const homeScore = Number(leg.home_score || 0);
    const awayScore = Number(leg.away_score || 0);
    if (leg.home_entry_id === firstId) {
      firstAgg += homeScore;
      secondAgg += awayScore;
      secondAway += awayScore;
    } else {
      firstAgg += awayScore;
      secondAgg += homeScore;
      firstAway += awayScore;
    }
  });

  if (firstAgg > secondAgg) return { winnerId: firstId, loserId: secondId };
  if (secondAgg > firstAgg) return { winnerId: secondId, loserId: firstId };
  if (ordered.length > 1 && firstAway > secondAway) return { winnerId: firstId, loserId: secondId };
  if (ordered.length > 1 && secondAway > firstAway) return { winnerId: secondId, loserId: firstId };
  return { reason: 'fet_required' };
}

function tieWinners(source) {
  const ties = new Map();
  source.forEach((match) => {
    if (!ties.has(match.match_order)) ties.set(match.match_order, []);
    ties.get(match.match_order).push(match);
  });

  const winners = [];
  const unresolved = [];
  [...ties.entries()].sort(([a], [b]) => Number(a) - Number(b)).forEach(([matchOrder, legs]) => {
    const result = resolveTie(legs);
    if (result.winnerId) winners.push(result.winnerId);
    else unresolved.push({ matchOrder, reason: result.reason });
  });

  return { winners, unresolved };
}

export default function KnockoutManager({ selectedTournament, onDataChanged }) {
  const [entries, setEntries] = useState([]);
  const [matches, setMatches] = useState([]);
  const [presets, setPresets] = useState([]);
  const [roundTemplates, setRoundTemplates] = useState(FALLBACK_ROUNDS);
  const [qualificationRules, setQualificationRules] = useState(FALLBACK_RULES);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);

  const tournamentId = selectedTournament?.id;

  useEffect(() => {
    if (hasSupabaseConfig && supabase && tournamentId) loadData();
  }, [tournamentId, selectedTournament?.format_id]);

  const groupMatches = matches.filter((match) => match.stage === 'group');
  const knockoutMatches = matches.filter((match) => match.stage === 'knockout');
  const playedGroupMatches = groupMatches.filter(isCompleted);
  const groupComplete = groupMatches.length > 0 && playedGroupMatches.length === groupMatches.length;
  const tables = useMemo(() => buildTables(entries, groupMatches), [entries, groupMatches]);

  async function resolveFormatId() {
    if (selectedTournament?.format_id) return selectedTournament.format_id;
    const { data } = await supabase.from('tournament_formats').select('id').eq('name', 'Youth Cup Template').maybeSingle();
    return data?.id || null;
  }

  async function loadTemplateData(formatId) {
    if (!formatId) return { rounds: FALLBACK_ROUNDS, rules: FALLBACK_RULES };

    const [roundsResult, rulesResult] = await Promise.all([
      supabase.from('tournament_round_templates').select('id, format_id, bracket, round_name, round_order, round_type, legs, away_goals, fictional_extra_time, penalties, loser_to_bracket, notes').eq('format_id', formatId).order('bracket', { ascending: true }).order('round_order', { ascending: true }),
      supabase.from('qualification_rules').select('id, format_id, bracket, source_stage, group_position, rank_order, slots, destination_round, drop_from_bracket, notes').eq('format_id', formatId).order('bracket', { ascending: true }).order('rank_order', { ascending: true }),
    ]);

    return {
      rounds: roundsResult.error || !roundsResult.data?.length ? FALLBACK_ROUNDS : roundsResult.data,
      rules: rulesResult.error || !rulesResult.data?.length ? FALLBACK_RULES : rulesResult.data,
    };
  }

  async function loadData() {
    if (!tournamentId) return;
    setLoading(true);
    const formatId = await resolveFormatId();
    const templateData = await loadTemplateData(formatId);

    const [entriesResult, matchesResult, presetsResult] = await Promise.all([
      supabase.from('tournament_entries').select('id, tournament_id, team_id, manager_id, seed, rating, group_code, pot, teams(id, name), managers(id, name, display_name)').eq('tournament_id', tournamentId).order('seed', { ascending: true }),
      supabase.from('matches').select('id, tournament_id, group_id, stage, round, leg, match_order, fixture_date, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, status, bracket, home_placeholder, away_placeholder, groups(id, code, name)').eq('tournament_id', tournamentId).order('stage', { ascending: true }).order('bracket', { ascending: true }).order('round', { ascending: true }).order('match_order', { ascending: true }).order('leg', { ascending: true }),
      supabase.from('tournament_round_dates').select('bracket, round, leg1_date, leg2_date').eq('tournament_id', tournamentId),
    ]);

    if (entriesResult.error) setStatus('Could not load entrants: ' + entriesResult.error.message);
    else if (matchesResult.error) setStatus('Could not load matches: ' + matchesResult.error.message);
    else {
      setEntries(entriesResult.data || []);
      setMatches([...(matchesResult.data || [])].sort((a, b) => roundSort(templateData.rounds, a, b)));
      setPresets(presetsResult.error ? [] : presetsResult.data || []);
      setRoundTemplates(templateData.rounds);
      setQualificationRules(templateData.rules);
      setStatus('Knockout data loaded from database templates.');
    }
    setLoading(false);
  }

  async function insertMatches(rows, successMessage) {
    setLoading(true);
    const { error } = await supabase.from('matches').insert(rows);
    if (error) setStatus('Save failed: ' + error.message);
    else {
      setStatus(successMessage);
      await loadData();
      await onDataChanged?.();
    }
    setLoading(false);
  }

  async function generateOpeningRound(bracket) {
    if (!groupComplete) return setStatus('Group stage is not complete yet.');
    const firstRound = roundsForBracket(roundTemplates, bracket)[0];
    if (!firstRound) return setStatus('No template round exists for ' + bracket + '.');
    const firstRoundName = roundKey(firstRound);
    if (bracketRound(knockoutMatches, roundTemplates, bracket, firstRoundName).length > 0) return setStatus(`${bracket} ${firstRoundName} already exists.`);

    if (bracket === 'Shield') return generateShieldOpeningRound(firstRoundName);

    const qualifiers = qualifiersForRules(tables, qualificationRules, bracket, firstRoundName);
    const rows = [];
    qualifiers.forEach((home, index) => {
      if (index >= Math.floor(qualifiers.length / 2)) return;
      const away = qualifiers[qualifiers.length - 1 - index];
      rows.push({
        tournament_id: tournamentId,
        stage: 'knockout',
        round: firstRoundName,
        leg: 1,
        match_order: index + 1,
        home_entry_id: home.entry_id,
        away_entry_id: away.entry_id,
        home_placeholder: home.team_name,
        away_placeholder: away.team_name,
        home_seed: home.knockout_seed,
        away_seed: away.knockout_seed,
        bracket,
        fixture_date: dateFor(presets, bracket, firstRoundName, 1),
        status: 'scheduled',
      });
    });

    await insertMatches(rows, `${bracket} ${firstRoundName} saved from qualification rules.`);
  }

  async function generateShieldOpeningRound(firstRoundName) {
    const dropRule = qualificationRules.find((rule) => rule.bracket === 'Shield' && rule.source_stage === 'drop' && rule.destination_round === firstRoundName);
    const sourceBracket = dropRule?.drop_from_bracket || 'Cup';
    const sourceRound = roundsForBracket(roundTemplates, sourceBracket)[0];
    const sourceRoundName = roundKey(sourceRound || {});
    const sourceMatches = bracketRound(knockoutMatches, roundTemplates, sourceBracket, sourceRoundName);
    if (!sourceMatches.length) return setStatus(`Generate ${sourceBracket} ${sourceRoundName} first.`);
    if (sourceMatches.some((match) => !isCompleted(match) || !match.loser_entry_id)) return setStatus(`Finish ${sourceBracket} ${sourceRoundName} first.`);

    const homeTeams = qualifiersForRules(tables, qualificationRules, 'Shield', firstRoundName).filter((row) => row.rule_rank === 1 || true);
    const cupLosers = sourceMatches.map((match, index) => ({ entry_id: match.loser_entry_id, team_name: entryName(entries, match.loser_entry_id, `${sourceBracket} loser ${index + 1}`) }));
    const rows = homeTeams.map((home, index) => {
      const away = cupLosers[cupLosers.length - 1 - index];
      return {
        tournament_id: tournamentId,
        stage: 'knockout',
        round: firstRoundName,
        leg: 1,
        match_order: index + 1,
        home_entry_id: home.entry_id,
        away_entry_id: away.entry_id,
        home_placeholder: home.team_name,
        away_placeholder: away.team_name,
        home_seed: home.knockout_seed,
        bracket: 'Shield',
        fixture_date: dateFor(presets, 'Shield', firstRoundName, 1),
        status: 'scheduled',
      };
    });

    await insertMatches(rows, `Shield ${firstRoundName} saved from qualification/drop rules.`);
  }

  async function autoFillKnockout() {
    const targets = knockoutMatches.filter((match) => !isCompleted(match));
    if (!targets.length) return setStatus('No outstanding knockout fixtures to auto-fill.');
    setLoading(true);
    for (const match of targets) {
      const score = testKnockoutScore(match);
      const result = winnerLoserFor(match, score.home_score, score.away_score);
      const { error } = await supabase.from('matches').update({ ...score, ...result, status: 'played', played_at: new Date().toISOString() }).eq('id', match.id);
      if (error) {
        setStatus('Auto-fill failed: ' + error.message);
        setLoading(false);
        return;
      }
    }
    await loadData();
    await onDataChanged?.();
    setStatus(targets.length + ' knockout test result(s) saved.');
    setLoading(false);
  }

  async function generateNextRoundForBracket(bracket) {
    const latest = latestGeneratedRound(knockoutMatches, roundTemplates, bracket);
    const next = latest ? nextRound(roundTemplates, bracket, roundKey(latest)) : null;
    if (!latest || !next) return setStatus('No next round is available for ' + bracket + '.');
    const latestName = roundKey(latest);
    const nextName = roundKey(next);
    if (bracketRound(knockoutMatches, roundTemplates, bracket, nextName).length > 0) return setStatus(`${bracket} ${nextName} already exists.`);

    const { winners, unresolved } = tieWinners(bracketRound(knockoutMatches, roundTemplates, bracket, latestName));
    if (unresolved.length) return setStatus(`Cannot generate ${bracket} ${nextName}: unresolved ties remain.`);

    const rows = [];
    for (let index = 0; index < winners.length; index += 2) {
      const homeId = winners[index];
      const awayId = winners[index + 1];
      if (!awayId) continue;
      const order = index / 2 + 1;
      rows.push({
        tournament_id: tournamentId,
        stage: 'knockout',
        round: nextName,
        leg: 1,
        match_order: order,
        home_entry_id: homeId,
        away_entry_id: awayId,
        home_placeholder: entryName(entries, homeId, 'Winner ' + (index + 1)),
        away_placeholder: entryName(entries, awayId, 'Winner ' + (index + 2)),
        bracket,
        fixture_date: dateFor(presets, bracket, nextName, 1),
        status: 'scheduled',
      });
      if (Number(next.legs || 1) === 2) {
        rows.push({
          tournament_id: tournamentId,
          stage: 'knockout',
          round: nextName,
          leg: 2,
          match_order: order,
          home_entry_id: awayId,
          away_entry_id: homeId,
          home_placeholder: entryName(entries, awayId, 'Winner ' + (index + 2)),
          away_placeholder: entryName(entries, homeId, 'Winner ' + (index + 1)),
          bracket,
          fixture_date: dateFor(presets, bracket, nextName, 2),
          status: 'scheduled',
        });
      }
    }

    await insertMatches(rows, `${bracket} ${nextName} generated from round templates.`);
  }

  if (!selectedTournament) return <p className="muted">Create or select a tournament first.</p>;
  if (!hasSupabaseConfig || !supabase) return <p className="muted">Supabase is not connected yet.</p>;

  const brackets = [...new Set(roundTemplates.map((round) => round.bracket))];

  return (
    <div className="knockout-manager">
      <div className="fixtures-toolbar">
        <div>
          <p className="eyebrow">Knockout generator</p>
          <h3>{playedGroupMatches.length} / {groupMatches.length} group fixtures played</h3>
          <p className="muted">Knockout rounds, legs and qualification sources now come from database templates and rules.</p>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={loadData} disabled={loading}>Reload knockout data</button>
          {brackets.map((bracket) => {
            const first = roundsForBracket(roundTemplates, bracket)[0];
            const latest = latestGeneratedRound(knockoutMatches, roundTemplates, bracket);
            const next = latest ? nextRound(roundTemplates, bracket, roundKey(latest)) : null;
            return latest
              ? <button key={bracket} type="button" className="secondary" onClick={() => generateNextRoundForBracket(bracket)} disabled={loading || !next}>Generate {bracket} {next ? roundKey(next) : 'next'}</button>
              : <button key={bracket} type="button" onClick={() => generateOpeningRound(bracket)} disabled={loading || !groupComplete}>Generate {bracket} {first ? roundKey(first) : 'opening round'}</button>;
          })}
          <button type="button" className="secondary" onClick={autoFillKnockout} disabled={loading || knockoutMatches.every(isCompleted)}>Auto-fill knockout test scores</button>
        </div>
      </div>

      <p className="status">{status}</p>

      <div className={groupComplete ? 'ready-banner ready' : 'ready-banner'}>
        <strong>{groupComplete ? 'Group stage complete.' : 'Group stage not complete yet.'}</strong>
        <span>{groupComplete ? 'Opening knockout rounds can be generated from qualification rules.' : 'Finish all group fixtures before saving the knockout draw.'}</span>
      </div>

      <KnockoutScheduleManager selectedTournament={selectedTournament} roundTemplates={roundTemplates} onDataChanged={async () => { await loadData(); await onDataChanged?.(); }} />

      <section className="bracket-grid knockout-bracket-grid">
        {brackets.map((bracket) => <BracketColumn key={bracket} title={`Saved ${bracket}`} type={bracket.toLowerCase()} rounds={roundTemplates} matches={knockoutMatches.filter((match) => match.bracket === bracket)} />)}
      </section>

      <section className="knockout-desk-grid">
        <article className="knockout-desk-card fixtures-card">
          <h3>Knockout fixtures</h3>
          <p className="muted">Unplayed matches from database-generated rounds.</p>
          <FixturesManager selectedTournament={selectedTournament} stage="knockout" onlyOutstanding onDataChanged={onDataChanged} />
        </article>
        <article className="knockout-desk-card results-card">
          <h3>Knockout results</h3>
          <p className="muted">Played matches from database-generated rounds.</p>
          <FixturesManager selectedTournament={selectedTournament} stage="knockout" onlyCompleted onDataChanged={onDataChanged} />
        </article>
      </section>
    </div>
  );
}

function BracketColumn({ title, type, rounds, matches }) {
  const roundList = roundsForBracket(rounds, title.replace('Saved ', '')).filter((round) => matches.some((match) => match.round === roundKey(round)));
  return <article className={'bracket-section bracket-' + type}><h3>{title}</h3>{roundList.length === 0 ? <p className="muted">No saved matches yet.</p> : roundList.map((round) => <div key={roundKey(round)} className="round-block"><h4>{roundKey(round)}</h4><KnockoutList matches={[...matches].filter((match) => match.round === roundKey(round)).sort((a, b) => roundSort(rounds, a, b))} /></div>)}</article>;
}

function KnockoutList({ matches }) {
  if (!matches.length) return <p className="muted">No matches yet.</p>;
  return <div className="knockout-list">{matches.map((match) => <article className={isCompleted(match) ? 'knockout-card played' : 'knockout-card'} key={(match.bracket || 'draw') + '-' + match.round + '-' + match.match_order + '-' + (match.leg || 1) + '-' + match.home_entry_id}><span>{match.bracket || 'Knockout'} · {match.round || 'Round'}{match.leg ? ' · ' + (Number(match.leg) === 1 ? '1st leg' : '2nd leg') : ''}</span><strong>{match.home_placeholder}</strong><em>{isCompleted(match) ? `${match.home_score} - ${match.away_score}` : 'v'}</em><strong>{match.away_placeholder}</strong></article>)}</div>;
}
