import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { WAITING_LIST_PARTS, waitingListScore } from '../lib/waitingList';

// Admin team: the waiting list (rule 3.3) for one game world. Each applicant's Top 100 record comes
// from Stats & History (the archive's appointment-scores function, mode "history"); Regen seasons,
// Soccer Manager stints, Gold and game worlds come from Top 100's records; recommendations and
// concerns from current managers. Scores are worked out here and saved, which sets the order the
// applicants see.
const SCORES_URL = 'https://archive.smtop100.blog/.netlify/functions/appointment-scores';
const NUM = { textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
const STATUS = { waiting: 'Waiting', offered: 'Offered', appointed: 'Appointed', withdrawn: 'Withdrawn', lapsed: 'Lapsed' };
const shortDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : '');
const yesNo = (value) => (value === true ? 'Yes' : value === false ? 'No' : '?');
const ordinal = (n) => { const v = n % 100; return `${n}${['th', 'st', 'nd', 'rd'][(v - 20) % 10] || ['th', 'st', 'nd', 'rd'][v] || 'th'}`; };

async function fetchHistory(currentSeason, applicants) {
  if (!applicants.length) return {};
  const response = await fetch(SCORES_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'history', currentSeason, applicants }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Stats & History returned ${response.status}`);
  return Object.fromEntries((body.applicants || []).map((item) => [item.key, item]));
}

function EntryDetails({ entry, scored, history, onUpdate, onEmailOffer }) {
  const [fields, setFields] = useState({
    gold: entry.goldFrom === 'admin' ? String(entry.gold) : '', gameWorlds: entry.gameWorldsFrom === 'admin' ? String(entry.gameWorlds ?? '') : '',
    smManagerId: entry.smManagerId || '', adminNotes: entry.adminNotes || '', offerClub: entry.offerClub || '',
    offerDeadline: entry.offerDeadline ? entry.offerDeadline.slice(0, 10) : '',
  });
  const set = (key) => (event) => setFields({ ...fields, [key]: event.target.value });
  const save = (extra = {}) => onUpdate(entry.id, {
    gold: fields.gold === '' ? null : fields.gold === 'true',
    gameWorlds: fields.gameWorlds === '' ? null : Number(fields.gameWorlds),
    smManagerId: fields.smManagerId, adminNotes: fields.adminNotes,
    ...extra,
  });
  const top100Stints = entry.stints.filter((stint) => stint.world === 1);
  const regenStints = entry.stints.filter((stint) => stint.world === 2);
  return (
    <div style={{ display: 'grid', gap: 10, padding: '8px 0 16px' }}>
      <div className="muted">
        {entry.email} · joined {shortDate(entry.joinedAt)} · agreed to the rules {shortDate(entry.agreedAt)} · confirmed for season {entry.confirmedSeason ?? '—'}
        {entry.howFound ? ` · found us: ${entry.howFound}` : ''}
      </div>
      <div>
        <strong>Top 100 (Stats &amp; History): </strong>
        {history?.returning
          ? <>{history.matched !== entry.managerName ? <>matched as <strong>{history.matched}</strong> (check this is the same manager) · </> : ''}
              S{history.firstSeason}–S{history.lastSeason}, {history.seasons} season{history.seasons === 1 ? '' : 's'}, {history.titles} title{history.titles === 1 ? '' : 's'} ·{' '}
              {history.spells.map((spell) => `${spell.club} S${spell.from}${spell.to > spell.from ? `–${spell.to}` : ''} (best D${spell.bestDivision} ${ordinal(spell.bestPosition)})`).join('; ')} ·
              record {history.score}/80 ({history.parts.map((part) => `${part.label.toLowerCase()} ${part.score}`).join(', ')})</>
          : history ? 'no Top 100 seasons found' : 'not loaded'}
      </div>
      <div>
        <strong>Soccer Manager clubs in our worlds: </strong>
        {entry.stints.length
          ? [...top100Stints.map((stint) => ['Top 100', stint]), ...regenStints.map((stint) => ['Regen', stint])]
            .map(([world, stint]) => `${world}: ${stint.club} ${shortDate(stint.from)}–${stint.to ? shortDate(stint.to) : 'now'} (${stint.games} games)`).join('; ')
          : 'none found by name'}
        {entry.regenSeasons ? ` · Regen seasons in the league tables: ${entry.regenSeasons}` : ''}
      </div>
      {entry.endorsements.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {entry.endorsements.map((item, index) => (
            <li key={index}><strong>{item.kind === 'recommend' ? 'Recommended' : 'Concern'}</strong> by {item.by} ({shortDate(item.at)}){item.note ? `: “${item.note}”` : ''}</li>
          ))}
        </ul>
      )}
      <div className="muted">
        {entry.checkedAt ? `Gold and game worlds last read ${shortDate(entry.checkedAt)}. ` : ''}
        {entry.offerEmailedAt ? `Offer emailed ${shortDate(entry.offerEmailedAt)}. ` : ''}
        Score {scored.score}: {WAITING_LIST_PARTS.map(([part, label]) => `${label.toLowerCase()} ${scored.parts[part]}`).join(' · ')}
        {scored.parts.concerns ? ` · concerns ${scored.parts.concerns}` : ''}{scored.unknown.length ? ` (half points for unknown ${scored.unknown.join(' and ')})` : ''}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label style={{ fontSize: 13 }}>Gold (override)
          <select value={fields.gold} onChange={set('gold')} style={{ display: 'block' }}>
            <option value="">From records ({entry.goldFrom === 'records' ? yesNo(entry.gold) : 'unknown'})</option>
            <option value="true">Yes</option><option value="false">No</option>
          </select>
        </label>
        <label style={{ fontSize: 13 }}>Game worlds (override)
          <input type="number" min="0" max="500" value={fields.gameWorlds} onChange={set('gameWorlds')} placeholder={entry.gameWorldsFrom === 'records' ? String(entry.gameWorlds) : '?'} style={{ display: 'block', width: 90 }} />
        </label>
        <label style={{ fontSize: 13 }}>SM manager ID
          <input value={fields.smManagerId} onChange={set('smManagerId')} style={{ display: 'block', width: 110 }} />
        </label>
        <label style={{ fontSize: 13, flex: 1, minWidth: 200 }}>Admin notes (private)
          <input value={fields.adminNotes} onChange={set('adminNotes')} style={{ display: 'block', width: '100%' }} />
        </label>
        <button type="button" className="secondary" onClick={() => save()}>Save</button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <label style={{ fontSize: 13 }}>Offer club
          <input value={fields.offerClub} onChange={set('offerClub')} style={{ display: 'block', width: 180 }} />
        </label>
        <label style={{ fontSize: 13 }}>Accept by
          <input type="date" value={fields.offerDeadline} onChange={set('offerDeadline')} style={{ display: 'block' }} />
        </label>
        <button type="button" disabled={!fields.offerClub.trim()} onClick={async () => {
          if (await save({ status: 'offered', offerClub: fields.offerClub, offerDeadline: fields.offerDeadline ? `${fields.offerDeadline}T23:59:00Z` : null })) onEmailOffer(entry.id);
        }}>Offer and email</button>
        {entry.status === 'offered' && <button type="button" className="secondary" onClick={() => onEmailOffer(entry.id)}>Email the offer again</button>}
        {entry.status !== 'appointed' && <button type="button" className="secondary" onClick={() => save({ status: 'appointed' })}>Mark appointed</button>}
        {entry.status !== 'waiting' && <button type="button" className="secondary" onClick={() => save({ status: 'waiting', offerClub: null, offerDeadline: null })}>Back to waiting</button>}
        {!['withdrawn', 'lapsed'].includes(entry.status) && <button type="button" className="secondary" onClick={() => save({ status: 'lapsed' })}>Lapse</button>}
      </div>
    </div>
  );
}

export default function AdminWaitingListTab({ setMessage }) {
  const [world, setWorld] = useState('top-100');
  const [data, setData] = useState(null);
  const [history, setHistory] = useState({});
  const [historyError, setHistoryError] = useState('');
  // Scores can only be saved once this world's Stats & History records have loaded; otherwise
  // returning managers would be saved with no Top 100 record and lose their priority.
  const [historyReady, setHistoryReady] = useState(false);
  // Only the latest load (for the selected world) may publish its results.
  const loadId = useRef(0);
  const [openId, setOpenId] = useState(null);
  const [showClosed, setShowClosed] = useState(false);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    const current = () => id === loadId.current;
    setHistoryReady(false);
    const { data: list, error } = await supabase.rpc('waiting_list_admin', { p_world_slug: world });
    if (!current()) return;
    if (error) { setMessage(error.message); return; }
    setData(list);
    setHistoryError('');
    try {
      const { data: season } = await supabase.rpc('appointment_current_season', { p_world_slug: 'top-100' });
      const loaded = await fetchHistory(Number(season) || 28, (list.entries || []).map((entry) => ({ key: String(entry.id), name: entry.managerName })));
      if (!current()) return;
      setHistory(loaded);
      setHistoryReady(true);
    } catch (error) {
      if (!current()) return;
      setHistory({});
      setHistoryError(`Top 100 records could not be loaded from Stats & History (${error.message}). Scores can't be saved until they load; try again shortly.`);
    }
  }, [world, setMessage]);
  useEffect(() => { setData(null); setHistory({}); load(); }, [load]);

  // Scores and order worked out from what's on the page: returning managers first, then score, then date joined.
  const rows = useMemo(() => (data?.entries || []).map((entry) => {
    const scored = waitingListScore({ world, history: history[String(entry.id)], regenSeasons: entry.regenSeasons, gold: entry.gold, gameWorlds: entry.gameWorlds, endorsements: entry.endorsements });
    return { entry, scored };
  }), [data, history, world]);
  const waiting = rows.filter(({ entry }) => entry.status === 'waiting')
    .sort((a, b) => Number(b.scored.returning) - Number(a.scored.returning) || b.scored.score - a.scored.score || a.entry.joinedAt.localeCompare(b.entry.joinedAt));
  const offered = rows.filter(({ entry }) => entry.status === 'offered');
  const closed = rows.filter(({ entry }) => !['waiting', 'offered'].includes(entry.status));
  const unsaved = waiting.some(({ entry, scored }) => Number(entry.score) !== scored.score || Boolean(entry.returning) !== scored.returning);

  async function saveScores() {
    if (!historyReady) return;
    const scores = Object.fromEntries(rows.map(({ entry, scored }) => [String(entry.id), { score: scored.score, returning: scored.returning, parts: scored.parts }]));
    setMessage('Saving…');
    const { error } = await supabase.rpc('save_waiting_list_scores', { p_world_slug: world, p_scores: scores });
    if (error) { setMessage(error.message); return; }
    await load();
    setMessage('Scores saved. Applicants now see their place in this order.');
  }

  async function update(id, fields) {
    setMessage('Saving…');
    const { error } = await supabase.rpc('update_waiting_list_entry', { p_id: id, p_fields: fields });
    if (error) { setMessage(error.message); return false; }
    await load();
    setMessage('Saved.');
    return true;
  }

  // Email the applicant their offer (replies go to the admin team).
  async function emailOffer(id) {
    setMessage('Emailing the offer…');
    const { data: { session } } = await supabase.auth.getSession();
    const response = await fetch('/.netlify/functions/waiting-list-offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify({ entryId: id }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setMessage(`Offer saved, but the email wasn't sent: ${body.error || response.status}`); return; }
    await load();
    setMessage(`Offer emailed to ${body.to}. Replies come to the admin team.`);
  }

  const table = (list, numbered) => (
    <div style={{ overflowX: 'auto' }}>
      <table className="portal-table">
        <thead>
          <tr>
            {numbered && <th>#</th>}<th style={{ textAlign: 'left' }}>Manager</th><th>Status</th><th>Returning</th>
            {world === 'top-100' && <th style={NUM}>Regen seasons</th>}<th>Gold</th><th style={NUM}>Game worlds</th>
            <th style={NUM}>Recs</th><th style={NUM}>Concerns</th><th style={NUM}>Score</th><th>Joined</th>
          </tr>
        </thead>
        <tbody>
          {list.map(({ entry, scored }, index) => {
            const h = history[String(entry.id)];
            const concerns = entry.endorsements.filter((item) => item.kind === 'concern').length;
            return [
              <tr key={entry.id} onClick={() => setOpenId(openId === entry.id ? null : entry.id)} style={{ cursor: 'pointer' }}>
                {numbered && <td>{index + 1}</td>}
                <td style={{ textAlign: 'left' }}><strong>{entry.managerName}</strong>{entry.confirmedSeason < data.season && entry.status === 'waiting' ? <span className="muted"> · not confirmed this season</span> : ''}</td>
                <td>{STATUS[entry.status]}{entry.status === 'offered' && entry.offerClub ? `: ${entry.offerClub}${entry.offerDeadline ? ` by ${shortDate(entry.offerDeadline)}` : ''}` : ''}</td>
                <td>{h?.returning ? `Yes · ${h.seasons} season${h.seasons === 1 ? '' : 's'}` : 'No'}</td>
                {world === 'top-100' && <td style={NUM}>{entry.regenSeasons || 0}</td>}
                <td>{yesNo(entry.gold)}{entry.goldFrom === 'admin' ? '*' : ''}</td>
                <td style={NUM}>{entry.gameWorlds ?? '?'}{entry.gameWorldsFrom === 'admin' ? '*' : ''}</td>
                <td style={NUM}>{entry.endorsements.length - concerns}</td>
                <td style={NUM}>{concerns || ''}</td>
                <td style={NUM}><strong>{scored.score}</strong></td>
                <td>{shortDate(entry.joinedAt)}</td>
              </tr>,
              openId === entry.id && (
                <tr key={`${entry.id}-details`}>
                  <td colSpan={numbered ? 11 : 10} style={{ textAlign: 'left' }}>
                    <EntryDetails entry={entry} scored={scored} history={h} onUpdate={update} onEmailOffer={emailOffer} />
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="card">
      <div className="button-row">
        <button type="button" className={world === 'top-100' ? '' : 'secondary'} onClick={() => setWorld('top-100')}>Top 100</button>
        <button type="button" className={world === 'regen' ? '' : 'secondary'} onClick={() => setWorld('regen')}>Top 100 Regen</button>
      </div>
      <h2>Waiting list: {world === 'top-100' ? 'Top 100' : 'Top 100 Regen'}</h2>
      <p className="muted">
        Rule 3.3: returning Top 100 managers first, then the waiting-list score, then the date joined. Click a manager for their records,
        recommendations and concerns (confidential), and to offer a club. * is the admin team's own entry.
        Managers join at <a href="https://manager.smtop100.blog/">manager.smtop100.blog</a>.
      </p>
      {historyError && <p className="status">{historyError}</p>}
      {!data ? <p>Loading…</p> : (
        <>
          {offered.length > 0 && <><h3>Offered</h3>{table(offered, false)}</>}
          <h3>Waiting ({waiting.length})</h3>
          {waiting.length ? table(waiting, true) : <p className="muted">Nobody is waiting.</p>}
          <div className="button-row">
            <button type="button" disabled={!waiting.length || !historyReady} onClick={saveScores}>{!historyReady ? 'Loading Top 100 records…' : unsaved ? 'Save scores and order' : 'Scores saved'}</button>
          </div>
          {closed.length > 0 && (
            <>
              <button type="button" className="link-button" onClick={() => setShowClosed(!showClosed)}>{showClosed ? 'Hide' : 'Show'} appointed, withdrawn and lapsed ({closed.length})</button>
              {showClosed && table(closed, false)}
            </>
          )}
        </>
      )}
    </section>
  );
}
