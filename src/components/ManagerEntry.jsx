import { useEffect, useMemo, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import ManagerPortal from './ManagerPortal.jsx';
import ManagerResourceHub from './ManagerResourceHub.jsx';
import ManagerReminderPreferences from './ManagerReminderPreferences.jsx';

const REQUEST_TIMEOUT_MS = 10000;

function timeout(promise, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = window.setTimeout(() => reject(new Error(`${label} timed out. Please try again.`)), REQUEST_TIMEOUT_MS);
    }),
  ]).finally(() => window.clearTimeout(timer));
}

function safeReturnTo() {
  const value = new URLSearchParams(window.location.search).get('returnTo');
  try {
    const url = new URL(value || '');
    return url.hostname.endsWith('.smtop100.blog') ? url.toString() : '';
  } catch {
    return '';
  }
}

function SignIn({ returnTo, registrationMode }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle');
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    const address = email.trim();
    if (!address || state === 'sending') return;
    setState('sending');
    setMessage('');
    try {
      const path = registrationMode ? '/registrations' : '/';
      const suffix = returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : '';
      const { error } = await timeout(
        supabase.auth.signInWithOtp({
          email: address,
          options: {
            emailRedirectTo: `${window.location.origin}${path}${suffix}`,
            shouldCreateUser: true,
          },
        }),
        'Sign-in link request',
      );
      if (error) throw error;
      setState('sent');
      setMessage(`Sign-in link sent to ${address}. Use the newest email you receive.`);
    } catch (error) {
      setState('error');
      setMessage(error?.message || 'We could not send the sign-in link.');
    }
  }

  return (
    <main className="manager-portal-shell">
      <section className="manager-portal-hero">
        <p className="eyebrow">Top 100</p>
        <h1>Manager sign-in</h1>
        <p>One sign-in for My Matches and the rest of Top 100.</p>
      </section>
      <section className="card manager-login-card">
        <h2>{state === 'sent' ? 'Check your email' : 'Sign in securely'}</h2>
        {state === 'sent' ? (
          <>
            <p className="status" role="status">{message}</p>
            <p className="muted">The link can take a few minutes to arrive. Older links may stop working after you request a newer one.</p>
            <button type="button" className="secondary" onClick={() => { setState('idle'); setMessage(''); }}>Use a different email</button>
          </>
        ) : (
          <form onSubmit={submit}>
            <label>Email address<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required disabled={state === 'sending'} /></label>
            <button type="submit" disabled={state === 'sending'}>{state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}</button>
            {message && <p className="status" role="alert">{message}</p>}
          </form>
        )}
      </section>
    </main>
  );
}

function Setup({ session, claim: initialClaim, onClaimChanged }) {
  const [worlds, setWorlds] = useState([]);
  const [clubs, setClubs] = useState([]);
  const [worldId, setWorldId] = useState('');
  const [clubName, setClubName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [claim, setClaim] = useState(initialClaim);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    timeout(
      supabase.from('game_worlds').select('id, name, slug').in('slug', ['top-100', 'regen']).order('id'),
      'Game world lookup',
    ).then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(error.message);
      else setWorlds(data || []);
    }).catch((error) => active && setMessage(error.message));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    setClubs([]);
    setClubName('');
    if (!worldId) return undefined;
    let active = true;
    timeout(
      supabase.from('game_world_clubs')
        .select('id, club_name, current_manager_name')
        .eq('game_world_id', Number(worldId))
        .eq('active', true)
        .eq('occupied', true)
        .order('club_name'),
      'Club lookup',
    ).then(({ data, error }) => {
      if (!active) return;
      if (error) setMessage(error.message);
      else setClubs(data || []);
    }).catch((error) => active && setMessage(error.message));
    return () => { active = false; };
  }, [worldId]);

  const selectedClub = useMemo(() => clubs.find((row) => row.club_name === clubName) || null, [clubs, clubName]);

  async function submit(event) {
    event.preventDefault();
    if (!worldId || !clubName || !managerName.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const payload = {
        auth_user_id: session.user.id,
        email: session.user.email,
        game_world_id: Number(worldId),
        claimed_manager_name: managerName.trim(),
        claimed_club_name: clubName,
        suggested_manager_id: null,
        status: 'pending',
        review_notes: null,
        reviewed_by: null,
        reviewed_at: null,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await timeout(
        supabase.from('manager_portal_claims')
          .upsert(payload, { onConflict: 'auth_user_id' })
          .select('*, game_worlds(name)')
          .single(),
        'Manager link request',
      );
      if (error) throw error;
      setClaim(data);
      setMessage('Your manager link request has been sent for approval.');
      onClaimChanged?.(data);
    } catch (error) {
      setMessage(error?.message || 'Could not submit your manager link request.');
    } finally {
      setBusy(false);
    }
  }

  if (claim?.status === 'pending') {
    return <main className="manager-portal-shell"><section className="manager-portal-hero"><p className="eyebrow">Top 100 account</p><h1>Account link awaiting approval</h1><p>You are signed in as {session.user.email}. Your request to link {claim.claimed_manager_name} at {claim.claimed_club_name} has been received.</p></section><section className="card"><p>You do not need another sign-in link. Once an administrator approves the link, reload this page and you can continue.</p><button type="button" className="secondary" onClick={() => supabase.auth.signOut()}>Sign out</button></section></main>;
  }

  return (
    <main className="manager-portal-shell">
      <section className="manager-portal-hero">
        <p className="eyebrow">Top 100 account</p>
        <h1>Link your manager</h1>
        <p>Sign-in complete ✓ · {session.user.email}</p>
      </section>
      <section className="card manager-login-card">
        <h2>One last step</h2>
        <p className="muted">Choose your game world and current club. This is the only setup needed for your Top 100 account.</p>
        <form onSubmit={submit}>
          <label>Game world<select value={worldId} onChange={(event) => setWorldId(event.target.value)} required><option value="">Choose game world…</option>{worlds.map((world) => <option key={world.id} value={world.id}>{world.name}</option>)}</select></label>
          <label>Current club<select value={clubName} onChange={(event) => setClubName(event.target.value)} required disabled={!worldId}><option value="">Choose club…</option>{clubs.map((club) => <option key={club.id} value={club.club_name}>{club.club_name}</option>)}</select></label>
          <label>Soccer Manager name<input value={managerName} onChange={(event) => setManagerName(event.target.value)} required /></label>
          {selectedClub?.current_manager_name && <p className="muted">Directory manager: {selectedClub.current_manager_name}</p>}
          <button type="submit" disabled={busy}>{busy ? 'Linking…' : 'Link my manager'}</button>
          {message && <p className="status" role="status">{message}</p>}
        </form>
      </section>
    </main>
  );
}

