import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const IMPORT_ENDPOINT = '/.netlify/functions/challonge-import';

async function readJsonResponse(response) {
  const text = await response.text();
  try { return text ? JSON.parse(text) : {}; }
  catch { throw new Error(`Server returned non-JSON (${response.status}). ${text.replace(/\s+/g, ' ').slice(0, 240)}`); }
}
function inferSeason(name) { const match = String(name || '').match(/S\s*(\d+)|Season\s*(\d+)/i); const number = match?.[1] || match?.[2]; return number ? `S${number}` : 'Imported'; }
function inferCompetition(name) { const text = String(name || '').toLowerCase(); if (text.includes('shield')) return 'Youth Shield'; if (text.includes('youth')) return 'Youth Cup'; if (text.includes('world')) return 'World Club Cup'; return 'Challonge Import'; }
function inferBracket(name) { return String(name || '').toLowerCase().includes('shield') ? 'Shield' : 'Cup'; }
function tournamentDate(attributes) { const date = attributes?.timestamps?.starts_at || attributes?.starts_at; if (!date) return ''; try { return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } }

export default function ChallongeImportManager({ onTournamentUpdated }) {
  const [tournaments, setTournaments] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [seasonCode, setSeasonCode] = useState('Imported');
  const [competitionName, setCompetitionName] = useState('Challonge Import');
  const [tournamentName, setTournamentName] = useState('');
  const [bracket, setBracket] = useState('Cup');
  const [statusValue, setStatusValue] = useState('archived');
  const [preview, setPreview] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);
  const selectedTournament = useMemo(() => tournaments.find((item) => String(item.id) === String(selectedId)), [tournaments, selectedId]);

  useEffect(() => { loadChallongeTournaments(); }, []);
  useEffect(() => {
    if (!selectedTournament) return;
    const name = selectedTournament.name || '';
    setTournamentName(name.trim()); setSeasonCode(inferSeason(name)); setCompetitionName(inferCompetition(name)); setBracket(inferBracket(name)); setStatusValue(selectedTournament.attributes?.state === 'complete' ? 'archived' : 'draft'); setPreview(null); setImportResult(null);
  }, [selectedTournament?.id]);

  async function callImportFunction(body) {
    const response = await fetch(IMPORT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) });
    const payload = await readJsonResponse(response);
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Request failed');
    return payload;
  }
  async function verifyPersistedImport(tournamentId) {
    const [entriesResult, matchesResult] = await Promise.all([
      supabase.from('tournament_entries').select('id', { count: 'exact', head: true }).eq('tournament_id', tournamentId),
      supabase.from('matches').select('id', { count: 'exact', head: true }).eq('tournament_id', tournamentId),
    ]);
    if (entriesResult.error) throw new Error('Could not verify imported entries: ' + entriesResult.error.message);
    if (matchesResult.error) throw new Error('Could not verify imported matches: ' + matchesResult.error.message);
    const persistedEntries = Number(entriesResult.count || 0);
    const persistedMatches = Number(matchesResult.count || 0);
    if (!persistedEntries || !persistedMatches) throw new Error(`Import did not persist correctly: ${persistedEntries} entries and ${persistedMatches} matches found in Supabase.`);
    return { persistedEntries, persistedMatches };
  }
  async function loadChallongeTournaments() {
    setLoading(true); setStatus('Loading Challonge tournaments...'); setImportResult(null);
    try {
      const response = await fetch(IMPORT_ENDPOINT, { headers: { Accept: 'application/json' } });
      const payload = await readJsonResponse(response);
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not load Challonge tournaments');
      setTournaments(payload.tournaments || []); if (payload.tournaments?.[0]) setSelectedId(String(payload.tournaments[0].id));
      setStatus(`Loaded ${payload.tournaments?.length || 0} Challonge tournaments using ${payload.authMode || 'API key'}.`);
    } catch (error) { setStatus('Challonge load failed: ' + error.message); }
    setLoading(false);
  }
  async function previewSelectedTournament(event) {
    event.preventDefault(); if (!selectedId) return setStatus('Choose a Challonge tournament first.');
    setLoading(true); setStatus('Fetching preview from Challonge...'); setPreview(null); setImportResult(null);
    try {
      const payload = await callImportFunction({ action: 'preview', challongeTournamentId: selectedId, tournamentName: tournamentName || selectedTournament?.name });
      setPreview(payload); setStatus(`Preview ready: ${payload.participantsCount} participants and ${payload.matchesCount} matches.`);
    } catch (error) { setStatus('Preview failed: ' + error.message); }
    setLoading(false);
  }
  async function importSelectedTournament() {
    if (!selectedId) return setStatus('Choose a Challonge tournament first.');
    setLoading(true); setStatus('Bulk importing tournament...'); setImportResult(null);
    try {
      const payload = await callImportFunction({ action: 'import', challongeTournamentId: selectedId, seasonCode, competitionName, tournamentName: tournamentName || selectedTournament?.name, bracket, status: statusValue, gameWorldName: 'Top 100', gameWorldSlug: 'top-100', competitionSlug: competitionName.toLowerCase().includes('world') ? 'world-club-cup' : 'youth-cup' });
      const verification = await verifyPersistedImport(payload.tournamentId);
      const verifiedPayload = { ...payload, ...verification };
      setImportResult(verifiedPayload);
      setStatus(`Imported ${payload.importedTournamentName}: ${verification.persistedEntries} entries and ${verification.persistedMatches} matches verified in Supabase.${payload.unresolvedPlayers ? ` ${payload.unresolvedPlayers} unresolved match sides remain.` : ''}`);
      await onTournamentUpdated?.();
    } catch (error) { setStatus('Import failed: ' + error.message); }
    setLoading(false);
  }

  return <div className="challonge-import-manager"><section className="public-grid"><article className="public-card"><p className="eyebrow">Challonge API</p><h3>Import legacy tournament</h3><p className="muted">Step 1 previews the Challonge payload. Step 2 bulk-imports teams, managers, entries and matches in database batches, then verifies the saved rows in Supabase.</p><div className="button-row"><button type="button" className="secondary" onClick={loadChallongeTournaments} disabled={loading}>{loading ? 'Working...' : 'Reload Challonge list'}</button></div><p className="status">{status}</p></article><article className="public-card"><p className="eyebrow">Selected tournament</p>{selectedTournament ? <><h3>{selectedTournament.name}</h3><p className="muted">{selectedTournament.attributes?.decorated_tournament_type || selectedTournament.attributes?.tournament_type || 'Tournament'} · {selectedTournament.attributes?.participants_count || '?'} entrants</p><p className="muted">State: {selectedTournament.attributes?.state || 'unknown'}{tournamentDate(selectedTournament.attributes) ? ` · Starts ${tournamentDate(selectedTournament.attributes)}` : ''}</p></> : <p className="muted">No Challonge tournament selected.</p>}</article></section><section className="public-card"><form onSubmit={previewSelectedTournament}><div className="mini-grid"><label>Challonge tournament<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Choose tournament</option>{tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name} ({tournament.id})</option>)}</select></label><label>Season<input value={seasonCode} onChange={(event) => setSeasonCode(event.target.value)} /></label><label>Competition<input value={competitionName} onChange={(event) => setCompetitionName(event.target.value)} /></label><label>Tournament name<input value={tournamentName} onChange={(event) => setTournamentName(event.target.value)} /></label><label>Bracket<select value={bracket} onChange={(event) => setBracket(event.target.value)}><option value="Cup">Cup</option><option value="Shield">Shield</option><option value="Plate">Plate</option></select></label><label>Imported status<select value={statusValue} onChange={(event) => setStatusValue(event.target.value)}><option value="draft">draft</option><option value="published">published</option><option value="completed">completed</option><option value="archived">archived</option></select></label></div><div className="button-row"><button type="submit" className="secondary" disabled={loading || !selectedId}>{loading ? 'Working...' : '1. Preview selected tournament'}</button><button type="button" onClick={importSelectedTournament} disabled={loading || !selectedId || !preview}>{loading ? 'Importing...' : '2. Bulk import previewed tournament'}</button></div></form></section>{preview && <section className="public-card"><p className="eyebrow">Preview</p><div className="overview-metrics compact-metrics"><article><span>Participants</span><strong>{preview.participantsCount}</strong></article><article><span>Matches</span><strong>{preview.matchesCount}</strong></article><article><span>API</span><strong>{preview.authMode}</strong></article></div><p className="muted">Sample participants: {preview.sampleParticipants?.map((p) => p.teamName).join(', ')}</p></section>}{importResult && <section className="public-card"><p className="eyebrow">Import complete and verified</p><div className="overview-metrics compact-metrics"><article><span>Database ID</span><strong>{importResult.tournamentId}</strong></article><article><span>Saved entries</span><strong>{importResult.persistedEntries}</strong></article><article><span>Saved matches</span><strong>{importResult.persistedMatches}</strong></article><article><span>Unresolved sides</span><strong>{importResult.unresolvedPlayers || 0}</strong></article></div><p className="muted">Archive URL: /tournaments/{importResult.tournamentId}</p></section>}</div>;
}
