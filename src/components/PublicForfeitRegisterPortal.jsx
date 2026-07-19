import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import ManagerForfeitRegister from './ManagerForfeitRegister.jsx';

export default function PublicForfeitRegisterPortal({ tournamentId }) {
  const [host, setHost] = useState(null);

  useEffect(() => {
    let portalHost = null;
    let legacyFairPlay = null;
    let observer = null;

    const mount = () => {
      const page = document.querySelector('main.public-archive.tournament-hub');
      legacyFairPlay = document.getElementById('fair-play');
      if (!page || !legacyFairPlay || portalHost) return false;

      // Replace the older team-based Fair Play summary with the manager register.
      // The existing navigation link continues to target #fair-play.
      legacyFairPlay.id = 'legacy-fair-play-summary';
      legacyFairPlay.hidden = true;

      portalHost = document.createElement('section');
      portalHost.id = 'fair-play';
      portalHost.className = 'card public-manager-forfeit-register';
      page.insertBefore(portalHost, legacyFairPlay);

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
      portalHost?.remove();
      if (legacyFairPlay) {
        legacyFairPlay.id = 'fair-play';
        legacyFairPlay.hidden = false;
      }
      setHost(null);
    };
  }, [tournamentId]);

  if (!host) return null;
  return createPortal(<ManagerForfeitRegister tournamentId={tournamentId} />, host);
}
