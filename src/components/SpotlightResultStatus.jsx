import { useEffect } from 'react';

const RESULT_CLASSES = [
  'spotlight-result',
  'spotlight-statement',
  'spotlight-leader',
  'spotlight-forfeit',
  'spotlight-knockout-result',
];

function isResultCard(card) {
  return RESULT_CLASSES.some((className) => card.classList.contains(className));
}

function updateResultStatuses() {
  document.querySelectorAll('.featured-match-card').forEach((card) => {
    if (!isResultCard(card)) return;
    const meta = card.querySelector('small');
    if (!meta || meta.dataset.resultStatusApplied === 'true') return;
    const date = String(meta.textContent || '').split(' · ')[0].trim();
    const status = card.classList.contains('spotlight-forfeit') ? 'Forfeit ruling' : 'Final result';
    meta.textContent = date ? `${date} · ${status}` : status;
    meta.dataset.resultStatusApplied = 'true';
  });
}

export default function SpotlightResultStatus() {
  useEffect(() => {
    updateResultStatuses();
    const observer = new MutationObserver(updateResultStatuses);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
