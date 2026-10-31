import { useEffect, useState } from 'react';
import { hasSupabaseConfig, supabase } from '../lib/supabaseClient';
import { formatDrawDate, verifyDraw } from '../lib/prizeDraw.js';

// Public view of the end-of-season prize draw: the published result (with an
// in-browser verification of the seed) and, before then, who is in the pool.
export default function PublicPrizeDraw({ tournamentId, seasonNumber }) {
  const [draws, setDraws] = useState([]);
  const [pool, setPool] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [verification, setVerification] = useState({});
  const [showPool, setShowPool] = useState(false);

  useEffect(() => {
    if (!hasSupabaseConfig || !supabase || !tournamentId) return undefined;
    let active = true;
    Promise.all([
      supabase.from('prize_draws').select('*').eq('tournament_id', tournamentId).eq('published', true).eq('voided', false).order('drawn_at', { ascending: false }),
      supabase.rpc('prize_draw_pool', { p_tournament_id: tournamentId }),
    ]).then(([drawsResult, poolResult]) => {
      if (!active) return;
      setDraws(drawsResult.error ? [] : drawsResult.data || []);
      setPool(poolResult.error ? [] : poolResult.data || []);
      setLoaded(true);
    }).catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [tournamentId]);

  async function verify(draw) {
    setVerification((current) => ({ ...current, [draw.id]: { message: 'Checking…' } }));
    const result = await verifyDraw(draw);
    setVerification((current) => ({ ...current, [draw.id]: result }));
  }

  const eligible = pool.filter((row) => row.eligible);
  const excluded = pool.filter((row) => !row.eligible && row.is_current_manager);
  const nextSeason = Number(seasonNumber) ? `S${Number(seasonNumber) + 1}` : 'next season';

  return <div className="public-prize-draw">
    <div>
      <p className="eyebrow">End-of-season prize draw</p>
      <h2>{draws.length ? 'Prize draw winners' : 'Prize draw'}</h2>
      <p className="muted">Every manager running an entrant who finishes the tournament without a forfeit goes into the draw for a new player pick in {nextSeason}.</p>
    </div>

    {draws.map((draw) => <article key={draw.id} className="public-prize-result">
      <h3>{draw.title}{draw.prize ? ` · ${draw.prize}` : ''}</h3>
      <ol className="public-prize-winners">
        {(draw.winners || []).map((winner, index) => <li key={winner.key}><span>Winner {index + 1}</span><strong>{winner.name}</strong>{winner.club && <small>{winner.club}</small>}</li>)}
      </ol>
      <div className="public-prize-meta">
        <span>Drawn {formatDrawDate(draw.drawn_at)} from {(draw.candidates || []).length} eligible entries.</span>
        <details>
          <summary>How to check this draw</summary>
          <p>The server generated a random seed at the moment of the draw. Each entry's position is the SHA-256 hash of <code>seed:entry-key</code>, lowest first, so nobody could choose the order and anyone can recompute it.</p>
          <p>Seed: <code>{draw.seed}</code></p>
          <p>Entries: {(draw.candidates || []).map((row) => row.name).join(', ')}</p>
        </details>
        <div className="button-row">
          <button type="button" className="secondary compact" onClick={() => verify(draw)}>Verify this draw</button>
        </div>
        {verification[draw.id] && <small className={verification[draw.id].ok ? 'verify-ok' : verification[draw.id].ok === false ? 'verify-fail' : ''}>{verification[draw.id].message}</small>}
      </div>
    </article>)}

    {loaded && !draws.length && <p className="muted">The draw has not been made yet. {eligible.length ? `${eligible.length} managers are currently eligible.` : ''}</p>}

    {pool.length > 0 && <div>
      <button type="button" className="link-button" onClick={() => setShowPool((value) => !value)}>{showPool ? 'Hide' : 'Show'} eligibility list ({eligible.length} eligible{excluded.length ? `, ${excluded.length} excluded` : ''})</button>
      {showPool && <ul className="public-pool-list">
        {eligible.map((row) => <li key={row.manager_id}>{row.manager_name}</li>)}
        {excluded.map((row) => <li key={row.manager_id} className="is-out" title={row.reason || ''}>{row.manager_name} · {row.reason}</li>)}
      </ul>}
    </div>}
  </div>;
}
