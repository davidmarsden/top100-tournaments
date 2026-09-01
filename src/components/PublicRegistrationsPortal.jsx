import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

function registrationPath(tournament) {
  const world = tournament?.game_worlds?.slug;
  const competition = tournament?.competition_types?.slug;
  const season = tournament?.public_slug;
  return world && competition && season ? `/${world}/${competition}/${season}/register` : '#';
}

function label(row) {
  if (row.promoted_entry_id) return 'Confirmed entrant';
  if (row.status === 'approved') return 'Confirmed';
  return 'Registered';
}

export default function PublicRegistrationsPortal({ tournamentId }) {
  const [host, setHost] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    let portalHost = null;
    let observer = null;
    const mount = () => {
      const page = document.querySelector('main.public-archive.tournament-hub');
      const summary = document.getElementById('summary');
      if (!page || !summary || portalHost) return false;
      portalHost = document.createElement('section');
      portalHost.id = 'registrations';
      portalHost.className = 'card public-registration-list';
      summary.insertAdjacentElement('afterend', portalHost);
      setHost(portalHost);
      return true;
    };
    if (!mount()) {
      observer = new MutationObserver(() => { if (mount()) observer?.disconnect(); });
      observer.observe(document.body, { childList: true, subtree: true });
    }
    return () => { observer?.disconnect(); portalHost?.remove(); setHost(null); };
  }, [tournamentId]);

  useEffect(() => {
    if (!tournamentId) return;
    let active = true;
    fetch(`/.netlify/functions/registration?tournamentId=${encodeURIComponent(tournamentId)}`)
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Could not load registrations.');
        setData(payload);
      })
      .catch(() => { if (active) setData(null); });
    return () => { active = false; };
  }, [tournamentId]);

  if (!host || !data || (!data.window?.open && !data.registrations?.length)) return null;

  return createPortal(<>
    <div className="public-section-toolbar">
      <div><p className="eyebrow">Registration</p><h2>{data.registrationsReceived || 0} teams registered</h2></div>
      {data.window?.open && <a className="public-link-button" href={registrationPath(data.tournament)}>Register your team</a>}
    </div>
    {!data.registrations?.length ? <p className="muted">Registration is open. Be the first team on the list.</p> : <div className="entrant-list">{data.registrations.map((row) => <article className="entrant-row registration-row" key={row.id}><div className="registration-details"><strong>{row.club_name}</strong><span>{row.manager_name} · rating {row.rating}</span></div><span className="status-pill">{label(row)}</span></article>)}</div>}
    {data.window?.open && <p className="muted">No account or email address is needed to register. A Manager Portal account is optional and can be created afterwards.</p>}
  </>, host);
}
