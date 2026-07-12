import { useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function testScore(fixture) {
  const base = Number(fixture.match_order || fixture.id || 1) + String(fixture.round || '').length + Number(fixture.leg || 1);
  const home = (base % 5) + 1;
  const away = base % 4;
  return home === away ? { home_score: home + 1, away_score: away } : { home_score: home, away_score: away };
}

export default function ResultsTestControls({ selectedTournament, onDataChanged }) {
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');

  async function autoFillOutstanding() {
    if (!selectedTournament?.id || !hasSupabaseConfig || !supabase) return;
    if (!window.confirm(`Auto-fill every outstanding group result for ${selectedTournament.name}?`)) return;

    setLoading(true);
    setStatus('Loading outstanding fixtures...');

    try {
      const { data, error } = await supabase
        .from('matches')
        .select('id, match_order, round, leg, home_entry_id, away_entry_id, status')
        .eq('tournament_id', selectedTournament.id)
        .eq('stage', 'group')
        .not('status', 'in', '(played,forfeit)');
      if (error) throw error;

      const fixtures = data || [];
      if (!fixtures.length) {
        setStatus('There are no outstanding group fixtures to fill.');
        setLoading(false);
        return;
      }

      for (const fixture of fixtures) {
        const score = testScore(fixture);
        const winnerEntryId = score.home_score > score.away_score ? fixture.home_entry_id : score.away_score > score.home_score ? fixture.away_entry_id : null;
        const loserEntryId = score.home_score > score.away_score ? fixture.away_entry_id : score.away_score > score.home_score ? fixture.home_entry_id : null;
        const { error: updateError } = await supabase.from('matches').update({
          home_score: score.home_score,
          away_score: score.away_score,
          winner_entry_id: winnerEntryId,
          loser_entry_id: loserEntryId,
          status: 'played',
          played_at: new Date().toISOString(),
        }).eq('id', fixture.id);
        if (updateError) throw updateError;
      }

      setStatus(`${fixtures.length} test results saved. Reloading the Results archive...`);
      await onDataChanged?.();
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      setStatus('Auto-fill failed: ' + error.message);
    } finally {
      setLoading(false);
    }
  }

  return <section className="entrant-panel results-test-controls">
    <div className="draw-actions">
      <div><p className="eyebrow">Test harness</p><h3>Populate group results</h3><p className="muted">For test tournaments, fill every outstanding group fixture and move the builder on to the knockout stage.</p></div>
      <button type="button" className="secondary" onClick={autoFillOutstanding} disabled={loading}>{loading ? 'Saving test results...' : 'Auto-fill outstanding results'}</button>
    </div>
    {status && <p className="status">{status}</p>}
  </section>;
}
