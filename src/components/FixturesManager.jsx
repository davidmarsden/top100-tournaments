import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function teamNameFromEntry(entry, fallback) {
  return entry?.teams?.name || entry?.team?.name || fallback || 'TBC';
}

function isCompleted(fixture) {
  return fixture.status === 'played' || fixture.status === 'forfeit';
}

function fixtureGroupLabel(fixture) {
  if (fixture.stage === 'knockout') return fixture.bracket || 'Knockout';
  return fixture.groups?.code || fixture.group_code || 'Ungrouped';
}

function roundLabel(fixture) {
  return fixture.round || 'Unscheduled';
}

function groupFixtures(fixtures) {
  return fixtures.reduce((sections, fixture) => {
    const groupCode = fixtureGroupLabel(fixture);
    const round = roundLabel(fixture);
    const key = groupCode + '|' + round;
    if (!sections[key]) sections[key] = { key, groupCode, round, fixtures: [] };
    sections[key].fixtures.push(fixture);
    return sections;
  }, {});
}

function testScore(fixture) {
  const base = Number(fixture.match_order || fixture.id || 1) + (fixture.round || '').length + Number(fixture.leg || 1);
  const home = (base % 5) + 1;
  const away = base % 4;
  if (home === away) return { home_score: home + 1, away_score: away };
  return { home_score: home, away_score: away };
}

function knockoutTieKey(fixture) {
  return [fixture.bracket || 'Knockout', fixture.round || 'Round', fixture.match_order || 0].join('|');
}

function buildTieSummaries(fixtures) {
  const ties = new Map();
  fixtures.filter((fixture) => fixture.stage === 'knockout').forEach((fixture) => {
    const key = knockoutTieKey(fixture);
    if (!ties.has(key)) ties.set(key, []);
    ties.get(key).push(fixture);
  });

  const summaries = new Map();
  ties.forEach((legs, key) => {
    const completedLegs = legs.filter(isCompleted);
    if (!completedLegs.length) return;

    const orderedLegs = [...legs].sort((a, b) => Number(a.leg || 1) - Number(b.leg || 1));
    const first = orderedLegs[0];
    const firstTeamId = first.home_entry_id;
    const secondTeamId = first.away_entry_id;
    const firstName = teamNameFromEntry(first.home_entry, first.home_placeholder);
    const secondName = teamNameFromEntry(first.away_entry, first.away_placeholder);

    let firstAggregate = 0;
    let secondAggregate = 0;
    let firstAwayGoals = 0;
    let secondAwayGoals = 0;

    completedLegs.forEach((leg) => {
      const homeScore = Number(leg.home_score || 0);
      const awayScore = Number(leg.away_score || 0);
      if (leg.home_entry_id === firstTeamId) {
        firstAggregate += homeScore;
        secondAggregate += awayScore;
        secondAwayGoals += awayScore;
      } else {
        firstAggregate += awayScore;
        secondAggregate += homeScore;
        firstAwayGoals += awayScore;
      }
    });

    let detail = `Aggregate: ${firstName} ${firstAggregate}-${secondAggregate} ${secondName}`;
    if (orderedLegs.length > 1 && completedLegs.length === orderedLegs.length) {
      if (firstAggregate === secondAggregate) {
        if (firstAwayGoals !== secondAwayGoals) {
          detail += firstAwayGoals > secondAwayGoals
            ? ` · ${firstName} lead on away goals (${firstAwayGoals}-${secondAwayGoals})`
            : ` · ${secondName} lead on away goals (${secondAwayGoals}-${firstAwayGoals})`;
        } else {
          detail += ' · Away goals level — Fictional Extra Time needed';
        }
      }
    } else if (orderedLegs.length > 1) {
      detail += ' · tie in progress';
    } else if (firstAggregate === secondAggregate && completedLegs.length === 1) {
      detail += ' · Fictional Extra Time needed';
    }

    summaries.set(key, detail);
  });

  return summaries;
}

