import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

const ARCHIVE_URL = 'https://archive.smtop100.blog/#honours';
const ARCHIVE_API_URL = 'https://archive.smtop100.blog/.netlify/functions/youth-winners';
const COMPETITION_OPTIONS = [
  { value: 'all', label: 'Cup and Shield' },
  { value: 'cup', label: 'Youth Cup' },
  { value: 'shield', label: 'Youth Shield' },
];

function seasonNumber(row) {
  if (Number(row?.season_number)) return Number(row.season_number);
  const name = row?.tournaments?.name || row?.tournament?.name || row?.tournament_name || '';
  const match = String(name).match(/S\s*(\d+)/i) || String(row?.season || '').match(/S?\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function seasonLabel(row) {
  const n = seasonNumber(row);
  return n ? `S${n}` : row?.tournaments?.name || row?.tournament_name || `Tournament ${row.tournament_id}`;
}

function honourType(row) {
  const value = `${row?.honour || ''} ${row?.competition || ''} ${row?.tournaments?.name || ''} ${row?.tournament_name || ''}`.toLowerCase();
  if (value.includes('shield')) return 'shield';
  if (value.includes('youth cup') || value.includes('cup winner') || value.includes('winner')) return 'cup';
  return 'other';
}

function honourLabel(row) {
  return honourType(row) === 'shield' ? 'Youth Shield' : 'Youth Cup';
}

function honourIcon(row) {
  return honourType(row) === 'shield' ? '🛡️' : '🏆';
}

function honourTeam(row) {
  return row?.team_name || row?.entry?.teams?.name || row?.tournament_entries?.teams?.name || 'TBC';
}

function honourManager(row) {
  return row?.manager_name || row?.entry?.managers?.display_name || row?.entry?.managers?.name || row?.tournament_entries?.managers?.display_name || row?.tournament_entries?.managers?.name || '';
}

function normaliseName(value) {
  return String(value || '').trim();
}

function relevantRows(rows = []) {
  return rows
    .filter((row) => String(row?.honour || '').toLowerCase().includes('winner'))
    .filter((row) => ['cup', 'shield'].includes(honourType(row)))
    .sort((a, b) => seasonNumber(b) - seasonNumber(a) || honourType(a).localeCompare(honourType(b)));
}

function tableRows(rows, getter, type) {
  const counts = new Map();
  rows
    .filter((row) => type === 'all' || honourType(row) === type)
    .forEach((row) => {
      const name = normaliseName(getter(row));
      if (!name) return;
      counts.set(name, (counts.get(name) || 0) + 1);
    });
  return [...counts.entries()]
    .map(([name, wins]) => ({ name, wins }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))
    .slice(0, 8);
}

function seasonOptions(rows) {
  return [...new Set(rows.map(seasonNumber).filter(Boolean))].sort((a, b) => b - a);
}

function recentRows(rows, latestSeason, count = 8) {
  return rows
    .filter((row) => seasonNumber(row) !== latestSeason)
    .slice(0, count);
}

export default function WinnersArchive({ rows = [], currentTournamentId }) {
  const [competitionFilter, setCompetitionFilter] = useState('all');
  const [seasonFilter, setSeasonFilter] = useState('recent');
  const [archiveRows, setArchiveRows] = useState(rows);
  const [archiveStatus, setArchiveStatus] = useState(rows.length ? 'loaded' : 'loading');
  const [currentSeasonNumber, setCurrentSeasonNumber] = useState(null);

  useEffect(() => {
    if (!currentTournamentId || !hasSupabaseConfig || !supabase) {
      setCurrentSeasonNumber(null);
      return undefined;
    }

    let active = true;
    supabase
      .from('tournaments')
      .select('season_number, name')
      .eq('id', currentTournamentId)
      .maybeSingle()
      .then(({ data }) => {
        if (!active) return;
        const season = Number(data?.season_number) || seasonNumber({ tournament_name: data?.name });
        setCurrentSeasonNumber(season || null);
      })
      .catch(() => {
        if (active) setCurrentSeasonNumber(null);
      });

    return () => { active = false; };
  }, [currentTournamentId]);

  useEffect(() => {
    if (rows.length) {
      setArchiveRows(rows);
      setArchiveStatus('loaded');
      return undefined;
    }

    const controller = new AbortController();
    setArchiveStatus('loading');

    fetch(ARCHIVE_API_URL, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Archive API returned ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        const nextRows = Array.isArray(payload) ? payload : payload?.rows;
        setArchiveRows(Array.isArray(nextRows) ? nextRows : []);
        setArchiveStatus(Array.isArray(nextRows) && nextRows.length ? 'loaded' : 'empty');
      })
      .catch((error) => {
        if (error.name === 'AbortError') return;
        setArchiveRows([]);
        setArchiveStatus('unavailable');
      });

    return () => controller.abort();
  }, [rows]);

  const winners = useMemo(() => relevantRows(archiveRows).filter((row) => {
    if (row.tournament_id && Number(row.tournament_id) === Number(currentTournamentId)) return false;
    if (currentSeasonNumber && seasonNumber(row) === currentSeasonNumber) return false;
    return true;
  }), [archiveRows, currentTournamentId, currentSeasonNumber]);
  const seasons = useMemo(() => seasonOptions(winners), [winners]);
  const latestSeason = seasons[0] || null;

  const latestRows = useMemo(() => winners.filter((row) => seasonNumber(row) === latestSeason), [winners, latestSeason]);
  const filteredRows = useMemo(() => {
    const base = winners.filter((row) => {
      if (competitionFilter !== 'all' && honourType(row) !== competitionFilter) return false;
      if (seasonFilter !== 'all' && seasonFilter !== 'recent' && seasonNumber(row) !== Number(seasonFilter)) return false;
      return true;
    });
    return seasonFilter === 'recent' ? recentRows(base, latestSeason, 8) : base;
  }, [winners, competitionFilter, seasonFilter, latestSeason]);

  const clubCupTable = useMemo(() => tableRows(winners, honourTeam, 'cup'), [winners]);
  const clubShieldTable = useMemo(() => tableRows(winners, honourTeam, 'shield'), [winners]);
  const managerCupTable = useMemo(() => tableRows(winners, honourManager, 'cup'), [winners]);
  const managerShieldTable = useMemo(() => tableRows(winners, honourManager, 'shield'), [winners]);

  if (archiveStatus === 'loading') return <div className="previous-winners winners-archive-panel"><p className="muted">Loading winners from the Top 100 archive...</p></div>;

  if (!winners.length) return <div className="previous-winners winners-archive-panel archive-unavailable-card">
    <h3>Historic winners archive</h3>
    <p className="muted">{archiveStatus === 'empty' ? 'The archive returned no Youth Cup or Shield winner records.' : 'The Top 100 archive could not be reached.'}</p>
    <a className="public-link-button" href={ARCHIVE_URL} target="_blank" rel="noreferrer">Open full honours archive</a>
  </div>;

  return <div className="previous-winners winners-archive-panel">
    <div className="winners-archive-header">
      <div>
        <h3>{latestSeason ? `Last season's winners — S${latestSeason}` : 'Previous winners archive'}</h3>
        <p className="muted">Historic Youth Cup and Shield winners supplied by the Top 100 archive.</p>
      </div>
      <a className="public-link-button" href={ARCHIVE_URL} target="_blank" rel="noreferrer">Full honours archive</a>
    </div>

    {latestRows.length > 0 && <div className="previous-winner-list latest-winner-list">
      {latestRows.map((row) => <WinnerCard key={`latest-${row.id}`} row={row} featured />)}
    </div>}

    <div className="winners-filter-row">
      <label className="public-group-filter">Competition<select value={competitionFilter} onChange={(event) => setCompetitionFilter(event.target.value)}>{COMPETITION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
      <label className="public-group-filter">Season<select value={seasonFilter} onChange={(event) => setSeasonFilter(event.target.value)}><option value="recent">Recent winners</option><option value="all">All seasons</option>{seasons.map((season) => <option key={season} value={season}>S{season}</option>)}</select></label>
    </div>

    <div className="previous-winner-list compact-winner-list">
      {filteredRows.map((row) => <WinnerCard key={row.id} row={row} />)}
    </div>

    {seasonFilter === 'all' && <p className="muted archive-volume-note">Showing all Youth Cup and Shield winners supplied by the archive.</p>}

    <div className="honours-leaderboard-grid">
      <HonoursTable title="Most Youth Cup wins — clubs" rows={clubCupTable} type="cup" />
      <HonoursTable title="Most Youth Shield wins — clubs" rows={clubShieldTable} type="shield" />
      <HonoursTable title="Most Youth Cup wins — managers" rows={managerCupTable} type="cup" />
      <HonoursTable title="Most Youth Shield wins — managers" rows={managerShieldTable} type="shield" />
    </div>
  </div>;
}

function WinnerCard({ row, featured = false }) {
  const type = honourType(row);
  return <article className={`${featured ? 'latest-winner-card ' : ''}honour-card honour-card-${type}`}>
    <span>{seasonLabel(row)} · {honourLabel(row)}</span>
    <strong>{honourIcon(row)} {honourTeam(row)}</strong>
    <small>{row.honour}{honourManager(row) ? ` · ${honourManager(row)}` : ''}</small>
  </article>;
}

function HonoursTable({ title, rows, type }) {
  return <section className={`honours-leaderboard-card honours-leaderboard-${type}`}>
    <h4>{title}</h4>
    {rows.length ? <div className="honours-leaderboard-list">{rows.map((row) => <div className="honours-leaderboard-row" key={row.name}><strong>{row.name}</strong><span>{row.wins}</span></div>)}</div> : <p className="muted">No winners yet.</p>}
  </section>;
}
