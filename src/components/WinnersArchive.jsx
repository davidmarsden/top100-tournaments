import { useMemo, useState } from 'react';

const ARCHIVE_URL = 'https://archive.smtop100.blog/#honours';
const COMPETITION_OPTIONS = [
  { value: 'all', label: 'Cup and Shield' },
  { value: 'cup', label: 'Youth Cup' },
  { value: 'shield', label: 'Youth Shield' },
];

function seasonNumber(row) {
  const name = row?.tournaments?.name || row?.tournament?.name || '';
  const match = String(name).match(/S\s*(\d+)/i) || String(row?.season || '').match(/S?\s*(\d+)/i);
  return match ? Number(match[1]) : 0;
}

function seasonLabel(row) {
  const n = seasonNumber(row);
  return n ? `S${n}` : row?.tournaments?.name || `Tournament ${row.tournament_id}`;
}

function honourType(row) {
  const value = `${row?.honour || ''} ${row?.tournaments?.name || ''}`.toLowerCase();
  if (value.includes('shield')) return 'shield';
  if (value.includes('youth cup') || value.includes('cup winner') || value.includes('winner')) return 'cup';
  return 'other';
}

function honourLabel(row) {
  return honourType(row) === 'shield' ? 'Youth Shield' : 'Youth Cup';
}

function honourTeam(row) {
  return row?.entry?.teams?.name || row?.tournament_entries?.teams?.name || 'TBC';
}

function honourManager(row) {
  return row?.entry?.managers?.display_name || row?.entry?.managers?.name || row?.tournament_entries?.managers?.display_name || row?.tournament_entries?.managers?.name || '';
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

  const winners = useMemo(() => relevantRows(rows).filter((row) => Number(row.tournament_id) !== Number(currentTournamentId)), [rows, currentTournamentId]);
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

  if (!winners.length) return null;

  return <div className="previous-winners winners-archive-panel">
    <div className="winners-archive-header">
      <div>
        <h3>{latestSeason ? `Last season's winners — S${latestSeason}` : 'Previous winners archive'}</h3>
        <p className="muted">Historic Youth Cup and Shield winners imported from the Top 100 honours archive.</p>
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

    {seasonFilter === 'all' && <p className="muted archive-volume-note">Showing all imported winners. For the cleaner full honours archive, use the archive link above.</p>}

    <div className="honours-leaderboard-grid">
      <HonoursTable title="Most Youth Cup wins — clubs" rows={clubCupTable} />
      <HonoursTable title="Most Youth Shield wins — clubs" rows={clubShieldTable} />
      <HonoursTable title="Most Youth Cup wins — managers" rows={managerCupTable} />
      <HonoursTable title="Most Youth Shield wins — managers" rows={managerShieldTable} />
    </div>
  </div>;
}

function WinnerCard({ row, featured = false }) {
  return <article className={featured ? 'latest-winner-card' : ''}>
    <span>{seasonLabel(row)} · {honourLabel(row)}</span>
    <strong>🏆 {honourTeam(row)}</strong>
    <small>{row.honour}{honourManager(row) ? ` · ${honourManager(row)}` : ''}</small>
  </article>;
}

function HonoursTable({ title, rows }) {
  return <section className="honours-leaderboard-card">
    <h4>{title}</h4>
    {rows.length ? <table className="honours-leaderboard-table"><tbody>{rows.map((row) => <tr key={row.name}><td><strong>{row.name}</strong></td><td><span className="wins-pill">{row.wins} win{row.wins === 1 ? '' : 's'}</span></td></tr>)}</tbody></table> : <p className="muted">No winners yet.</p>}
  </section>;
}