export default function FixturesManager({ selectedTournament, preview, stage = 'group', onlyOutstanding = false, onlyCompleted = false }) {
  const [fixtures, setFixtures] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [scores, setScores] = useState({ home_score: '', away_score: '' });
  const [groupFilter, setGroupFilter] = useState('all');
  const [roundFilter, setRoundFilter] = useState('all');
  const [roundDate, setRoundDate] = useState('');

  const tournamentId = selectedTournament?.id;

  useEffect(() => {
    if (hasSupabaseConfig && supabase && tournamentId) loadFixtures();
  }, [tournamentId, stage]);

  const filteredFixtures = useMemo(() => {
    return fixtures
      .filter((fixture) => !onlyOutstanding || !isCompleted(fixture))
      .filter((fixture) => !onlyCompleted || isCompleted(fixture))
      .filter((fixture) => groupFilter === 'all' || fixtureGroupLabel(fixture) === groupFilter)
      .filter((fixture) => roundFilter === 'all' || roundLabel(fixture) === roundFilter);
  }, [fixtures, onlyOutstanding, onlyCompleted, groupFilter, roundFilter]);

  const sections = useMemo(() => Object.values(groupFixtures(filteredFixtures)), [filteredFixtures]);
  const tieSummaries = useMemo(() => buildTieSummaries(fixtures), [fixtures]);
  const playedCount = fixtures.filter(isCompleted).length;
  const groupOptions = useMemo(() => [...new Set(fixtures.map(fixtureGroupLabel))].sort(), [fixtures]);
  const roundOptions = useMemo(() => [...new Set(fixtures.map(roundLabel))].sort((a, b) => {
    const order = ['R32', 'R16', 'QF', 'SF', 'Final'];
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.localeCompare(b, undefined, { numeric: true });
  }), [fixtures]);

  async function loadFixtures() {
    if (!tournamentId) return;
    setLoading(true);
    setStatus('Loading from database...');

    let query = supabase
      .from('matches')
      .select('id, tournament_id, group_id, stage, round, leg, match_order, fixture_date, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, status, played_at, home_placeholder, away_placeholder, bracket, groups(id, code, name), home_entry:tournament_entries!matches_home_entry_id_fkey(id, seed, teams(id, name), managers(id, name, display_name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, seed, teams(id, name), managers(id, name, display_name))')
      .eq('tournament_id', tournamentId)
      .order('match_order', { ascending: true });

    if (stage) query = query.eq('stage', stage);

    const { data, error } = await query;

    if (error) {
      setStatus('Could not load fixtures: ' + error.message);
      setFixtures([]);
    } else {
      setFixtures(data || []);
      setStatus((data || []).length + ' fixtures loaded from database.');
    }

    setLoading(false);
  }

  function startEdit(fixture) {
    setEditingId(fixture.id);
    setScores({ home_score: fixture.home_score ?? '', away_score: fixture.away_score ?? '' });
  }

  function cancelEdit() {
    setEditingId(null);
    setScores({ home_score: '', away_score: '' });
  }

  async function updateResult(fixture, homeScore, awayScore, resultStatus = 'played') {
    let winnerEntryId = null;
    let loserEntryId = null;

    if (homeScore > awayScore) {
      winnerEntryId = fixture.home_entry_id;
      loserEntryId = fixture.away_entry_id;
    } else if (awayScore > homeScore) {
      winnerEntryId = fixture.away_entry_id;
      loserEntryId = fixture.home_entry_id;
    }

    return supabase.from('matches').update({ home_score: homeScore, away_score: awayScore, winner_entry_id: winnerEntryId, loser_entry_id: loserEntryId, status: resultStatus, played_at: new Date().toISOString() }).eq('id', fixture.id);
  }

  async function saveResult(fixture) {
    const homeScore = Number(scores.home_score);
    const awayScore = Number(scores.away_score);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return setStatus('Enter both scores before saving.');
    setLoading(true);
    setStatus('Saving result...');
    const { error } = await updateResult(fixture, homeScore, awayScore);
    if (error) setStatus('Save failed: ' + error.message);
    else {
      setStatus('Result saved and view refreshed.');
      setEditingId(null);
      setScores({ home_score: '', away_score: '' });
      await loadFixtures();
    }
    setLoading(false);
  }

  async function saveForfeit(fixture, forfeitingSide) {
    const homeScore = forfeitingSide === 'home' ? 0 : 3;
    const awayScore = forfeitingSide === 'away' ? 0 : 3;
    setLoading(true);
    setStatus('Saving forfeit...');
    const { error } = await updateResult(fixture, homeScore, awayScore, 'forfeit');
    if (error) setStatus('Forfeit failed: ' + error.message);
    else {
      setStatus('Forfeit saved as a 3-0 result and view refreshed.');
      await loadFixtures();
    }
    setLoading(false);
  }

  async function autoPopulateVisible() {
    const targets = filteredFixtures.filter((fixture) => !isCompleted(fixture));
    if (!targets.length) return setStatus('No outstanding fixtures visible.');
    setLoading(true);
    setStatus('Saving test scores for visible fixtures...');

    for (const fixture of targets) {
      const score = testScore(fixture);
      const { error } = await updateResult(fixture, score.home_score, score.away_score);
      if (error) {
        setStatus('Auto-fill failed: ' + error.message);
        setLoading(false);
        return;
      }
    }

    await loadFixtures();
    setStatus(targets.length + ' test results saved and view refreshed.');
    setLoading(false);
  }

  async function setVisibleRoundDate() {
    if (!roundDate) return setStatus('Choose a date first.');
    const targets = filteredFixtures.map((fixture) => fixture.id);
    if (!targets.length) return setStatus('No fixtures visible to date.');
    setLoading(true);
    setStatus('Saving fixture dates...');
    const { error } = await supabase.from('matches').update({ fixture_date: roundDate }).in('id', targets);
    if (error) setStatus('Date save failed: ' + error.message);
    else {
      setStatus('Date applied to ' + targets.length + ' visible fixtures and view refreshed.');
      await loadFixtures();
    }
    setLoading(false);
  }

  async function resetResult(fixture) {
    setLoading(true);
    setStatus('Resetting result...');
    const { error } = await supabase.from('matches').update({ home_score: null, away_score: null, winner_entry_id: null, loser_entry_id: null, status: 'scheduled', played_at: null }).eq('id', fixture.id);
    if (error) setStatus('Reset failed: ' + error.message);
    else {
      setStatus('Result reset and view refreshed.');
      await loadFixtures();
    }
    setLoading(false);
  }

  if (!selectedTournament) return <p className="muted">Create or select a tournament first.</p>;
  if (!hasSupabaseConfig || !supabase) return <p className="muted">Supabase is not connected yet.</p>;

  const titleText = onlyCompleted ? 'Results archive' : onlyOutstanding ? 'Fixture list' : stage === 'knockout' ? 'Knockout results' : 'Fixture secretary';
  const explainer = onlyCompleted
    ? 'Only played results are shown here. Use this page to review, edit or reset saved results.'
    : onlyOutstanding
      ? 'Only unplayed fixtures are shown here. Results move to the Results page once saved.'
      : 'Load saved fixtures, enter results, mark forfeits and keep the tournament moving.';

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
          {!onlyCompleted && <button type="button" className="secondary" onClick={autoPopulateVisible} disabled={loading}>Auto-fill test scores</button>}
        </div>
      </div>

      <div className="filter-row multi">
        <label>
          {stage === 'knockout' ? 'Bracket' : 'Group'}
          <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
            <option value="all">All</option>
            {groupOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label>
          Round
          <select value={roundFilter} onChange={(event) => setRoundFilter(event.target.value)}>
            <option value="all">All</option>
            {roundOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        {!onlyCompleted && (
          <>
            <label>
              Apply date to visible fixtures
              <input type="date" value={roundDate} onChange={(event) => setRoundDate(event.target.value)} />
            </label>
            <button type="button" className="secondary" onClick={setVisibleRoundDate} disabled={loading}>Set date</button>
          </>
        )}
      </div>

      <p className="status">{status}</p>

      {fixtures.length === 0 ? (
        <div className="empty-state"><h3>No saved fixtures yet.</h3><p className="muted">Approve the draw on the Groups tab first. The preview currently has {preview?.fixtures?.length || 0} generated fixtures.</p></div>
      ) : sections.length === 0 ? (
        <div className="empty-state"><h3>No fixtures match this view.</h3><p className="muted">Try another group/bracket, round, or reload from the database.</p></div>
      ) : (
        <div className="fixture-sections">
          {sections.map((section) => (
            <section className="fixture-section" key={section.key}>
              <div className="fixture-section-header"><h3>{stage === 'knockout' ? section.groupCode : 'Group ' + section.groupCode} · {section.round}</h3><span>{section.fixtures.length} fixtures</span></div>
              <div className="fixture-card-list">
                {section.fixtures.map((fixture) => {
                  const homeName = teamNameFromEntry(fixture.home_entry, fixture.home_placeholder);
                  const awayName = teamNameFromEntry(fixture.away_entry, fixture.away_placeholder);
                  const isEditing = editingId === fixture.id;
                  const completed = isCompleted(fixture);
                  const aggregate = stage === 'knockout' ? tieSummaries.get(knockoutTieKey(fixture)) : null;
                  return (
                    <article className={completed ? 'fixture-card played' : 'fixture-card'} key={fixture.id}>
                      <div className="fixture-teams"><strong>{homeName}</strong><span className="fixture-score">{completed ? `${fixture.home_score} - ${fixture.away_score}` : 'v'}</span><strong>{awayName}</strong></div>
                      {fixture.fixture_date && <p className="fixture-date">{fixture.fixture_date}</p>}
                      {aggregate && <p className="aggregate-line">{aggregate}</p>}
                      {isEditing ? (
                        <div className="result-editor">
                          <label>Home<input type="number" value={scores.home_score} onChange={(event) => setScores((current) => ({ ...current, home_score: event.target.value }))} /></label>
                          <label>Away<input type="number" value={scores.away_score} onChange={(event) => setScores((current) => ({ ...current, away_score: event.target.value }))} /></label>
                          <button type="button" onClick={() => saveResult(fixture)} disabled={loading}>Save</button>
                          <button type="button" className="secondary" onClick={cancelEdit} disabled={loading}>Cancel</button>
                        </div>
                      ) : (
                        <div className="fixture-actions">
                          <span>{fixture.status || 'scheduled'}{fixture.leg ? ' · Leg ' + fixture.leg : ''}</span>
                          <button type="button" className="secondary" onClick={() => startEdit(fixture)}>{completed ? 'Edit result' : 'Enter result'}</button>
                          {!completed && <button type="button" className="danger" onClick={() => saveForfeit(fixture, 'home')} disabled={loading}>Home forfeit</button>}
                          {!completed && <button type="button" className="danger" onClick={() => saveForfeit(fixture, 'away')} disabled={loading}>Away forfeit</button>}
                          {completed && <button type="button" className="danger" onClick={() => resetResult(fixture)} disabled={loading}>Reset</button>}
                        </div>
                      )}
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
