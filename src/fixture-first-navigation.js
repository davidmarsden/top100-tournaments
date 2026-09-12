const MANAGER_URL = 'https://manager.smtop100.blog/';

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function ensurePublicFixtureNav() {
  const hub = document.querySelector('.tournament-hub');
  if (!hub) return;

  const nav = hub.querySelector('.public-section-nav');
  const schedule = hub.querySelector('.schedule-summary');

  if (nav && schedule && !nav.querySelector('a[data-fixture-first="schedule"]')) {
    if (!schedule.id) schedule.id = 'schedule';
    const link = document.createElement('a');
    link.href = '#schedule';
    link.dataset.fixtureFirst = 'schedule';
    link.textContent = 'Schedule';
    nav.insertBefore(link, nav.firstChild);
  }

  const existing = hub.querySelector('[data-fixture-first="public-callout"]');
  if (!existing && nav) {
    const callout = document.createElement('section');
    callout.className = 'fixture-first-callout';
    callout.dataset.fixtureFirst = 'public-callout';
    callout.innerHTML = `
      <div>
        <p class="eyebrow">Looking for your match?</p>
        <strong>Find the date first, then the opponent.</strong>
        <span>The tournament schedule is below. Managers with an account can see their own next fixture and what they need to do.</span>
      </div>
      <div class="fixture-first-actions">
        <a class="button" href="#schedule">View schedule</a>
        <a class="button secondary" href="${MANAGER_URL}">My fixtures</a>
      </div>`;
    nav.parentNode.insertBefore(callout, nav);
  }
}

function ensureManagerNextAction() {
  const shell = document.querySelector('.manager-portal-shell');
  if (!shell) return;

  const firstFixture = shell.querySelector('.portal-panel .portal-fixture');
  const existing = shell.querySelector('[data-fixture-first="manager-next"]');
  if (!firstFixture) {
    existing?.remove();
    return;
  }

  const primary = firstFixture.querySelector('strong')?.textContent?.trim() || '';
  const date = firstFixture.querySelector('time')?.textContent?.trim() || 'Date TBC';
  const signature = `${primary}|${date}`;
  if (existing?.dataset.fixtureSignature === signature) return;
  existing?.remove();

  const isHome = /^Home\b/i.test(primary);
  const opponent = primary.replace(/^(Home|Away)\s+vs\s+/i, '').trim() || 'opponent';
  const safePrimary = escapeHtml(primary || 'Upcoming fixture');
  const safeDate = escapeHtml(date);
  const safeOpponent = escapeHtml(opponent);

  const card = document.createElement('section');
  card.className = 'card fixture-first-manager-card';
  card.dataset.fixtureFirst = 'manager-next';
  card.dataset.fixtureSignature = signature;
  card.innerHTML = `
    <div>
      <p class="eyebrow">Your next match</p>
      <h2>${safePrimary}</h2>
      <p class="fixture-first-date">${safeDate}</p>
      <p>${isHome
        ? `You are <strong>HOME</strong> — send the Soccer Manager friendly request to ${safeOpponent} as soon as the fixture appears.`
        : `You are <strong>AWAY</strong> — check that ${safeOpponent} has sent the friendly request. If not, chase them rather than waiting until the deadline.`}</p>
    </div>
    <div class="fixture-first-actions">
      <a class="button secondary" href="https://tournaments.smtop100.blog/#schedule">Full schedule</a>
    </div>`;

  const metrics = shell.querySelector('.portal-metrics');
  if (metrics?.parentNode) metrics.parentNode.insertBefore(card, metrics.nextSibling);
  else shell.prepend(card);
}

function applyFixtureFirstNavigation() {
  ensurePublicFixtureNav();
  ensureManagerNextAction();
}

let queued = false;
function queueApply() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    applyFixtureFirstNavigation();
  });
}

queueApply();
const observer = new MutationObserver(queueApply);
observer.observe(document.documentElement, { childList: true, subtree: true });
