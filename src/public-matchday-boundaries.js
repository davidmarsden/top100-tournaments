const MATCHDAY_CLASSES = ['matchday-start', 'matchday-complete', 'matchday-upcoming-alt'];

function cardMatchdayKey(card) {
  const roundText = card.querySelector('.fixture-actions > span')?.textContent?.trim() || '';
  const dateText = card.querySelector('.public-fixture-date')?.textContent?.trim() || '';
  return `${roundText}|${dateText}`;
}

function decorateGroupMatchdays() {
  document.querySelectorAll('#groups .fixture-card-list').forEach((list) => {
    const cards = [...list.querySelectorAll(':scope > .fixture-card')];
    const matchdays = [];

    cards.forEach((card) => {
      MATCHDAY_CLASSES.forEach((className) => card.classList.remove(className));
      const key = cardMatchdayKey(card);
      const previous = matchdays[matchdays.length - 1];

      if (!previous || previous.key !== key) {
        matchdays.push({ key, cards: [card] });
      } else {
        previous.cards.push(card);
      }
    });

    matchdays.forEach((matchday, index) => {
      const complete = matchday.cards.every((card) => card.classList.contains('played'));
      if (index > 0) matchday.cards[0].classList.add('matchday-start');
      if (complete) {
        matchday.cards.forEach((card) => card.classList.add('matchday-complete'));
      } else if (index % 2 === 1) {
        matchday.cards.forEach((card) => card.classList.add('matchday-upcoming-alt'));
      }
    });
  });
}

let scheduled = false;
function scheduleDecoration() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    decorateGroupMatchdays();
  });
}

if (typeof document !== 'undefined') {
  scheduleDecoration();
  const observer = new MutationObserver(scheduleDecoration);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
