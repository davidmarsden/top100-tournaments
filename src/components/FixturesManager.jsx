import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function teamNameFromEntry(entry, fallback) {
  return entry?.teams?.name || entry?.team?.name || fallback || 'TBC';
}

function groupFixtures(fixtures) {
  return fixtures.reduce((sections, fixture) => {
    const groupCode = fixture.groups?.code || fixture.group_code || 'Ungrouped';
    const round = fixture.round || 'Unscheduled';
    const key = groupCode + '|' + round;
    if (!sections[key]) {
      sections[key] = { key, groupCode, round, fixtures: [] };
    }
    sections[key].fixtures.push(fixture);
    return sections;
  }, {});
}

export default function FixturesManager({ selectedTournament, preview }) {
  const [fixtures, setFixtures] = useState([]);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [scores, setScores] = useState({ home_score: '', away_score: '' });

  const tournamentId = selectedTournament?.id;

  useEffect(() => {
    if (hasSupabaseConfig && supabase && tournamentId) {
      loadFixtures();
    }
  }, [tournamentId]);

  const sections = useMemo(() => Object.values(groupFixtures(fixtures)), [fixtures]);
  const playedCount = fixtures.filter((fixture) => fixture.status === 'played').length;

  async function loadFixtures() {
    if (!tournamentId) return;
    setLoading(true);
    setStatus('Loading fixtures...');

    const { data, error } = await supabase
      .from('matches')
      .select('id, tournament_id, group_id, round, leg, match_order, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, status, played_at, home_placeholder, away_placeholder, bracket, groups(id, code, name), home_entry:tournament_entries!matches_home_entry_id_fkey(id, seed, teams(id, name), managers(id, name, display_name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, seed, teams(id, name), managers(id, name, display_name))')
      .eq('tournament_id', tournamentId)
      .order('match_order', { ascending: true });

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
    setScores({
      home_score: fixture.home_score ?? '',
      away_score: fixture.away_score ?? '',
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setScores({ home_score: '', away_score: '' });
  }

  async function saveResult(fixture) {
    const homeScore = Number(scores.home_score);
    const awayScore = Number(scores.away_score);

    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) {
      setStatus('Enter both scores before saving.');
      return;
    }

    let winnerEntryId = null;
    let loserEntryId = null;

    if (homeScore > awayScore) {
      winnerEntryId = fixture.home_entry_id;
      loserEntryId = fixture.away_entry_id;
    } else if (awayScore > homeScore) {
      winnerEntryId = fixture.away_entry_id;
      loserEntryId = fixture.home_entry_id;
    }

    setLoading(true);
    setStatus('Saving result...');

    const { error } = await supabase
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

    if (error) {
      setStatus('Save failed: ' + error.message);
    } else {
      setStatus('Result saved.');
      setEditingId(null);
      setScores({ home_score: '', away_score: '' });
      await loadFixtures();
    }

    setLoading(false);
  }

  async function resetResult(fixture) {
    setLoading(true);
    setStatus('Resetting result...');

    const { error } = await supabase
      .from('matches')
      .update({
        home_score: null,
        away_score: null,
        winner_entry_id: null,
        loser_entry_id: null,
        status: 'scheduled',
        played_at: null,
      })
      .eq('id', fixture.id);

    if (error) {
      setStatus('Reset failed: ' + error.message);
    } else {
      setStatus('Result reset.');
      await loadFixtures();
    }

    setLoading(false);
  }

  if (!selectedTournament) {
    return <p className="muted">Create or select a tournament first.</p>;
  }

  if (!hasSupabaseConfig || !supabase) {
    return <p className="muted">Supabase is not connected yet.</p>;
  }

  return (
    <div className="fixtures-manager">
      <div className="fixtures-toolbar">
        <div>
          <p className="eyebrow">Fixture secretary</p>
          <h3>{playedCount} / {fixtures.length} played</h3>
          <p className="muted">Load saved fixtures, enter results, and keep the tournament moving.</p>
        </div>
        <button type="button" className="secondary" onClick={loadFixtures} disabled={loading}>Reload fixtures</button>
      </div>

      <p className="status">{status}</p>

      {fixtures.length === 0 ? (
        <div className="empty-state">
          <h3>No saved fixtures yet.</h3>
          <p className="muted">Approve the draw on the Groups tab first. The preview currently has {preview?.fixtures?.length || 0} generated fixtures.</p>
        </div>
      ) : (
        <div className="fixture-sections">
          {sections.map((section) => (
            <section className="fixture-section" key={section.key}>
              <div className="fixture-section-header">
                <h3>Group {section.groupCode} · {section.round}</h3>
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
                        <span className="fixture-score">
                          {isPlayed ? `${fixture.home_score} - ${fixture.away_score}` : 'v'}
                        </span>
                        <strong>{awayName}</strong>
                      </div>

                      {isEditing ? (
                        <div className="result-editor">
                          <label>
                            Home
                            <input type="number" value={scores.home_score} onChange={(event) => setScores((current) => ({ ...current, home_score: event.target.value }))} />
                          </label>
                          <label>
                            Away
                            <input type="number" value={scores.away_score} onChange={(event) => setScores((current) => ({ ...current, away_score: event.target.value }))} />
                          </label>
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
