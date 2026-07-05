import { useEffect, useMemo, useState } from 'react';

const IMPORT_ENDPOINT = '/.netlify/functions/challonge-import';

function inferSeason(name) {
  const match = String(name || '').match(/S\s*(\d+)|Season\s*(\d+)/i);
  const number = match?.[1] || match?.[2];
  return number ? `S${number}` : 'Imported';
}

function inferCompetition(name) {
  const text = String(name || '').toLowerCase();
  if (text.includes('shield')) return 'Youth Shield';
  if (text.includes('youth')) return 'Youth Cup';
  if (text.includes('world')) return 'World Club Cup';
  return 'Challonge Import';
}

function inferBracket(name) {
  return String(name || '').toLowerCase().includes('shield') ? 'Shield' : 'Cup';
}

function tournamentDate(attributes) {
  const date = attributes?.timestamps?.starts_at || attributes?.starts_at;
  if (!date) return '';
  try { return new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return ''; }
}

export default function ChallongeImportManager({ onTournamentUpdated }) {
  const [tournaments, setTournaments] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [seasonCode, setSeasonCode] = useState('Imported');
  const [competitionName, setCompetitionName] = useState('Challonge Import');
  const [tournamentName, setTournamentName] = useState('');
  const [bracket, setBracket] = useState('Cup');
  const [statusValue, setStatusValue] = useState('archived');
  const [importResult, setImportResult] = useState(null);
  const [status, setStatus] = useState('Ready');
  const [loading, setLoading] = useState(false);

  const selectedTournament = useMemo(() => tournaments.find((item) => String(item.id) === String(selectedId)), [tournaments, selectedId]);

  useEffect(() => { loadChallongeTournaments(); }, []);
  useEffect(() => {
    if (!selectedTournament) return;
    const name = selectedTournament.name || '';
    setTournamentName(name.trim());
    setSeasonCode(inferSeason(name));
    setCompetitionName(inferCompetition(name));
    setBracket(inferBracket(name));
    setStatusValue(selectedTournament.attributes?.state === 'complete' ? 'archived' : 'draft');
  }, [selectedTournament?.id]);

  async function loadChallongeTournaments() {
    setLoading(true);
    setStatus('Loading Challonge tournaments...');
    setImportResult(null);
    try {
      const response = await fetch(IMPORT_ENDPOINT);
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not load Challonge tournaments');
      setTournaments(payload.tournaments || []);
      if (payload.tournaments?.[0]) setSelectedId(String(payload.tournaments[0].id));
      setStatus(`Loaded ${payload.tournaments?.length || 0} Challonge tournaments using ${payload.authMode || 'API key'}.`);
    } catch (error) {
      setStatus('Challonge load failed: ' + error.message);
    }
    setLoading(false);
  }

  async function importSelectedTournament(event) {
    event.preventDefault();
    if (!selectedId) return setStatus('Choose a Challonge tournament first.');
    setLoading(true);
    setStatus('Importing tournament from Challonge...');
    setImportResult(null);
    try {
      const response = await fetch(IMPORT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challongeTournamentId: selectedId,
          seasonCode,
          competitionName,
          tournamentName: tournamentName || selectedTournament?.name,
          bracket,
          status: statusValue,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'Import failed');
      setImportResult(payload);
      setStatus(`Imported ${payload.importedTournamentName}: ${payload.importedParticipants} participants, ${payload.importedMatches} new matches, ${payload.updatedMatches} updated.`);
      await onTournamentUpdated?.();
    } catch (error) {
      setStatus('Import failed: ' + error.message);
    }
    setLoading(false);
  }

  return <div className="challonge-import-manager"><section className="public-grid"><article className="public-card"><p className="eyebrow">Challonge API</p><h3>Import legacy tournament</h3><p className="muted">Pull a tournament from Challonge into the Top 100 archive. Re-importing the same tournament updates saved matches using Challonge IDs.</p><div className="button-row"><button type="button" className="secondary" onClick={loadChallongeTournaments} disabled={loading}>{loading ? 'Working...' : 'Reload Challonge list'}</button></div><p className="status">{status}</p></article><article className="public-card"><p className="eyebrow">Selected tournament</p>{selectedTournament ? <><h3>{selectedTournament.name}</h3><p className="muted">{selectedTournament.attributes?.decorated_tournament_type || selectedTournament.attributes?.tournament_type || 'Tournament'} · {selectedTournament.attributes?.participants_count || '?'} entrants</p><p className="muted">State: {selectedTournament.attributes?.state || 'unknown'}{tournamentDate(selectedTournament.attributes) ? ` · Starts ${tournamentDate(selectedTournament.attributes)}` : ''}</p></> : <p className="muted">No Challonge tournament selected.</p>}</article></section><section className="public-card"><form onSubmit={importSelectedTournament}><div className="mini-grid"><label>Challonge tournament<select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Choose tournament</option>{tournaments.map((tournament) => <option key={tournament.id} value={tournament.id}>{tournament.name} ({tournament.id})</option>)}</select></label><label>Season<input value={seasonCode} onChange={(event) => setSeasonCode(event.target.value)} /></label><label>Competition<input value={competitionName} onChange={(event) => setCompetitionName(event.target.value)} /></label><label>Tournament name<input value={tournamentName} onChange={(event) => setTournamentName(event.target.value)} /></label><label>Bracket<select value={bracket} onChange={(event) => setBracket(event.target.value)}><option value="Cup">Cup</option><option value="Shield">Shield</option><option value="Plate">Plate</option></select></label><label>Imported status<select value={statusValue} onChange={(event) => setStatusValue(event.target.value)}><option value="draft">draft</option><option value="published">published</option><option value="completed">completed</option><option value="archived">archived</option></select></label></div><div className="button-row"><button type="submit" disabled={loading || !selectedId}>{loading ? 'Importing...' : 'Import selected tournament'}</button></div></form></section>{importResult && <section className="public-card"><p className="eyebrow">Import complete</p><div className="overview-metrics compact-metrics"><article><span>Database ID</span><strong>{importResult.tournamentId}</strong></article><article><span>Participants</span><strong>{importResult.importedParticipants}</strong></article><article><span>New matches</span><strong>{importResult.importedMatches}</strong></article><article><span>Updated matches</span><strong>{importResult.updatedMatches}</strong></article></div><p className="muted">Archive URL: /tournaments/{importResult.tournamentId}</p></section>}</div>;
}
