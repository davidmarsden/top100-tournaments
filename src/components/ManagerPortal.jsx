import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import ManagerResultCentre from './ManagerResultCentre.jsx';

function normalise(value) { return String(value || '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function isPlayed(match) { return match.status === 'played' || match.status === 'forfeit'; }
function matchDate(match) { if (!match.fixture_date) return 'Date TBC'; const [year, month, day] = match.fixture_date.split('-').map(Number); return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }); }
function ordinal(value) { if (!value) return 'TBC'; return `${value}${value === 1 ? 'st' : value === 2 ? 'nd' : value === 3 ? 'rd' : 'th'}`; }
function entryTeamName(entry, fallback = 'TBC') { return entry?.teams?.name || fallback || 'TBC'; }
function buildStandings(entries, matches) {
  const rows = new Map(entries.map((entry) => [entry.id, { id: entry.id, team: entry.teams?.name || 'Unknown team', played: 0, won: 0, drawn: 0, lost: 0, gf: 0, ga: 0, gd: 0, points: 0 }]));
  matches.filter(isPlayed).forEach((match) => {
    const home = rows.get(match.home_entry_id), away = rows.get(match.away_entry_id), hs = Number(match.home_score), as = Number(match.away_score);
    if (!home || !away || !Number.isFinite(hs) || !Number.isFinite(as)) return;
    home.played += 1; away.played += 1; home.gf += hs; home.ga += as; away.gf += as; away.ga += hs;
    const doubleForfeit = match.status === 'forfeit' && hs === 0 && as === 0;
    if (doubleForfeit) { home.lost += 1; away.lost += 1; }
    else if (hs > as) { home.won += 1; away.lost += 1; home.points += 3; }
    else if (as > hs) { away.won += 1; home.lost += 1; away.points += 3; }
    else { home.drawn += 1; away.drawn += 1; home.points += 1; away.points += 1; }
  });
  return [...rows.values()].map((row) => ({ ...row, gd: row.gf - row.ga })).sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf || a.team.localeCompare(b.team));
}

