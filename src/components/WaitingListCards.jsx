import { useCallback, useEffect, useState } from 'react';
import { RulesCheckPrompt } from './RulesCheckBadge.jsx';
import { supabase } from '../lib/supabaseClient';

// Waiting list (rulebook 3.3): joining and following your place, and recommendations or concerns
// from current managers.
const RULES_URL = 'https://smtop100.blog/rules/';
const WORLDS = [['regen', 'Top 100 Regen'], ['top-100', 'Top 100']];
export const RULES_AGREEMENT = 'I have read and understood the Top 100 rules, and the Top 100 Regen rules where they apply, and I agree to follow them. '
  + 'I accept that the rules may change after I join, by a vote of the managers or by decision of the administrators, and that I will follow the rules as they stand at the time.';
const FOUND_OPTIONS = ['A current Top 100 or Regen manager', 'Soccer Manager forums or newsfeed', 'smtop100.blog', 'Social media', 'I managed in Top 100 before', 'Other'];
const STATUS = { waiting: 'On the waiting list', offered: 'Offered a club', appointed: 'Appointed', withdrawn: 'Left the list', lapsed: 'Lapsed' };
const shortDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

// Free clubs in one game world, and up to three choices in order (rule 3.3: clubs are still offered
// in waiting-list order; the administrators use the choices when they make an offer).
const NO_CHOICES = [];

