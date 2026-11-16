// Squads against the 50-player limit (rule 4.1), from each club's latest synced count. "From (date)"
// is when that squad was last read. The admin team (Manager Alerts) sees every squad at or over the
// limit; every signed-in manager (Squad & Transfers) sees those over it.
const date = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '–');

export default function SquadsAtLimitTable({ squads = [], emptyText = 'No squad is at or over the limit.' }) {
  if (!squads.length) return <p className="muted">{emptyText}</p>;
  return (
    <table>
      <thead><tr><th>Club</th><th>Manager</th><th>Div</th><th>Players</th><th>From (date)</th></tr></thead>
      <tbody>
        {squads.map((squad) => (
          <tr key={squad.club_name}>
            <td>{squad.club_name}</td><td>{squad.manager_name}</td><td>{squad.division}</td>
            <td><strong>{squad.players}</strong>{squad.players > squad.squad_limit ? ' ⚠' : ''}</td><td>{date(squad.captured_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