export default function ManagerEntry({ registrationMode = false }) {
  const returnTo = safeReturnTo();
  const [session, setSession] = useState(undefined);
  const [identity, setIdentity] = useState({ state: 'idle', account: null, claim: null, error: '' });

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase) {
      setSession(null);
      return undefined;
    }

    let active = true;
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      // INITIAL_SESSION is the single bootstrap authority. No getSession(),
      // token restoration, cross-origin migration or recovery loop.
      setSession(nextSession || null);
      if (!nextSession) setIdentity({ state: 'idle', account: null, claim: null, error: '' });
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!session?.user) return undefined;
    let active = true;
    setIdentity({ state: 'loading', account: null, claim: null, error: '' });

    (async () => {
      try {
        // Identity bootstrap is deliberately only two small lookups. Tournament
        // data is not touched until we know this is an approved linked manager.
        const accountResult = await timeout(
          supabase.from('manager_portal_accounts')
            .select('id, manager_id, game_world_id, email, active')
            .eq('auth_user_id', session.user.id)
            .eq('active', true)
            .maybeSingle(),
          'Manager account lookup',
        );
        if (accountResult.error) throw accountResult.error;
        if (!active) return;
        if (accountResult.data) {
          setIdentity({ state: 'linked', account: accountResult.data, claim: null, error: '' });
          return;
        }

        const claimResult = await timeout(
          supabase.from('manager_portal_claims')
            .select('*, game_worlds(name)')
            .eq('auth_user_id', session.user.id)
            .maybeSingle(),
          'Manager link lookup',
        );
        if (claimResult.error) throw claimResult.error;
        if (!active) return;
        setIdentity({ state: 'setup', account: null, claim: claimResult.data || null, error: '' });
      } catch (error) {
        if (active) setIdentity({ state: 'error', account: null, claim: null, error: error?.message || 'Could not check your manager account.' });
      }
    })();

    return () => { active = false; };
  }, [session?.user?.id]);

  if (!hasSupabaseConfig || !supabase) return <main className="manager-portal-shell"><section className="warning-card"><strong>Manager sign-in unavailable.</strong><span>Supabase is not connected.</span></section></main>;
  if (session === undefined) return <main className="manager-portal-shell"><section className="card"><h1>Manager sign-in</h1><p>Checking your sign-in…</p></section></main>;
  if (!session) return <SignIn returnTo={returnTo} registrationMode={registrationMode} />;
  if (identity.state === 'loading' || identity.state === 'idle') return <main className="manager-portal-shell"><section className="card"><h1>Manager sign-in</h1><p>Signed in ✓ · Checking your manager link…</p></section></main>;
  if (identity.state === 'error') return <main className="manager-portal-shell"><section className="card"><h1>We couldn't check your manager link</h1><p className="status">{identity.error}</p><button type="button" className="secondary" onClick={() => supabase.auth.signOut()}>Sign out</button></section></main>;
  if (identity.state === 'setup') return <Setup session={session} claim={identity.claim} onClaimChanged={(claim) => setIdentity({ state: 'setup', account: null, claim, error: '' })} />;

  return (
    <>
      <ManagerPortal registrationMode={registrationMode} returnTo={returnTo} session={session} />
      {!registrationMode && <ManagerReminderPreferences session={session} authLoading={false} />}
      {!registrationMode && <ManagerResourceHub />}
    </>
  );
}