function ClubChoices({ world, clubs, saved, onSaved }) {
  // Only clubs that are still free can be chosen; a saved choice that has since been taken is
  // dropped from the menus (and the Save button offered) so it can't block saving.
  const freeIds = new Set(clubs.map((club) => String(club.id)));
  const savedKey = saved.join(',');
  const clubsKey = clubs.map((club) => club.id).join(',');
  const fromSaved = () => {
    const kept = saved.map(String).filter((id) => freeIds.has(id));
    return [0, 1, 2].map((i) => kept[i] || '');
  };
  const [choices, setChoices] = useState(fromSaved);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  // Reset the draft only when the saved choices or the free clubs actually change.
  useEffect(() => { setChoices(fromSaved()); }, [savedKey, clubsKey]);
  const takenSince = saved.some((id) => !freeIds.has(String(id)));
  if (!clubs.length) {
    return <p className="muted top100-waiting__clubs">No clubs are free in this game world right now. We&apos;ll offer you one when a place opens.</p>;
  }
  const label = (club) => `${club.name}${club.division ? ` (Div ${club.division})` : ''}${club.inVacancyRound ? ' · current managers first' : ''}`;
  const changed = choices.filter(Boolean).join(',') !== saved.map(String).join(',');
  async function save() {
    setBusy(true);
    setNote('');
    const ids = choices.filter(Boolean).map(Number);
    const { data, error } = await supabase.rpc('set_waiting_list_choices', { p_world_slug: world, p_club_ids: ids });
    setBusy(false);
    if (error) { setNote(error.message); return; }
    onSaved(data || []);
    setNote(ids.length ? 'Your choices are saved.' : 'Choices cleared.');
  }
  return (
    <div className="top100-waiting__clubs">
      <p><strong>{clubs.length} club{clubs.length === 1 ? '' : 's'} free now:</strong> {clubs.map((club) => club.name).join(', ')}.</p>
      {takenSince && <p className="status">A club you chose has since been taken. Check your choices and save them again.</p>}
      <p className="muted">Choose up to three you&apos;d like, in order. Clubs are offered in waiting-list order (rule 3.3), and your choices are used when you&apos;re offered one.</p>
      <div className="top100-waiting__choice-row">
        {[0, 1, 2].map((i) => (
          <label key={i}>{['1st', '2nd', '3rd'][i]} choice
            <select value={choices[i]} onChange={(event) => setChoices(choices.map((value, j) => (j === i ? event.target.value : value)))}>
              <option value="">{i === 0 ? 'Choose a club…' : 'No preference'}</option>
              {clubs.filter((club) => !choices.some((value, j) => j !== i && value === String(club.id))).map((club) => (
                <option key={club.id} value={club.id}>{label(club)}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <button type="button" disabled={busy || !changed} onClick={save}>{busy ? 'Saving…' : 'Save my choices'}</button>
      {note && <p className="status" role="status">{note}</p>}
    </div>
  );
}

// Join the list, or follow your place on it. `standalone` renders a full card (the Manager Portal
// screen for people without a club); otherwise a collapsible card for the portal home.
// managedWorlds: slugs of the worlds where the manager already has a club (not offered).
export function WaitingListCard({ session, standalone = false, defaultName = '', managedWorlds = [] }) {
  const [entries, setEntries] = useState(null);
  const [openClubs, setOpenClubs] = useState({});
  const [choices, setChoices] = useState({});
  const [form, setForm] = useState({ worlds: [], name: defaultName, found: '', foundOther: '', agree: false });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    const [list, free, mine] = await Promise.all([
      supabase.rpc('my_waiting_list'),
      supabase.rpc('waiting_list_open_clubs'),
      supabase.rpc('my_waiting_list_choices'),
    ]);
    setOpenClubs(Object.fromEntries((free.data || []).map((world) => [world.world, world.clubs || []])));
    setChoices(mine.data || {});
    setEntries(list.error ? [] : list.data || []);
  }, []);
  useEffect(() => { if (session?.user?.id && supabase) load(); }, [session?.user?.id, load]);
  useEffect(() => { if (defaultName) setForm((current) => (current.name ? current : { ...current, name: defaultName })); }, [defaultName]);
  if (!entries) return null;

  const active = entries.filter((entry) => ['waiting', 'offered'].includes(entry.status));
  // Taken a club but not yet linked to a Manager Account (shown on the screen for people without one).
  const taken = standalone ? entries.filter((entry) => entry.status === 'appointed' && entry.club) : [];
  const open = WORLDS.filter(([slug]) => !managedWorlds.includes(slug) && !active.some((entry) => entry.world === slug));
  // On the portal home, current Top 100 managers only see the card while they're on a list.
  if (!standalone && !active.length && (managedWorlds.includes('top-100') || !open.length)) return null;
  const toggleWorld = (slug) => setForm((current) => ({
    ...current, worlds: current.worlds.includes(slug) ? current.worlds.filter((item) => item !== slug) : [...current.worlds, slug],
  }));

  async function join(event) {
    event.preventDefault();
    if (!form.worlds.length) { setMessage('Choose at least one game world.'); return; }
    if (!form.agree) { setMessage('Please accept the rules agreement.'); return; }
    setBusy(true);
    const found = form.found === 'Other' ? (form.foundOther.trim() || 'Other') : form.found;
    const { data, error } = await supabase.rpc('join_waiting_list', { p_world_slugs: form.worlds, p_sm_manager_name: form.name, p_how_found: found || null, p_agree: true });
    setBusy(false);
    if (error) { setMessage(error.message); return; }
    setEntries(data || []);
    setForm((current) => ({ ...current, worlds: [], agree: false }));
    setMessage("You're on the waiting list. Choose the clubs you'd like below; we'll be in touch when one is offered to you.");
  }

  // Open the usual Manager Account claim for the club they've taken, under their own name. It goes
  // ahead only once the club directory lists them as its manager: until it does, the directory may
  // still name the previous manager, and a claim must never be made under someone else's name.
  async function linkClub(entry) {
    setBusy(true);
    const { data: club } = await supabase.from('game_world_clubs').select('club_name, current_manager_name')
      .eq('game_world_id', entry.worldId).ilike('club_name', entry.club).eq('active', true).maybeSingle();
    const same = (a, b) => String(a || '').trim().toLowerCase().replace(/\s+/g, ' ') === String(b || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!club || !same(club.current_manager_name, entry.managerName)) {
      setBusy(false);
      setMessage(`Our club list doesn't show you at ${entry.club} yet. It updates after the next records check, so please try again later, or contact the admin team if it still doesn't work.`);
      return;
    }
    const payload = {
      auth_user_id: session.user.id, email: session.user.email, game_world_id: entry.worldId,
      claimed_manager_name: entry.managerName, claimed_club_name: club.club_name,
      status: 'pending', review_notes: null, reviewed_by: null, reviewed_at: null, updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('manager_portal_claims').upsert(payload, { onConflict: 'auth_user_id' });
    setBusy(false);
    if (error) { setMessage(`Could not link ${entry.club} yet (${error.message}). Please try again later.`); return; }
    window.location.reload();
  }

  async function update(world, withdraw) {
    if (withdraw && !window.confirm('Leave the waiting list? You can join again later, but your place starts again.')) return;
    const { data, error } = await supabase.rpc('update_my_waiting_list', { p_world_slug: world, p_withdraw: withdraw });
    if (error) { setMessage(error.message); return; }
    setEntries(data || []);
    setMessage(withdraw ? 'You have left that waiting list.' : 'Thanks, your place is confirmed for this season.');
  }

  const body = (
    <>
      {taken.map((entry) => (
        <div key={`taken-${entry.world}`} className="top100-waiting__taken">
          <p><strong>Welcome to {entry.worldName}!</strong> Our records show you've taken over <strong>{entry.club}</strong>. Link it to your Manager Account to finish setting up.</p>
          <button type="button" disabled={busy} onClick={() => linkClub(entry)}>Link {entry.club} to my account</button>
        </div>
      ))}
      {active.length > 0 && (
        <ul className="top100-waiting__entries">
          {active.map((entry) => (
            <li key={entry.world}>
              <strong>{entry.worldName}</strong> <span className="muted">as {entry.managerName} · joined {shortDate(entry.joinedAt)}</span>
              <div>
                {entry.status === 'offered' && entry.offer
                  ? <>Offered <strong>{entry.offer.club}</strong>{entry.offer.deadline ? `: accept by ${shortDate(entry.offer.deadline)}` : ''}. The admin team will contact you by email.</>
                  : <>{STATUS[entry.status]}{entry.place ? ` · about ${entry.place} of ${entry.waiting}` : ''}</>}
              </div>
              <div className="button-row">
                {entry.needsConfirming && <button type="button" onClick={() => update(entry.world, false)}>Confirm for this season</button>}
                <button type="button" className="secondary" onClick={() => update(entry.world, true)}>Leave the list</button>
              </div>
              {entry.needsConfirming && <p className="muted">Please confirm you're still interested this season, or your place lapses.</p>}
              {entry.status === 'waiting' && (
                <ClubChoices world={entry.world} clubs={openClubs[entry.world] || []} saved={choices[entry.world] || NO_CHOICES}
                  onSaved={(ids) => setChoices((current) => ({ ...current, [entry.world]: ids }))} />
              )}
            </li>
          ))}
        </ul>
      )}

      {open.length > 0 && (
        <form className="top100-waiting__form" onSubmit={join}>
          {active.length > 0 && <p className="eyebrow">Join another list</p>}
          <fieldset>
            <legend>Game world</legend>
            {open.map(([slug, label]) => (
              <label key={slug} className="top100-waiting__check">
                <input type="checkbox" checked={form.worlds.includes(slug)} onChange={() => toggleWorld(slug)} /> {label}
                <span className="muted"> · {(openClubs[slug] || []).length ? `${openClubs[slug].length} club${openClubs[slug].length === 1 ? '' : 's'} free now` : 'no clubs free right now'}</span>
              </label>
            ))}
            {open.some(([slug]) => slug === 'regen') && <p className="muted">New managers are encouraged to start in Top 100 Regen and prove themselves there.</p>}
          </fieldset>
          <label>Your Soccer Manager manager name
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={80} required />
          </label>
          <label>How did you find Top 100?
            <select value={form.found} onChange={(event) => setForm({ ...form, found: event.target.value })}>
              <option value="">Choose…</option>
              {FOUND_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          {form.found === 'Other' && <label>Tell us more<input value={form.foundOther} maxLength={300} onChange={(event) => setForm({ ...form, foundOther: event.target.value })} /></label>}
          <RulesCheckPrompt context="before you join" />
          <label className="top100-waiting__check top100-waiting__agree">
            <input type="checkbox" checked={form.agree} onChange={(event) => setForm({ ...form, agree: event.target.checked })} required />
            <span>{RULES_AGREEMENT} <a href={RULES_URL} target="_blank" rel="noopener noreferrer">Read the rules</a></span>
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Joining…' : 'Join the waiting list'}</button>
        </form>
      )}
      {message && <p className="status" role="status">{message}</p>}
      <p className="muted top100-app-card__meta">
        Former Top 100 managers coming back come first, then everyone else in order of the waiting-list score (rule 3.3).
      </p>
    </>
  );

  if (standalone) {
    return (
      <section className="card top100-waiting">
        <h2>Join Top 100 or Top 100 Regen</h2>
        <p><strong>Applied for a club in Soccer Manager?</strong> Join here for that game world, agree to the rules, then choose the club you applied for as your 1st choice. Agreeing to the rules is what we need before we accept your application. Once Soccer Manager shows you as the manager, you can link the club to your account here.</p>
        <p className="muted">Not applied yet, or coming back after a break? Join and choose from the free clubs, and we&apos;ll offer you one when it&apos;s your turn.</p>
        {body}
      </section>
    );
  }
  return (
    <details className="top100-market top100-waiting" open={active.some((entry) => entry.status === 'offered' || entry.needsConfirming) || undefined}>
      <summary>
        <h3>Waiting list</h3>
        <span className="muted">{active.length ? active.map((entry) => `${entry.worldName}: ${STATUS[entry.status].toLowerCase()}`).join(' · ') : 'Join Top 100 or Top 100 Regen'}</span>
        <span className="top100-market__toggle" aria-hidden="true" />
      </summary>
      {body}
    </details>
  );
}

// Current managers: recommend applicants or raise a concern (confidential to the admin team).
export function WaitingListRecommendCard({ session }) {
  const [rows, setRows] = useState(null);
  const [notes, setNotes] = useState({});
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!session?.user?.id || !supabase) return undefined;
    let active = true;
    supabase.rpc('waiting_list_for_managers').then(({ data, error }) => { if (active) setRows(error ? [] : data || []); });
    return () => { active = false; };
  }, [session?.user?.id]);
  if (!rows?.length) return null;

  async function endorse(row, kind) {
    const { data, error } = await supabase.rpc('endorse_waiting_list_entry', { p_entry_id: row.id, p_kind: kind, p_note: notes[row.id] ?? row.mine?.note ?? null });
    if (error) { setMessage(error.message); return; }
    setRows(data || []);
    setMessage(kind === 'recommend' ? `Recommendation saved for ${row.managerName}.` : kind === 'concern' ? `Concern about ${row.managerName} sent to the admin team.` : 'Removed.');
  }

  return (
    <details className="top100-market top100-waiting">
      <summary>
        <h3>Waiting list</h3>
        <span className="muted">{rows.length} manager{rows.length === 1 ? '' : 's'} waiting · recommend or raise a concern</span>
        <span className="top100-market__toggle" aria-hidden="true" />
      </summary>
      <p className="muted">
        Know someone on the list? A recommendation adds to their waiting-list score. A concern takes points off and is seen only by the
        admin team, never by the manager. One each per applicant.
      </p>
      <ul className="top100-waiting__entries">
        {rows.map((row) => (
          <li key={row.id}>
            <strong>{row.managerName}</strong> <span className="muted">{row.worldName} · joined {shortDate(row.joinedAt)}</span>
            {row.mine && <div className="muted">You {row.mine.kind === 'recommend' ? 'recommended' : 'raised a concern about'} this manager.</div>}
            <input aria-label={`Note about ${row.managerName}`} placeholder="Optional note for the admin team" maxLength={1000}
              value={notes[row.id] ?? row.mine?.note ?? ''} onChange={(event) => setNotes({ ...notes, [row.id]: event.target.value })} />
            <div className="button-row">
              <button type="button" className={row.mine?.kind === 'recommend' ? '' : 'secondary'} onClick={() => endorse(row, 'recommend')}>Recommend</button>
              <button type="button" className={row.mine?.kind === 'concern' ? '' : 'secondary'} onClick={() => endorse(row, 'concern')}>Raise a concern</button>
              {row.mine && <button type="button" className="secondary" onClick={() => endorse(row, null)}>Remove</button>}
            </div>
          </li>
        ))}
      </ul>
      {message && <p className="status" role="status">{message}</p>}
    </details>
  );
}
