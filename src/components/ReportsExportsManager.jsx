import { useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import {
  analyseMatchday,
  buildSnapshot,
  csvFiles,
  downloadText,
  generateMatchdayMarkdown,
  groupRounds,
  slugifyFilename,
} from '../lib/tournamentReports';

export default function ReportsExportsManager({ selectedTournament }) {
  const [snapshot, setSnapshot] = useState(null);
  const [selectedRound, setSelectedRound] = useState('');
  const [markdown, setMarkdown] = useState('');
  const [status, setStatus] = useState('Load the current tournament snapshot to begin.');
  const [loading, setLoading] = useState(false);
  const rounds = useMemo(() => snapshot ? groupRounds(snapshot) : [], [snapshot]);
  const baseName = slugifyFilename(selectedTournament?.name || 'tournament');

  async function loadSnapshot() {
    if (!selectedTournament?.id || !hasSupabaseConfig || !supabase) return;
    setLoading(true);
    setStatus('Building tournament snapshot...');
    try {
      const tournamentId = selectedTournament.id;
      const [entriesResult, groupsResult, matchesResult, roundDatesResult, honoursResult] = await Promise.all([
        supabase.from('tournament_entries').select('id, tournament_id, team_id, manager_id, seed, rating, group_code, pot, prize_draw_eligible, teams(id, name), managers(id, name, display_name)').eq('tournament_id', tournamentId).order('seed', { ascending: true }),
        supabase.from('groups').select('id, tournament_id, code, name, group_order').eq('tournament_id', tournamentId).order('group_order', { ascending: true }),
        supabase.from('matches').select('id, tournament_id, stage, round, leg, match_order, fixture_date, home_entry_id, away_entry_id, home_score, away_score, winner_entry_id, loser_entry_id, decided_by, status, bracket, home_placeholder, away_placeholder, groups(id, code, name), home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(id, name), managers(id, name, display_name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(id, name), managers(id, name, display_name))').eq('tournament_id', tournamentId).order('match_order', { ascending: true }),
        supabase.from('tournament_round_dates').select('id, tournament_id, bracket, round, leg1_date, leg2_date').eq('tournament_id', tournamentId),
        supabase.from('honours').select('id, honour, position, tournament_id, entry:tournament_entries!honours_entry_id_fkey(id, teams(id, name), managers(id, name, display_name))').eq('tournament_id', tournamentId),
      ]);

      const fatal = [entriesResult, matchesResult].find((result) => result.error);
      if (fatal) throw fatal.error;
      const matchIds = (matchesResult.data || []).map((match) => match.id);
      let forfeits = [];
      if (matchIds.length) {
        const forfeitResult = await supabase.from('forfeits').select('id, match_id, forfeiting_entry_id, reason, penalty, affects_prize_draw, forfeiting_entry:tournament_entries!forfeits_forfeiting_entry_id_fkey(id, teams(id, name), managers(id, name, display_name))').in('match_id', matchIds);
        if (!forfeitResult.error) forfeits = forfeitResult.data || [];
      }

      const nextSnapshot = buildSnapshot({
        tournament: selectedTournament,
        entries: entriesResult.data || [],
        groups: groupsResult.error ? [] : (groupsResult.data || []),
        matches: matchesResult.data || [],
        roundDates: roundDatesResult.error ? [] : (roundDatesResult.data || []),
        honours: honoursResult.error ? [] : (honoursResult.data || []),
        forfeits,
      });
      setSnapshot(nextSnapshot);
      const availableRounds = groupRounds(nextSnapshot);
      setSelectedRound(availableRounds[0] || '');
      setMarkdown('');
      setStatus(`Snapshot ready: ${nextSnapshot.entrants.length} entrants, ${nextSnapshot.fixtures.length} fixtures and ${nextSnapshot.results.length} results.`);
    } catch (error) {
      setStatus(`Could not build report: ${error.message}`);
    }
    setLoading(false);
  }

  function downloadJson() {
    if (!snapshot) return;
    downloadText(`${baseName}.json`, JSON.stringify(snapshot, null, 2), 'application/json;charset=utf-8');
  }

  function downloadCsvPackage() {
    if (!snapshot) return;
    const files = csvFiles(snapshot);
    Object.entries(files).forEach(([filename, contents], index) => {
      window.setTimeout(() => downloadText(`${baseName}-${filename}`, contents, 'text/csv;charset=utf-8'), index * 180);
    });
    setStatus(`Downloading ${Object.keys(files).length} CSV files. Your browser may ask permission for multiple downloads.`);
  }

  function generateReport() {
    if (!snapshot || !selectedRound) return;
    const analysis = analyseMatchday(snapshot, selectedRound);
    const nextMarkdown = generateMatchdayMarkdown(snapshot, analysis);
    setMarkdown(nextMarkdown);
    setStatus(`${selectedRound} blog draft generated from ${analysis.matches.length} completed group results.`);
  }

  async function copyMarkdown() {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setStatus('Markdown copied to the clipboard.');
  }

  if (!selectedTournament) return <p className="muted">Create or select a tournament first.</p>;
  if (!hasSupabaseConfig || !supabase) return <p className="muted">Supabase is not connected yet.</p>;

  return <div className="reports-exports-manager">
    <section className="report-panel">
      <div>
        <p className="eyebrow">Canonical archive</p>
        <h3>Download tournament data</h3>
        <p className="muted">JSON preserves the complete tournament snapshot. The CSV package supplies separate spreadsheet-ready files for entrants, groups, fixtures, results, tables, forfeits, round dates and honours.</p>
      </div>
      <div className="button-row">
        <button type="button" onClick={loadSnapshot} disabled={loading}>{loading ? 'Building snapshot...' : snapshot ? 'Refresh snapshot' : 'Build snapshot'}</button>
        <button type="button" className="secondary" onClick={downloadJson} disabled={!snapshot}>Download JSON</button>
        <button type="button" className="secondary" onClick={downloadCsvPackage} disabled={!snapshot}>Download CSV package</button>
      </div>
    </section>

    <section className="report-panel">
      <div>
        <p className="eyebrow">Matchday story generator</p>
        <h3>What is the story of the group stage?</h3>
        <p className="muted">The draft compares current group positions with original seed expectations and identifies perfect starts, surprise packages, under-achievers, teams with a mountain to climb, statement wins and tight groups.</p>
      </div>
      <div className="report-controls">
        <label>Report through
          <select value={selectedRound} onChange={(event) => setSelectedRound(event.target.value)} disabled={!rounds.length}>
            {!rounds.length && <option value="">Load snapshot first</option>}
            {rounds.map((round) => <option key={round} value={round}>{round.replace(/^MD/i, 'Matchday ')}</option>)}
          </select>
        </label>
        <button type="button" onClick={generateReport} disabled={!snapshot || !selectedRound}>Generate blog draft</button>
      </div>
      {markdown && <>
        <div className="button-row">
          <button type="button" className="secondary" onClick={copyMarkdown}>Copy markdown</button>
          <button type="button" className="secondary" onClick={() => downloadText(`${baseName}-${selectedRound.toLowerCase()}-report.md`, markdown, 'text/markdown;charset=utf-8')}>Download .md</button>
          <button type="button" className="secondary" onClick={() => downloadText(`${baseName}-${selectedRound.toLowerCase()}-analysis.json`, JSON.stringify(analyseMatchday(snapshot, selectedRound), null, 2), 'application/json;charset=utf-8')}>Download analysis JSON</button>
        </div>
        <textarea className="report-markdown" value={markdown} onChange={(event) => setMarkdown(event.target.value)} aria-label="Generated matchday blog draft" />
      </>}
    </section>

    <p className="status">{status}</p>
  </div>;
}
