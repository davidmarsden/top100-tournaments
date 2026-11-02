import { useEffect, useState } from 'react';
import { playerName } from '../lib/playerName';
import { supabase } from '../lib/supabaseClient';
import { POSITION_GROUPS, money, parseMoney } from './MarketRatesCard';

const CHAT_URL = 'https://manager.smtop100.blog/chat';
const GROUP_LABEL = Object.fromEntries(POSITION_GROUPS);
const DEAL_TYPES = [['transfer', 'Transfer'], ['loan', 'Loan'], ['swap', 'Swap']];
const LIST_LABEL = { transfer: 'Transfer listed', loan: 'Loan listed', concerns: 'Unhappy' };
const shortDate = (value) => (value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '');
const range = (low, high, unit = '') => {
  if (low && high) return low === high ? `${low}${unit}` : `${low}–${high}${unit}`;
  if (low) return `${low}+${unit}`;
  if (high) return `up to ${high}${unit}`;
  return '';
};
const dealText = (types) => (types || []).map((type) => type[0].toUpperCase() + type.slice(1)).join(' / ');

function PostSummary({ post }) {
  if (post.kind === 'offered') {
    const p = post.player || {};
    return (
      <>
        <strong>{playerName(p.name)}</strong> <span className="muted">{p.position} · {p.age} · {p.rating} · value {money(p.value)}</span>
        <div className="muted">{dealText(post.dealTypes)}{post.askingPrice ? ` · asking ${money(post.askingPrice)}` : ''}</div>
      </>
    );
  }
  const parts = [range(post.minAge, post.maxAge, ' yrs'), range(post.minRating, post.maxRating, ' rated')].filter(Boolean);
  return (
    <>
      <strong>{post.group ? GROUP_LABEL[post.group] : 'Any position'}</strong>{parts.length ? <span className="muted"> · {parts.join(' · ')}</span> : null}
      <div className="muted">{dealText(post.dealTypes)}{post.maxFee ? ` · up to ${money(post.maxFee)}` : ''}</div>
    </>
  );
}

function BoardPost({ post, onClose }) {
  return (
    <li className="top100-board__post">
      <span className={`top100-board__kind ${post.kind}`}>{post.kind === 'wanted' ? 'Wanted' : 'Offering'}</span>
      <PostSummary post={post} />
      {post.note && <div className="top100-board__note">“{post.note}”</div>}
      <div className="muted top100-board__by">
        {post.isMine ? `Yours · until ${shortDate(post.expiresAt)}` : `${post.manager}${post.club ? `, ${post.club}` : ''} · ${shortDate(post.createdAt)}`}
        {onClose && <button type="button" className="link-button" onClick={() => onClose(post.id)}>Close</button>}
      </div>
    </li>
  );
}

function ListedRow({ row }) {
  return (
    <li className="top100-board__post">
      <span className={`top100-board__kind ${row.list}`}>{LIST_LABEL[row.list]}</span>
      <strong>{playerName(row.player)}</strong> <span className="muted">{row.club} · {row.position} · {row.age} · {row.rating}</span>
      <div className="muted">
        Value {money(row.value)}
        {row.list === 'transfer' ? ` · ${row.askingPrice ? `asking ${money(row.askingPrice)}` : (row.askingLabel || 'no asking price')}` : ''}
        {row.concern ? ` · ${row.concern}` : ''}
      </div>
    </li>
  );
}

function Matches({ post, matches }) {
  if (!matches) return null;
  if (post.kind === 'offered') {
    return matches.wanted?.length
      ? <div className="top100-board__matches"><p className="eyebrow">Managers looking for this</p><ul>{matches.wanted.map((row) => <BoardPost key={row.id} post={row} />)}</ul></div>
      : <p className="muted top100-board__matches">No one is looking for this yet.</p>;
  }
  const offers = matches.offers || [], listed = matches.listed || [];
  if (!offers.length && !listed.length) return <p className="muted top100-board__matches">No matches yet. Matches update with every sync.</p>;
  return (
    <div className="top100-board__matches">
      {offers.length > 0 && <><p className="eyebrow">Offered by managers</p><ul>{offers.map((row) => <BoardPost key={row.id} post={row} />)}</ul></>}
      {listed.length > 0 && <><p className="eyebrow">On the transfer, loan and concerns lists</p><ul>{listed.map((row, index) => <ListedRow key={index} row={row} />)}</ul></>}
    </div>
  );
}

