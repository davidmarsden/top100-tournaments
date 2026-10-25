import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { smClubUrl, smMyClubUrl, smWorldUrl } from '../lib/soccerManagerLinks';

const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' };

function ordinal(value) {
  if (!value) return '—';
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  return `${value}${{ 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] || 'th'}`;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return '—';
  if (number >= 1e9) return `£${(number / 1e9).toFixed(2)}bn`;
  if (number >= 1e6) return `£${(number / 1e6).toFixed(1)}m`;
  return `£${Math.round(number / 1e3)}k`;
}

function shortDate(value) {
  if (!value) return 'Date TBC';
  const [year, month, day] = String(value).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

function observedLabel(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// SM standings report form as points per match: 3 win, 1 draw, 0 loss.
const FORM_RESULTS = { 3: 'W', 1: 'D', 0: 'L' };

function formList(form) {
  return Array.isArray(form) ? form.map((points) => FORM_RESULTS[Number(points)]).filter(Boolean) : [];
}

// gameWorldId follows the world the Manager Portal is showing: undefined while it is still loading,
// null for the account's home world.
export default function Top100AppHome({ session, gameWorldId, onSelectWorld = null }) {
  const [home, setHome] = useState(null);
  const [state, setState] = useState('loading');
  // Kept across loads so the switcher stays in place while another world loads.
  const [worlds, setWorlds] = useState([]);

  useEffect(() => {
    if (!session?.user?.id || !supabase || gameWorldId === undefined) return undefined;
    let active = true;
    setState('loading');
    const request = gameWorldId
      ? supabase.rpc('get_my_top100_app_home_for_world', { target_game_world_id: gameWorldId })
      : supabase.rpc('get_my_top100_app_home');
    request.then(({ data, error }) => {
      if (!active) return;
      if (error) { setState('unavailable'); return; }
      setHome(data);
      if (Array.isArray(data?.worlds)) setWorlds(data.worlds);
      // A remembered world where this manager no longer has a club falls back to the home world.
      if (gameWorldId && onSelectWorld && Array.isArray(data?.worlds) && data.worlds.length
        && !data.worlds.some((world) => Number(world.id) === Number(gameWorldId))) onSelectWorld(null);
      setState('ready');
    });
    return () => { active = false; };
  }, [session?.user?.id, gameWorldId]);

  const shownWorldId = Number(gameWorldId || home?.world?.id) || null;
  const switcher = onSelectWorld && worlds.length > 1 ? (
    <div className="top100-world-switcher" role="tablist" aria-label="Game world">
      {worlds.map((world) => (
        <button key={world.id} type="button" role="tab" aria-selected={Number(world.id) === shownWorldId}
          className={Number(world.id) === shownWorldId ? 'is-active' : ''}
          onClick={() => { if (Number(world.id) !== shownWorldId) onSelectWorld(Number(world.id)); }}>
          <strong>{world.name}</strong><span>{world.club}</span>
        </button>
      ))}
    </div>
  ) : null;

  if (state === 'unavailable') return null;
  if (state === 'loading') return <section className="top100-app-home" aria-busy="true">{switcher}<p className="muted">Loading your club…</p></section>;

  const setupId = home?.world?.setupId;
  const club = home?.club;
  const next = home?.nextFixture;
  const squad = home?.squad;
  const table = Array.isArray(home?.divisionTable) ? home.divisionTable : [];
  const worldLink = smWorldUrl(setupId);
  const myClubLink = smMyClubUrl(setupId, club?.sourceClubId);
  const opponentLink = smClubUrl(next?.opponentClubDataId);
  const observed = observedLabel(club?.observedAt);

  return (
    <section className="top100-app-home" aria-labelledby="top100-app-home-heading">
      {switcher}
      <div className="top100-sm-shortcuts">
        <div>
          <p className="eyebrow">Soccer Manager</p>
          <h2 id="top100-app-home-heading">{club?.name || home?.world?.name || 'Top 100'}</h2>
        </div>
        <div className="top100-sm-shortcuts__buttons">
          {worldLink && <a className="button" href={worldLink} {...EXTERNAL}>Open {home?.world?.name || 'game world'} in SM ↗</a>}
          {myClubLink && <a className="button secondary" href={myClubLink} {...EXTERNAL}>My club in SM ↗</a>}
          {opponentLink && <a className="button secondary" href={opponentLink} {...EXTERNAL}>Next opponent in SM ↗</a>}
        </div>
        <p className="top100-sm-shortcuts__note">Links open soccermanager.com in your browser. Club pages show the game world you last used in SM, so if one looks wrong, open {home?.world?.name || 'the game world'} first.</p>
      </div>

      <div className="top100-app-home__grid">
        {club?.position ? (
          <article className="top100-app-card">
            <p className="eyebrow">League · Division {club.division}</p>
            <div className="top100-app-card__headline"><strong>{ordinal(club.position)}</strong><span>{club.points} pts</span></div>
            {formList(club.form).length > 0 && <div className="top100-form" aria-label="Recent form">{formList(club.form).map((result, index) => <span key={index} className={`portal-outcome ${result}`}>{result}</span>)}</div>}
            {observed && <p className="muted top100-app-card__meta">{club.fresh ? 'Synced' : 'Last synced'} {observed}</p>}
          </article>
        ) : null}

        {next ? (
          <article className="top100-app-card">
            <p className="eyebrow">Next fixture · {next.tournament}</p>
            <div className="top100-app-card__headline"><strong>{next.home ? 'v' : '@'} {next.opponent || 'TBC'}</strong></div>
            <p className="muted top100-app-card__meta">{next.round ? `${next.round} · ` : ''}{shortDate(next.fixtureDate)}</p>
          </article>
        ) : null}

        {squad?.players ? (
          <article className="top100-app-card">
            <p className="eyebrow">Squad</p>
            <div className="top100-app-card__headline"><strong>{squad.seniorPlayers}</strong><span>senior · {squad.youthPlayers} youth</span></div>
            <p className="muted top100-app-card__meta">Avg rating {squad.averageRating ?? '—'} · Value {money(squad.totalValue)} · <a href={home?.world?.id ? `/squad?world=${home.world.id}` : '/squad'}>Squad &amp; transfers</a></p>
          </article>
        ) : null}
      </div>

      {table.length > 0 && (
        <details className="top100-division-table">
          <summary>Division {club?.division} table</summary>
          <div className="table-wrap">
            <table className="portal-table">
              <thead><tr><th>#</th><th>Club</th><th>P</th><th>GD</th><th>Pts</th></tr></thead>
              <tbody>
                {table.map((row) => {
                  const link = smClubUrl(row.clubDataId);
                  return (
                    <tr key={row.sourceClubId || row.clubName} className={row.isMine ? 'my-team' : undefined}>
                      <td>{row.position}</td>
                      <td>{link ? <a href={link} {...EXTERNAL}>{row.clubName}</a> : row.clubName}</td>
                      <td>{row.played}</td>
                      <td>{row.goalDifference}</td>
                      <td><strong>{row.points}</strong></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
