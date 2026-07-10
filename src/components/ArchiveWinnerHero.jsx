import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export default function ArchiveWinnerHero() {
  const [winner, setWinner] = useState('');
  const [target, setTarget] = useState(null);

  useEffect(() => {
    let cancelled = false;
    let observer;

    function syncFromPage() {
      if (cancelled) return;
      const heroTarget = document.querySelector('.knockout-only-archive-route .hero-countdown');
      if (heroTarget) setTarget(heroTarget);

      const championName = document.querySelector('.knockout-only-archive-route .champion-card strong')?.textContent?.trim();
      if (championName && championName !== 'TBC' && championName !== 'Awaiting winner') {
        setWinner(championName);
      }
    }

    syncFromPage();
    observer = new MutationObserver(syncFromPage);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    const timeout = window.setTimeout(syncFromPage, 500);
    return () => {
      cancelled = true;
      observer?.disconnect();
      window.clearTimeout(timeout);
    };
  }, []);

  if (!target || !winner) return null;

  return createPortal(
    <div className="archive-winner-content">
      <span>Champion</span>
      <strong>🏆 {winner}</strong>
      <small>Tournament winner</small>
    </div>,
    target,
  );
}