export default function ManagerPortal() {
  const [session, setSession] = useState(null), [email, setEmail] = useState(''), [message, setMessage] = useState(''), [loading, setLoading] = useState(true);
  const [account, setAccount] = useState(null), [claim, setClaim] = useState(null), [claimForm, setClaimForm] = useState({ gameWorldId: '', managerName: '', clubName: '' });
  const [gameWorlds, setGameWorlds] = useState([]), [worldClubs, setWorldClubs] = useState([]);
  const [entries, setEntries] = useState([]), [matches, setMatches] = useState([]), [groupEntries, setGroupEntries] = useState([]), [selectedEntryId, setSelectedEntryId] = useState('');
  const [adminAssignments, setAdminAssignments] = useState([]);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) { setLoading(false); return undefined; }
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) setSession(data.session || null); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, []);
  useEffect(() => { if (session?.user) { loadIdentityDirectory(); loadPortal(); } else { setLoading(false); setAccount(null); setClaim(null); setEntries([]); setAdminAssignments([]); } }, [session?.user?.id]);
  useEffect(() => { loadWorldClubs(claimForm.gameWorldId); }, [claimForm.gameWorldId]);

  const selectedEntry = useMemo(() => entries.find((entry) => String(entry.id) === String(selectedEntryId)) || entries[0] || null, [entries, selectedEntryId]);
  const selectedTournamentMatches = useMemo(() => selectedEntry ? matches.filter((match) => match.tournament_id === selectedEntry.tournament_id) : [], [matches, selectedEntry]);
  const myMatches = useMemo(() => selectedEntry ? selectedTournamentMatches.filter((match) => match.home_entry_id === selectedEntry.id || match.away_entry_id === selectedEntry.id) : [], [selectedTournamentMatches, selectedEntry]);
  const upcoming = useMemo(() => myMatches.filter((match) => !isPlayed(match)).sort((a, b) => String(a.fixture_date || '9999').localeCompare(String(b.fixture_date || '9999')) || Number(a.match_order || 0) - Number(b.match_order || 0)), [myMatches]);
  const results = useMemo(() => myMatches.filter(isPlayed).sort((a, b) => Number(b.match_order || 0) - Number(a.match_order || 0)), [myMatches]);
  const currentGroupEntries = useMemo(() => selectedEntry ? groupEntries.filter((entry) => entry.tournament_id === selectedEntry.tournament_id && entry.group_code === selectedEntry.group_code) : [], [groupEntries, selectedEntry]);
  const currentGroupIds = useMemo(() => new Set(currentGroupEntries.map((entry) => entry.id)), [currentGroupEntries]);
  const standings = useMemo(() => buildStandings(currentGroupEntries, selectedTournamentMatches.filter((match) => match.stage === 'group' && currentGroupIds.has(match.home_entry_id) && currentGroupIds.has(match.away_entry_id))), [currentGroupEntries, selectedTournamentMatches, currentGroupIds]);
  const myPosition = selectedEntry ? standings.findIndex((row) => row.id === selectedEntry.id) + 1 : 0;
  const selectedClaimClub = useMemo(() => worldClubs.find((club) => club.club_name === claimForm.clubName) || null, [worldClubs, claimForm.clubName]);
  const organiserAssignments = useMemo(() => adminAssignments.filter((row) => row.role === 'organiser'), [adminAssignments]);

  async function loadIdentityDirectory() {
    const { data, error } = await supabase.from('game_worlds').select('id, name, slug').in('slug', ['top-100', 'regen']).order('id');
    if (!error) setGameWorlds(data || []);
  }

  async function loadWorldClubs(gameWorldId) {
    if (!gameWorldId || !supabase) { setWorldClubs([]); return; }
    const { data, error } = await supabase.from('game_world_clubs').select('id, club_name, current_manager_name').eq('game_world_id', Number(gameWorldId)).eq('active', true).eq('occupied', true).order('club_name');
    if (error) setWorldClubs([]); else setWorldClubs(data || []);
  }

  async function sendMagicLink(event) {
    event.preventDefault(); setLoading(true); setMessage('');
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo: `${window.location.origin}/manager`, shouldCreateUser: true } });
    setMessage(error ? error.message : 'Check your email for your secure Manager Portal sign-in link.'); setLoading(false);
  }

  async function submitClaim(event) {
    event.preventDefault();
    const managerName = claimForm.managerName.trim(), clubName = claimForm.clubName.trim(), gameWorldId = Number(claimForm.gameWorldId);
    if (!gameWorldId || !managerName || !clubName) return setMessage('Choose your game world and club, then enter your SM manager name.');
    if (selectedClaimClub?.current_manager_name && normalise(selectedClaimClub.current_manager_name) !== normalise(managerName)) return setMessage(`${selectedClaimClub.club_name} is currently listed as managed by ${selectedClaimClub.current_manager_name}. Check your manager name before submitting.`);
    setLoading(true); setMessage('Checking the manager directory...');
    const { data: candidateRows, error: candidateError } = await supabase.from('tournament_entries').select('manager_id, managers(id, name, display_name), teams(name), tournaments!inner(game_world_id)').eq('tournaments.game_world_id', gameWorldId);
    if (candidateError) { setLoading(false); return setMessage('Could not check manager records: ' + candidateError.message); }
    const candidateMatches = (candidateRows || []).filter((row) => normalise(row.managers?.display_name || row.managers?.name) === normalise(managerName) && normalise(row.teams?.name) === normalise(clubName));
    const managerIds = [...new Set(candidateMatches.map((row) => row.manager_id).filter(Boolean))];
    const payload = { auth_user_id: session.user.id, email: session.user.email, game_world_id: gameWorldId, claimed_manager_name: managerName, claimed_club_name: clubName, suggested_manager_id: managerIds.length === 1 ? managerIds[0] : null, status: 'pending', review_notes: null, reviewed_by: null, reviewed_at: null, updated_at: new Date().toISOString() };
    const { data, error } = await supabase.from('manager_portal_claims').upsert(payload, { onConflict: 'auth_user_id' }).select('*, game_worlds(name)').single();
    if (error) setMessage('Could not submit your claim: ' + error.message); else { setClaim(data); setMessage('Your claim is waiting for administrator approval.'); }
    setLoading(false);
  }

  async function loadPortal() {
    setLoading(true); setMessage('Loading your Manager Portal...');
    const { data: accountRow, error: accountError } = await supabase.from('manager_portal_accounts').select('id, manager_id, game_world_id, email, active, managers(id, name, display_name), game_worlds(id, name, slug)').eq('auth_user_id', session.user.id).eq('active', true).maybeSingle();
    if (accountError) { setMessage(accountError.message); setLoading(false); return; }
    if (!accountRow) {
      const { data: claimRow, error: claimError } = await supabase.from('manager_portal_claims').select('*, game_worlds(name)').eq('auth_user_id', session.user.id).maybeSingle();
      setAccount(null); setClaim(claimRow || null); setAdminAssignments([]); setMessage(claimError ? claimError.message : claimRow?.status === 'pending' ? 'Your manager profile claim is awaiting approval.' : claimRow?.status === 'rejected' ? claimRow.review_notes || 'Your claim was not approved. You may correct it and submit again.' : 'Choose your game world and claim your manager profile to continue.'); setLoading(false); return;
    }
    const [entryResult, accessResult] = await Promise.all([
      supabase.from('tournament_entries').select('id, tournament_id, manager_id, group_code, seed, pot, teams(id, name), tournaments!inner(id, name, status, season_number, public_slug, is_public, game_world_id)').eq('manager_id', accountRow.manager_id).eq('tournaments.game_world_id', accountRow.game_world_id),
      supabase.from('tournament_organisers').select('tournament_id, role, tournaments(id, name)').eq('auth_user_id', session.user.id).eq('active', true),
    ]);
    if (entryResult.error) { setMessage('Could not load your tournament entries: ' + entryResult.error.message); setLoading(false); return; }
    const entryRows = entryResult.data || [];
    const orderedEntries = [...entryRows].sort((a, b) => Number(b.tournaments?.season_number || 0) - Number(a.tournaments?.season_number || 0));
    const tournamentIds = [...new Set(orderedEntries.map((entry) => entry.tournament_id))]; let matchRows = [], peerEntries = [];
    if (tournamentIds.length) {
      const [matchResult, peerResult] = await Promise.all([
        supabase.from('matches').select('id, tournament_id, group_id, stage, round, leg, match_order, status, fixture_date, played_at, home_entry_id, away_entry_id, home_placeholder, away_placeholder, home_score, away_score, bracket, home_entry:tournament_entries!matches_home_entry_id_fkey(id, teams(name)), away_entry:tournament_entries!matches_away_entry_id_fkey(id, teams(name))').in('tournament_id', tournamentIds),
        supabase.from('tournament_entries').select('id, tournament_id, group_code, teams(name)').in('tournament_id', tournamentIds),
      ]);
      if (!matchResult.error) matchRows = matchResult.data || []; if (!peerResult.error) peerEntries = peerResult.data || [];
    }
    setAccount(accountRow); setClaim(null); setEntries(orderedEntries); setSelectedEntryId((current) => current || orderedEntries[0]?.id || ''); setMatches(matchRows); setGroupEntries(peerEntries); setAdminAssignments(accessResult.error ? [] : (accessResult.data || [])); setMessage('Portal loaded.'); setLoading(false);
  }

  async function logout() { await supabase.auth.signOut(); setMessage('Signed out.'); }
  function opponent(match) {
    const isHome = match.home_entry_id === selectedEntry?.id;
    return isHome ? entryTeamName(match.away_entry, match.away_placeholder) : entryTeamName(match.home_entry, match.home_placeholder);
  }
  function venue(match) { return match.home_entry_id === selectedEntry?.id ? 'Home' : 'Away'; }

  if (!hasSupabaseConfig || !supabase) return <main className="manager-portal-shell"><section className="warning-card"><strong>Manager Portal unavailable.</strong><span>Supabase is not connected.</span></section></main>;
  if (!session) return <main className="manager-portal-shell"><section className="manager-portal-hero"><p className="eyebrow">Top 100 Tournament Manager</p><h1>Manager Portal</h1><p>Your fixtures, results, group table and tournament progress in one place.</p></section><section className="card manager-login-card"><h2>Sign in securely</h2><p className="muted">Enter your email address. We’ll send a one-time sign-in link.</p><form onSubmit={sendMagicLink}><label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><button type="submit" disabled={loading}>{loading ? 'Sending...' : 'Email me a sign-in link'}</button></form>{message && <p className="status">{message}</p>}</section></main>;
  if (loading) return <main className="manager-portal-shell"><section className="card"><h1>Loading Manager Portal...</h1></section></main>;
  if (!account) return <main className="manager-portal-shell"><section className="manager-portal-hero"><div><p className="eyebrow">Manager Portal</p><h1>{claim?.status === 'pending' ? 'Claim awaiting approval' : 'Claim your profile'}</h1><p>Signed in securely as {session.user.email}</p></div><button type="button" className="secondary" onClick={logout}>Sign out</button></section><section className="card manager-login-card">{claim?.status === 'pending' ? <><h2>We’ve got your claim</h2><p><strong>{claim.claimed_manager_name}</strong> · {claim.claimed_club_name} · {claim.game_worlds?.name || 'Game world'}</p><button type="button" onClick={loadPortal}>Check approval</button></> : <form onSubmit={submitClaim}><h2>Match your Soccer Manager identity</h2><label>Game world<select value={claimForm.gameWorldId} onChange={(event) => setClaimForm({ gameWorldId: event.target.value, managerName: '', clubName: '' })} required><option value="">Choose game world</option>{gameWorlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}</select></label><label>Current club<select value={claimForm.clubName} onChange={(event) => { const club = worldClubs.find((item) => item.club_name === event.target.value); setClaimForm((current) => ({ ...current, clubName: event.target.value, managerName: club?.current_manager_name || '' })); }} required disabled={!claimForm.gameWorldId}><option value="">Choose your club</option>{worldClubs.map((club) => <option key={club.id} value={club.club_name}>{club.club_name}</option>)}</select></label><label>SM manager name<input value={claimForm.managerName} onChange={(event) => setClaimForm((current) => ({ ...current, managerName: event.target.value }))} required /></label>{selectedClaimClub?.current_manager_name && <p className="muted">Directory manager: <strong>{selectedClaimClub.current_manager_name}</strong></p>}<button type="submit">Submit manager claim</button></form>}</section>{message && <section className="card"><p className="status">{message}</p></section>}</main>;

  return <main className="manager-portal-shell"><section className="manager-portal-hero"><div><p className="eyebrow">Manager Portal · {account.game_worlds?.name || 'Top 100'}</p><h1>{account.managers?.display_name || account.managers?.name || 'Top 100 Manager'}</h1><p>{selectedEntry ? `${selectedEntry.teams?.name} · ${selectedEntry.tournaments?.name}` : 'No active tournament entry found'}</p></div><div className="button-row">{organiserAssignments.length > 0 && <a className="button" href="/admin">{organiserAssignments.length === 1 ? `Manage ${organiserAssignments[0].tournaments?.name || 'tournament'}` : 'Manage tournaments'}</a>}<a className="button secondary" href="/manager/registration">Register a team</a><button type="button" className="secondary" onClick={logout}>Sign out</button></div></section>
    {entries.length > 1 && <section className="card portal-selector"><label>Tournament entry<select value={selectedEntry?.id || ''} onChange={(event) => setSelectedEntryId(event.target.value)}>{entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.tournaments?.name} — {entry.teams?.name}</option>)}</select></label></section>}
    {!selectedEntry ? <section className="card"><h2>Account linked successfully</h2><p>Your fixtures will appear here when you enter a competition.</p><a className="button" href="/manager/registration">Register for a tournament</a></section> : <>
      <section className="portal-metrics"><article><span>Team</span><strong>{selectedEntry.teams?.name}</strong></article><article><span>Group</span><strong>{selectedEntry.group_code ? `Group ${selectedEntry.group_code}` : 'TBC'}</strong></article><article><span>Position</span><strong>{ordinal(myPosition)}</strong></article><article><span>Record</span><strong>{results.length} played</strong></article></section>
      <ManagerResultCentre selectedEntry={selectedEntry} fixtures={upcoming} onResultChanged={loadPortal} />
      <section className="portal-grid"><article className="card portal-panel"><div className="card-header"><p className="eyebrow">Up next</p><h2>Your fixtures</h2></div>{upcoming.length ? <div className="portal-fixtures">{upcoming.map((match) => <div className="portal-fixture" key={match.id}><div><strong>{venue(match)} vs {opponent(match)}</strong><span>{match.round} · {match.bracket || match.stage}</span></div><time>{matchDate(match)}</time></div>)}</div> : <p className="muted">No outstanding fixtures.</p>}</article><article className="card portal-panel"><div className="card-header"><p className="eyebrow">Recent</p><h2>Your results</h2></div>{results.length ? <div className="portal-fixtures">{results.map((match) => { const home = match.home_entry_id === selectedEntry.id, mine = home ? match.home_score : match.away_score, theirs = home ? match.away_score : match.home_score, doubleForfeit = match.status === 'forfeit' && Number(match.home_score) === 0 && Number(match.away_score) === 0, outcome = doubleForfeit ? 'L' : mine > theirs ? 'W' : mine < theirs ? 'L' : 'D'; return <div className="portal-fixture" key={match.id}><div><strong><span className={`portal-outcome ${outcome}`}>{outcome}</span> {venue(match)} vs {opponent(match)}</strong><span>{match.round} · {matchDate(match)}{doubleForfeit ? ' · double forfeit' : ''}</span></div><b>{mine}–{theirs}</b></div>; })}</div> : <p className="muted">No results entered yet.</p>}</article></section>
      {selectedEntry.group_code && <section className="card portal-panel"><div className="card-header"><p className="eyebrow">Live standings</p><h2>Group {selectedEntry.group_code}</h2></div><div className="table-wrap"><table className="portal-table"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>{standings.map((row, index) => <tr key={row.id} className={row.id === selectedEntry.id ? 'my-team' : ''}><td>{index + 1}</td><td><strong>{row.team}</strong></td><td>{row.played}</td><td>{row.won}</td><td>{row.drawn}</td><td>{row.lost}</td><td>{row.gd}</td><td><strong>{row.points}</strong></td></tr>)}</tbody></table></div></section>}
    </>}
  </main>;
}
