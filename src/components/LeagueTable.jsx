import { useMemo, useState } from 'react';

const ZONES = [
  { key: 'cup_r16', label: 'Last 16', title: 'World Club Cup last 16' },
  { key: 'playoff', label: 'Play-off', title: 'Cup knockout play-off' },
  { key: 'shield', label: 'Shield', title: 'Shield last 32' },
  { key: 'out', label: 'Out', title: 'Eliminated' },
];

function Form({ results = [] }) {
  return <span className="lt-form" aria-label={`Form: ${results.join(' ') || 'none'}`}>
    {results.map((r, i) => <i key={i} className={`lt-form__${r}`}>{r}</i>)}
  </span>;
}

// One table of every club. Coloured edges show what each position leads to.
export default function LeagueTable({ rows = [], compact = false, highlightIds = [], potFilter: initialPot = 'all' }) {
  const [pot, setPot] = useState(initialPot);
  const [query, setQuery] = useState('');
  const highlighted = new Set(highlightIds);
  const visible = useMemo(() => rows.filter((row) => (pot === 'all' || String(row.pot) === pot)
    && (!query || `${row.name} ${row.managerName || ''}`.toLowerCase().includes(query.toLowerCase()))), [rows, pot, query]);
  const filtered = pot !== 'all' || query;

  if (!rows.length) return <p className="muted">The table appears once the clubs are entered.</p>;

  return <div className={compact ? 'lt lt--compact' : 'lt'}>
    <div className="lt-toolbar">
      <ul className="lt-legend" aria-label="What each position leads to">
        {ZONES.map((zone) => <li key={zone.key} className={`lt-zone lt-zone--${zone.key}`}>{zone.title}</li>)}
      </ul>
      <div className="lt-filters">
        <label><span className="sr-only">Division</span>
          <select value={pot} onChange={(event) => setPot(event.target.value)}>
            <option value="all">All Divisions</option>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={String(n)}>Division {n} clubs</option>)}
          </select>
        </label>
        <label><span className="sr-only">Find a club</span><input type="search" placeholder="Find a club or manager" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      </div>
    </div>
    <div className="lt-scroll">
      <table className="lt-table">
        <thead><tr>
          <th scope="col" className="lt-pos">#</th>
          <th scope="col" className="lt-club">Club</th>
          <th scope="col" title="Division (pot)">Div</th>
          <th scope="col" title="Played">P</th>
          <th scope="col" title="Won" className="lt-wide">W</th>
          <th scope="col" title="Drawn" className="lt-wide">D</th>
          <th scope="col" title="Lost" className="lt-wide">L</th>
          <th scope="col" title="Goal difference">GD</th>
          <th scope="col" title="Points" className="lt-pts">Pts</th>
          {!compact && <th scope="col" className="lt-wide">Form</th>}
        </tr></thead>
        <tbody>
          {visible.map((row, index) => {
            const next = visible[index + 1];
            const cutLine = !filtered && next && next.zone !== row.zone;
            return <tr key={row.entryId} className={[`lt-row lt-row--${row.zone || 'out'}`, cutLine ? 'lt-row--cut' : '', highlighted.has(row.entryId) ? 'lt-row--mine' : ''].join(' ')}>
              <td className="lt-pos"><span>{row.position}</span></td>
              <th scope="row" className="lt-club"><span className="lt-club__name">{row.name}</span>{row.managerName && <span className="lt-club__manager">{row.managerName}</span>}</th>
              <td><span className={`lt-div lt-div--${row.pot}`}>D{row.pot}</span></td>
              <td>{row.played}</td>
              <td className="lt-wide">{row.won}</td>
              <td className="lt-wide">{row.drawn}</td>
              <td className="lt-wide">{row.lost}</td>
              <td>{row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}</td>
              <td className="lt-pts"><b>{row.points}</b></td>
              {!compact && <td className="lt-wide"><Form results={row.form} /></td>}
            </tr>;
          })}
        </tbody>
      </table>
    </div>
    {filtered && <p className="muted lt-note">Positions are in the full table of {rows.length} clubs.</p>}
  </div>;
}