const EMPTY = { kind: 'wanted', group: '', minAge: '', maxAge: '', minRating: '', maxRating: '', maxFee: '', playerId: '', askingPrice: '', dealTypes: ['transfer'], note: '' };

function PostForm({ board, onSaved, onCancel }) {
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const toggle = (type) => setForm((current) => ({
    ...current, dealTypes: current.dealTypes.includes(type) ? current.dealTypes.filter((t) => t !== type) : [...current.dealTypes, type],
  }));
  const squad = board.squad || [];

  async function save(event) {
    event.preventDefault();
    const fee = parseMoney(form.kind === 'wanted' ? form.maxFee : form.askingPrice);
    if ((form.kind === 'wanted' ? form.maxFee : form.askingPrice).trim() && fee === null) { setError('Enter amounts like 2.5m or 750k.'); return; }
    if (!form.dealTypes.length) { setError('Choose at least one deal type.'); return; }
    setBusy(true);
    setError('');
    const post = form.kind === 'wanted'
      ? { kind: 'wanted', group: form.group, minAge: form.minAge, maxAge: form.maxAge, minRating: form.minRating, maxRating: form.maxRating, maxFee: fee ? String(fee) : '', dealTypes: form.dealTypes, note: form.note }
      : { kind: 'offered', playerId: form.playerId, askingPrice: fee ? String(fee) : '', dealTypes: form.dealTypes, note: form.note };
    const { error: rpcError } = await supabase.rpc('save_market_board_post', { p_game_world_id: board.worldId, p_post: post });
    setBusy(false);
    if (rpcError) { setError(rpcError.message || 'Could not save the post.'); return; }
    setForm(EMPTY);
    onSaved();
  }

  return (
    <form className="top100-board__form" onSubmit={save}>
      <div className="top100-board__switch" role="radiogroup" aria-label="Post type">
        {[['wanted', 'I want a player'], ['offered', "I'm offering a player"]].map(([kind, label]) => (
          <button key={kind} type="button" role="radio" aria-checked={form.kind === kind} className={form.kind === kind ? 'is-active' : ''}
            onClick={() => setForm((current) => ({ ...current, kind }))}>{label}</button>
        ))}
      </div>
      {form.kind === 'wanted' ? (
        <div className="top100-board__fields">
          <label>Position<select value={form.group} onChange={set('group')}><option value="">Any</option>{POSITION_GROUPS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label>Age from<input type="number" min="14" max="45" value={form.minAge} onChange={set('minAge')} /></label>
          <label>to<input type="number" min="14" max="45" value={form.maxAge} onChange={set('maxAge')} /></label>
          <label>Rating from<input type="number" min="40" max="99" value={form.minRating} onChange={set('minRating')} /></label>
          <label>to<input type="number" min="40" max="99" value={form.maxRating} onChange={set('maxRating')} /></label>
          <label>Budget (optional)<input type="text" placeholder="e.g. 3m" value={form.maxFee} onChange={set('maxFee')} /></label>
        </div>
      ) : (
        <div className="top100-board__fields">
          <label className="top100-board__wide">Player
            <select value={form.playerId} onChange={set('playerId')} required>
              <option value="">Choose from your squad…</option>
              {squad.map((p) => <option key={p.id} value={p.id}>{playerName(p.name)} · {p.position} · {p.age} · {p.rating} · {money(p.value)}{p.youth ? ' · youth' : ''}</option>)}
            </select>
          </label>
          <label>Asking price (optional)<input type="text" placeholder="e.g. 2.5m" value={form.askingPrice} onChange={set('askingPrice')} /></label>
        </div>
      )}
      <fieldset className="top100-board__types">
        <legend>Deal types</legend>
        {DEAL_TYPES.map(([type, label]) => (
          <label key={type}><input type="checkbox" checked={form.dealTypes.includes(type)} onChange={() => toggle(type)} /> {label}</label>
        ))}
      </fieldset>
      <label className="top100-board__wide">Note (optional)<input type="text" maxLength={280} value={form.note} onChange={set('note')} placeholder="e.g. Need a starter for the run-in" /></label>
      {error && <p className="status" role="status">{error}</p>}
      <div className="top100-board__actions">
        <button type="submit" disabled={busy}>{busy ? 'Posting…' : 'Post'}</button>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// The transfer board: managers' wanted and offered posts in this game world, matched with each
// other and with the transfer, loan and concerns lists, plus managers' newsfeed posts about deals.
export default function MarketBoardCard({ session, worldId }) {
  const [board, setBoard] = useState(null);
  const [tab, setTab] = useState('mine');
  const [posting, setPosting] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!session?.user?.id || !supabase || !worldId) return undefined;
    let active = true;
    supabase.rpc('get_market_board', { p_game_world_id: worldId }).then(({ data, error }) => {
      if (active) setBoard(error ? null : data);
    });
    return () => { active = false; };
  }, [session?.user?.id, worldId, reload]);
  if (!board) return null;

  const mine = board.posts.filter((post) => post.isMine);
  const others = board.posts.filter((post) => !post.isMine);
  const canPost = Boolean(board.me?.club);
  async function close(id) {
    await supabase.rpc('close_market_board_post', { p_post_id: id });
    setReload((n) => n + 1);
  }
  const tabs = [['mine', `Your posts (${mine.length})`], ['board', `Board (${others.length})`], ['newsfeed', `From the newsfeed (${board.newsfeed.length})`]];

  return (
    <section className="top100-board" aria-labelledby="top100-board-heading">
      <div className="top100-board__head">
        <h3 id="top100-board-heading">Transfer board</h3>
        {canPost && !posting && <button type="button" onClick={() => setPosting(true)}>+ New post</button>}
      </div>
      <p className="muted">
        Post the player you're after or one you'd let go. Wanted posts are matched with other managers' offers and with the transfer,
        loan and concerns lists in {board.world}. <a href={CHAT_URL} target="_blank" rel="noopener noreferrer">Talk deals over in Top 100 Chat</a>.
      </p>
      {posting && <PostForm board={board} onSaved={() => { setPosting(false); setTab('mine'); setReload((n) => n + 1); }} onCancel={() => setPosting(false)} />}
      <div className="top100-board__tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {tab === 'mine' && (mine.length ? (
        <ul>{mine.map((post) => (
          <li key={post.id} className="top100-board__mine">
            <ul><BoardPost post={post} onClose={close} /></ul>
            <Matches post={post} matches={board.matches?.[post.id]} />
          </li>
        ))}</ul>
      ) : <p className="muted">{canPost ? 'No posts yet. Post what you need and matches will show here.' : `You don't run a club in ${board.world}.`}</p>)}
      {tab === 'board' && (others.length ? <ul>{others.map((post) => <BoardPost key={post.id} post={post} />)}</ul> : <p className="muted">No posts from other managers yet.</p>)}
      {tab === 'newsfeed' && (board.newsfeed.length ? (
        <ul>{board.newsfeed.map((row, index) => (
          <li key={index} className="top100-board__post">
            <strong>{row.manager}</strong> <span className="muted">{row.club} · {shortDate(row.postedAt)}{row.comments ? ` · ${row.comments} comment${row.comments === 1 ? '' : 's'}` : ''}</span>
            <div>{row.message}</div>
          </li>
        ))}</ul>
      ) : <p className="muted">No manager posts about deals in the last two weeks.</p>)}
      <p className="muted top100-app-card__meta">Posts last 14 days. Lists and newsfeed as of the last sync.</p>
    </section>
  );
}
