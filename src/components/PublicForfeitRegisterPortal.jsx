import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ManagerForfeitRegister from './ManagerForfeitRegister.jsx';

export default function PublicForfeitRegisterPortal({ tournamentId }) {
  const [host, setHost] = useState(null);

  useEffect(() => {
    let portalHost = null;
    let navLink = null;
    let observer = null;

    const mount = () => {
      const page = document.querySelector('main.public-archive.tournament-hub');
      if (!page || portalHost) return false;
      portalHost = document.createElement('section');
      portalHost.id = 'manager-forfeits';
      portalHost.className = 'card public-manager-forfeit-register';
      const fairPlay = document.getElementById('fair-play');
      if (fairPlay?.nextSibling) page.insertBefore(portalHost, fairPlay.nextSibling);
      else page.appendChild(portalHost);

      const nav = page.querySelector('.public-section-nav');
      if (nav) {
        navLink = document.createElement('a');
        navLink.href = '#manager-forfeits';
        navLink.textContent = 'Manager forfeits';
        nav.appendChild(navLink);
      }

      setHost(portalHost);
      return true;
    };

    if (!mount()) {
      observer = new MutationObserver(() => {
        if (mount()) observer?.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      observer?.disconnect();
      navLink?.remove();
      portalHost?.remove();
      setHost(null);
    };
  }, [tournamentId]);

  if (!host) return null;
  return createPortal(<ManagerForfeitRegister tournamentId={tournamentId} />, host);
}
