import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';

function isPlayed(match) { return match.status === 'played' || match.status === 'forfeit'; }
function matchDate(match) { if (!match.fixture_date) return 'Date TBC'; const [year, month, day] = match.fixture_date.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
function ordinal(value) { if (!value) return 'TBC'; const suffix = value === 1 ? 'st' : value === 2 ? 'nd' : value === 3 ? 'rd' : 'th'; return `${value}${suffix}`; }

function buildStandings(entries, matches) {
  const rows = new Map(entries.map((entry) => [entry.id, { id: entry.id, team: entry.teams?.name || 'Unknown team', played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 }]));
  matches.filter(isPlayed).forEach((match) => {
    const home = rows.get(match.home_entry_id), away = rows.get(match.away_entry_id);
    const homeScore = Number(match.home_score), awayScore = Number(match.away_score);
    if (!home || !away || !Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return;
    home.played += 1; away.played += 1; home.gf += homeScore; home.ga += awayScore; away.gf += awayScore; away.ga += homeScore;
    if (homeScore > awayScore) { home.won += 1; away.lost += 1; home.points += 3; }
    else if (awayScore > homeScore) { away.won += 1; home.lost += 1; away.points += 3; }
    else { home.drawn += 1; away.drawn += 1; home.points += 1; away.points += 1; }
  });
  return [...rows.values()].map((row) => ({ ...row, gd: row.gf - row.ga })).sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
}

export default function ManagerPortal() {
  const [session, setSession] = useState(null), [email, setEmail] = useState(''), [message, setMessage] = useState(''), [loading, setLoading] = useState(true);
  const [account, setAccount] = useState(null), [entries, setEntries] = useState([]), [matches, setMatches] = useState([]), [groupEntries, setGroupEntries] = useState([]), [selectedEntryId, setSelectedEntryId] = useState('');

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setLoading(false); return undefined; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session || null); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);
  useEffect(() => { if (session?.user) loadPortal(); else { setLoading(false); setAccount(null); setEntries([]); setMatches([]); } }, [session?.user?.id]);

  const selectedEntry = useMemo(() => entries.find((entry) => String(entry.id) === String(selectedEntryId)) || entries[0] || null, [entries, selectedEntryId]);
  const selectedTournamentMatches = useMemo(() => selectedEntry ? matches.filter((match) => match.tournament_id === selectedEntry.tournament_id) : [], [matches, selectedEntry]);
  const myMatches = useMemo(() => selectedEntry ? selectedTournamentMatches.filter((match) => match.home_entry_id === selectedEntry.id || match.away_entry_id === selectedEntry.id) : [], [selectedTournamentMatches, selectedEntry]);
  const upcoming = useMemo(() => myMatches.filter((match) => !isPlayed(match)).sort((a, b) => String(a.fixture_date || '9999').localeCompare(String(b.fixture_date || '9999')) || Number(a.match_order || 0) - Number(b.match_order || 0)), [myMatches]);
  const results = useMemo(() => myMatches.filter(isPlayed).sort((a, b) => Number(b.match_order || 0) - Number(a.match_order || 0)), [myMatches]);
  const currentGroupEntries = useMemo(() => selectedEntry ? groupEntries.filter((entry) => entry.tournament_id === selectedEntry.tournament_id && entry.group_code === selectedEntry.group_code) : [], [groupEntries, selectedEntry]);
  const currentGroupIds = useMemo(() => new Set(currentGroupEntries.map((entry) => entry.id)), [currentGroupEntries]);
  const standings = useMemo(() => buildStandings(currentGroupEntries, selectedTournamentMatches.filter((match) => match.stage === 'group' && currentGroupIds.has(match.home_entry_id) && currentGroupIds.has(match.away_entry_id))), [currentGroupEntries, selectedTournamentMatches, currentGroupIds]);
  const myPosition = selectedEntry ? standings.findIndex((row) => row.id === selectedEntry.id) + 1 : 0;

  async function sendMagicLink(event) {
    event.preventDefault(); setLoading(true); setMessage('');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/manager`, shouldCreateUser: false } });
    setMessage(error ? error.message : 'Check your email for your secure Manager Portal sign-in link.'); setLoading(false);
  }

  async function loadPortal() {
    setLoading(true); setMessage('Loading your tournaments...');
    const { data: accountRow, error: accountError } = await supabase.from('manager_portal_accounts').select('id, manager_id, email, active, managers(id, name, display_name)').eq('auth_user_id', session.user.id).eq('active', true).maybeSingle();
    if (accountError || !accountRow) { setAccount(null); setMessage(accountError ? accountError.message : 'Your login is valid, but it has not yet been linked to a Top 100 manager account.'); setLoading(false); return; }
    const { data: entryRows, error: entryError } = await supabase.from('tournament_entries').select('id, tournament_id, manager_id, group_code, seed, pot, teams(id, name), tournaments(id, name, status, season_number, public_slug, is_public)').eq('manager_id', accountRow.manager_id);
    if (entryError) { setMessage('Could not load your tournament entries: ' + entryError.message); setLoading(false); return; }
    const orderedEntries = [...(entryRows || [])].sort((a, b) => Number(b.tournaments?.season_number || 0) - Number(a.tournaments?.season_number || 0));
    const tournamentIds = [...new Set(orderedEntries.map((entry) => entry.tournament_id))];
    let matchRows = [], peerEntries = [];
    if (tournamentIds.length) {
      const [matchResult, peerResult] = await Promise.all([
        supabase.from('matches').select('id, tournament_id, group_id, stage, round, leg, match_order, status, fixture_date, played_at, home_entry_id, away_entry_id, home_placeholder, away_placeholder, home_score, away_score, bracket').in('tournament_id', tournamentIds),
        supabase.from('tournament_entries').select('id, tournament_id, group_code, teams(name)').in('tournament_id', tournamentIds),
      ]);
      if (matchResult.error) setMessage('Some fixture data could not be loaded: ' + matchResult.error.message); else matchRows = matchResult.data || [];
      if (!peerResult.error) peerEntries = peerResult.data || [];
    }
    setAccount(accountRow); setEntries(orderedEntries); setSelectedEntryId(orderedEntries[0]?.id || ''); setMatches(matchRows); setGroupEntries(peerEntries); setMessage('Portal loaded.'); setLoading(false);
  }

  async function logout() { await supabase.auth.signOut(); setMessage('Signed out.'); }
  function opponent(match) { return match.home_entry_id === selectedEntry?.id ? match.away_placeholder : match.home_placeholder; }
  function venue(match) { return match.home_entry_id === selectedEntry?.id ? 'Home' : 'Away'; }

  if (!hasSupabaseConfig || !supabase) return <main className="manager-portal-shell"><section className="warning-card"><strong>Manager Portal unavailable.</strong><span>Supabase is not connected.</span></section></main>;
  if (!session) return <main className="manager-portal-shell"><section className="manager-portal-hero"><p className="eyebrow">Top 100 Tournament Manager</p><h1>Manager Portal</h1><p>Your fixtures, results, group table and tournament progress in one place.</p></section><section className="card manager-login-card"><h2>Sign in securely</h2><p className="muted">Enter the email address linked to your Top 100 manager account. We’ll send you a one-time sign-in link.</p><form onSubmit={sendMagicLink}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoComplete="email" /></label><button type="submit" disabled={loading}>{loading ? 'Sending...' : 'Email me a sign-in link'}</button></form>{message && <p className="status">{message}</p>}<p className="muted">Portal URL: /manager</p></section></main>;
  if (loading) return <main className="manager-portal-shell"><section className="card"><h1>Loading Manager Portal...</h1></section></main>;
  if (!account) return <main className="manager-portal-shell"><section className="manager-portal-hero"><p className="eyebrow">Manager Portal</p><h1>Account link required</h1></section><section className="card"><p>{message}</p><p className="muted">Signed in as {session.user.email}. Ask a tournament administrator to link this login to your manager record.</p><button type="button" className="secondary" onClick={logout}>Sign out</button></section></main>;

  return <main className="manager-portal-shell">
    <section className="manager-portal-hero"><div><p className="eyebrow">Manager Portal</p><h1>{account.managers?.display_name || account.managers?.name || 'Top 100 Manager'}</h1><p>{selectedEntry ? `${selectedEntry.teams?.name} · ${selectedEntry.tournaments?.name}` : 'No tournament entry found'}</p></div><button type="button" className="secondary" onClick={logout}>Sign out</button></section>
    {entries.length > 1 && <section className="card portal-selector"><label>Tournament entry<select value={selectedEntry?.id || ''} onChange={(event) => setSelectedEntryId(event.target.value)}>{entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.tournaments?.name} — {entry.teams?.name}</option>)}</select></label></section>}
    {!selectedEntry ? <section className="card"><p>No tournament entries are linked to this manager yet.</p></section> : <>
      <section className="portal-metrics"><article><span>Team</span><strong>{selectedEntry.teams?.name}</strong></article><article><span>Group</span><strong>{selectedEntry.group_code ? `Group ${selectedEntry.group_code}` : 'TBC'}</strong></article><article><span>Position</span><strong>{ordinal(myPosition)}</strong></article><article><span>Record</span><strong>{results.length} played</strong></article></section>
      <section className="portal-grid">
        <article className="card portal-panel"><div className="card-header"><p className="eyebrow">Up next</p><h2>Your fixtures</h2></div>{upcoming.length ? <div className="portal-fixtures">{upcoming.map((match) => <div className="portal-fixture" key={match.id}><div><strong>{venue(match)} vs {opponent(match)}</strong><span>{match.round} · {match.bracket || match.stage}</span></div><time>{matchDate(match)}</time></div>)}</div> : <p className="muted">No outstanding fixtures.</p>}</article>
        <article className="card portal-panel"><div className="card-header"><p className="eyebrow">Recent</p><h2>Your results</h2></div>{results.length ? <div className="portal-fixtures">{results.map((match) => { const home = match.home_entry_id === selectedEntry.id, mine = home ? match.home_score : match.away_score, theirs = home ? match.away_score : match.home_score, outcome = mine > theirs ? 'W' : mine < theirs ? 'L' : 'D'; return <div className="portal-fixture" key={match.id}><div><strong><span className={`portal-outcome ${outcome}`}>{outcome}</span> {venue(match)} vs {opponent(match)}</strong><span>{match.round} · {matchDate(match)}</span></div><b>{mine}–{theirs}</b></div>; })}</div> : <p className="muted">No results entered yet.</p>}</article>
      </section>
      {selectedEntry.group_code && <section className="card portal-panel"><div className="card-header"><p className="eyebrow">Live standings</p><h2>Group {selectedEntry.group_code}</h2></div><div className="table-wrap"><table className="portal-table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>{standings.map((row, index) => <tr key={row.id} className={row.id === selectedEntry.id ? 'my-team' : ''}><td>{index + 1}</td><td><strong>{row.team}</strong></td><td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td><td>{row.gd}</td><td><strong>{row.points}</strong></td></tr>)}</tbody></table></div></section>}
    </>}
  </main>;
}
