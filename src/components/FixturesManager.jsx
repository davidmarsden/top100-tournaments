import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function teamNameFromEntry(entry, fallback) {
  return entry?.teams?.name || entry?.team?.name || fallback || 'TBC';
}

function fixtureGroupLabel(fixture) {
  if (fixture.stage === 'knockout') return fixture.bracket || 'Knockout';
  return fixture.groups?.code || fixture.group_code || 'Ungrouped';
}

function groupFixtures(fixtures) {
  return fixtures.reduce((sections, fixture) => {
    const groupCode = fixtureGroupLabel(fixture);
    const round = fixture.round || 'Unscheduled';
    const key = groupCode + '|' + round;
    if (!sections[key]) sections[key] = { key, groupCode, round, fixtures: [] };
    sections[key].fixtures.push(fixture);
    return sections;
  }, {});
}

function testScore(fixture) {
  const base = Number(fixture.match_order || fixture.id || 1);
  const home = (base % 5) + 1;
  const away = base % 4;
  if (home === away) return { home_score: home + 1, away_score: away };
  return { home_score: home, away_score: away };
}

export default function FixturesManager({ selectedTournament, preview, stage = 'group', onlyOutstanding = false }) {
  const [fixtures, setFixtures] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [scores, setScores] = useState({ home_score: '', away_score: '' });
  const [groupFilter, setGroupFilter] = useState('all');

  const tournamentId = selectedTournament?.id;

  useEffect(() => {
    if (hasSupabaseConfig && supabase && tournamentId) loadFixtures();
  }, [tournamentId, stage]);

  const filteredFixtures = useMemo(() => {
    return fixtures
      .filter((fixture) => !onlyOutstanding || fixture.status !== 'played')
      .filter((fixture) => groupFilter === 'all' || fixtureGroupLabel(fixture) === groupFilter);
  }, [fixtures, onlyOutstanding, groupFilter]);

  const sections = useMemo(() => Object.values(groupFixtures(filteredFixtures)), [filteredFixtures]);
  const playedCount = fixtures.filter((fixture) => fixture.status === 'played').length;
  const groupOptions = useMemo(() => [...new Set(fixtures.map(fixtureGroupLabel))].sort(), [fixtures]);

  async function loadFixtures() {
    if (!tournamentId) return;
    setLoading(true);
    setStatus('Loading fixtures...');

    let query = supabase
      .from('matches')
      .select('id, tournament_id, group_id, stage, round, leg, match_order, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, status, played_at, home_placeholder, away_placeholder, bracket, groups(id, code, name), home_entry:tournament_entries!matches_home_entry_id_fkey(id, seed, teams(id, name), managers(id, name, display_name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, seed, teams(id, name), managers(id, name, display_name))')
      .eq('tournament_id', tournamentId)
      .order('match_order', { ascending: true });

    if (stage) query = query.eq('stage', stage);

    const { data, error } = await query;

    if (error) {
      setStatus('Could not load fixtures: ' + error.message);
      setFixtures([]);
    } else {
      setFixtures(data || []);
      setStatus((data || []).length + ' fixtures loaded.');
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

  async function updateResult(fixture, homeScore, awayScore) {
    let winnerEntryId = null;
    let loserEntryId = null;

    if (homeScore > awayScore) {
      winnerEntryId = fixture.home_entry_id;
      loserEntryId = fixture.away_entry_id;
    } else if (awayScore > homeScore) {
      winnerEntryId = fixture.away_entry_id;
      loserEntryId = fixture.home_entry_id;
    }

    return supabase
      .from('matches')
      .update({
        home_score: homeScore,
        away_score: awayScore,
        winner_entry_id: winnerEntryId,
        loser_entry_id: loserEntryId,
        status: 'played',
        played_at: new Date().toISOString(),
      })
      .eq('id', fixture.id);
  }

  async function saveResult(fixture) {
    const homeScore = Number(scores.home_score);
    const awayScore = Number(scores.away_score);

    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
      setStatus('Enter both scores before saving.');
      return;
    }

    setLoading(true);
    setStatus('Saving result...');

    const { error } = await updateResult(fixture, homeScore, awayScore);

    if (error) setStatus('Save failed: ' + error.message);
    else {
      setStatus('Result saved.');
      setEditingId(null);
      setScores({ home_score: '', away_score: '' });
      await loadFixtures();
    }

    setLoading(false);
  }

  async function autoPopulateVisible() {
    const targets = filteredFixtures.filter((fixture) => fixture.status !== 'played');
    if (!targets.length) return setStatus('No outstanding fixtures visible.');
    setLoading(true);
    setStatus('Auto-populating visible results...');

    for (const fixture of targets) {
      const score = testScore(fixture);
      const { error } = await updateResult(fixture, score.home_score, score.away_score);
      if (error) {
        setStatus('Auto-populate failed: ' + error.message);
        setLoading(false);
        return;
      }
    }

    setStatus(targets.length + ' test results saved.');
    await loadFixtures();
    setLoading(false);
  }

  async function resetResult(fixture) {
    setLoading(true);
    setStatus('Resetting result...');

    const { error } = await supabase
      .from('matches')
      .update({ home_score: null, away_score: null, winner_entry_id: null, loser_entry_id: null, status: 'scheduled', played_at: null })
      .eq('id', fixture.id);

    if (error) setStatus('Reset failed: ' + error.message);
    else {
      setStatus('Result reset.');
      await loadFixtures();
    }

    setLoading(false);
  }

  if (!selectedTournament) return <p className="muted">Create or select a tournament first.</p>;
  if (!hasSupabaseConfig || !supabase) return <p className="muted">Supabase is not connected yet.</p>;

  return (
    <div className="fixtures-manager">
      <div className="fixtures-toolbar">
        <div>
          <p className="eyebrow">{onlyOutstanding ? 'Results desk' : 'Fixture secretary'}</p>
          <h3>{playedCount} / {fixtures.length} {stage === 'knockout' ? 'knockout' : 'group'} fixtures played</h3>
          <p className="muted">{onlyOutstanding ? 'Only outstanding fixtures are shown here.' : 'Load saved fixtures, enter results, and keep the tournament moving.'}</p>
        </div>
        <div className="button-row">
          <button type="button" className="secondary" onClick={loadFixtures} disabled={loading}>Reload fixtures</button>
          <button type="button" className="secondary" onClick={autoPopulateVisible} disabled={loading}>Auto-fill visible</button>
        </div>
      </div>

      <div className="filter-row">
        <label>
          {stage === 'knockout' ? 'Bracket' : 'Group'}
          <select value={groupFilter} onChange={(event) => setGroupFilter(event.target.value)}>
            <option value="all">All</option>
            {groupOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
      </div>

      <p className="status">{status}</p>

      {fixtures.length === 0 ? (
        <div className="empty-state">
          <h3>No saved fixtures yet.</h3>
          <p className="muted">Approve the draw on the Groups tab first. The preview currently has {preview?.fixtures?.length || 0} generated fixtures.</p>
        </div>
      ) : sections.length === 0 ? (
        <div className="empty-state"><h3>No fixtures match this view.</h3><p className="muted">Try another group/bracket or reload fixtures.</p></div>
      ) : (
        <div className="fixture-sections">
          {sections.map((section) => (
            <section className="fixture-section" key={section.key}>
              <div className="fixture-section-header">
                <h3>{stage === 'knockout' ? section.groupCode : 'Group ' + section.groupCode} · {section.round}</h3>
                <span>{section.fixtures.length} fixtures</span>
              </div>
              <div className="fixture-card-list">
                {section.fixtures.map((fixture) => {
                  const homeName = teamNameFromEntry(fixture.home_entry, fixture.home_placeholder);
                  const awayName = teamNameFromEntry(fixture.away_entry, fixture.away_placeholder);
                  const isEditing = editingId === fixture.id;
                  const isPlayed = fixture.status === 'played';
                  return (
                    <article className={isPlayed ? 'fixture-card played' : 'fixture-card'} key={fixture.id}>
                      <div className="fixture-teams">
                        <strong>{homeName}</strong>
                        <span className="fixture-score">{isPlayed ? `${fixture.home_score} - ${fixture.away_score}` : 'v'}</span>
                        <strong>{awayName}</strong>
                      </div>
                      {isEditing ? (
                        <div className="result-editor">
                          <label>Home<input type="number" value={scores.home_score} onChange={(event) => setScores((current) => ({ ...current, home_score: event.target.value }))} /></label>
                          <label>Away<input type="number" value={scores.away_score} onChange={(event) => setScores((current) => ({ ...current, away_score: event.target.value }))} /></label>
                          <button type="button" onClick={() => saveResult(fixture)} disabled={loading}>Save</button>
                          <button type="button" className="secondary" onClick={cancelEdit} disabled={loading}>Cancel</button>
                        </div>
                      ) : (
                        <div className="fixture-actions">
                          <span>{fixture.status || 'scheduled'}</span>
                          <button type="button" className="secondary" onClick={() => startEdit(fixture)}>{isPlayed ? 'Edit result' : 'Enter result'}</button>
                          {isPlayed && <button type="button" className="danger" onClick={() => resetResult(fixture)} disabled={loading}>Reset</button>}
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
