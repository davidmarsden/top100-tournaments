const MANAGER_URL = 'https://manager.smtop100.blog/';

const SECTION_ICONS = {
  schedule: '📅', summary: '📋', featured: '⭐', winners: '🏆', groups: '👥',
  knockout: '⚔️', rankings: '📊', 'fair-play': '🤝', seedings: '🎯', brackets: '🌳'
};

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function addSectionIcons(hub) {
  const nav = hub.querySelector('.public-section-nav');
  if (!nav) return;
  nav.querySelectorAll('a[href^="#"]').forEach((link) => {
    const id = link.getAttribute('href').slice(1);
    const icon = SECTION_ICONS[id];
    if (!icon || link.dataset.sectionIcon) return;
    link.dataset.sectionIcon = icon;
    link.dataset.iconLabel = link.textContent.trim();
    link.textContent = `${icon} ${link.textContent.trim()}`;
  });
}

function makeCollapsible(element, label, storageKey, defaultOpen = false) {
  if (!element || element.dataset.collapsibleReady) return;

  const header = element.querySelector(':scope > .public-section-toolbar, :scope > .fixture-section-header, :scope > .fixtures-toolbar, :scope > h2, :scope > h3');
  if (!header) return;
  const bodyNodes = [...element.children].filter((child) => child !== header);
  if (!bodyNodes.length) return;

  element.dataset.collapsibleReady = 'true';
  element.classList.add('collapsible-block');

  const body = document.createElement('div');
  body.className = 'collapsible-body';
  bodyNodes.forEach((node) => body.appendChild(node));
  element.appendChild(body);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'collapse-toggle';
  header.classList.add('collapsible-heading');
  header.appendChild(button);

  let open = defaultOpen;
  try {
    const saved = sessionStorage.getItem(`top100-collapse:${storageKey}`);
    if (saved !== null) open = saved !== 'closed';
  } catch (_) {}

  const render = () => {
    body.hidden = !open;
    element.classList.toggle('is-collapsed', !open);
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? '− Hide' : '+ Show';
    button.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} ${label}`);
  };
  button.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation(); open = !open;
    try { sessionStorage.setItem(`top100-collapse:${storageKey}`, open ? 'open' : 'closed'); } catch (_) {}
    render();
  });
  render();
}

function addCollapsibles(hub) {
  // Dense tournament pages now start compact: users deliberately open what they need.
  const majorIds = ['summary', 'featured', 'winners', 'groups', 'knockout', 'rankings', 'seedings', 'brackets'];
  majorIds.forEach((id) => {
    const section = hub.querySelector(`#${id}`);
    if (section) makeCollapsible(section, id.replace('-', ' '), `section:${id}`, false);
  });

  // Fair Play is mounted into a portal after the public page renders, so target its actual content wrapper.
  const fairPlay = hub.querySelector('#fair-play .manager-forfeit-register');
  if (fairPlay) makeCollapsible(fairPlay, 'Fair Play', 'section:fair-play', false);

  // Fixture/result subsections are already grouped by Group, or by Competition · Round.
  hub.querySelectorAll('.fixture-section').forEach((section, index) => {
    const label = section.querySelector('.fixture-section-header h3')?.textContent?.trim() || `fixtures ${index + 1}`;
    makeCollapsible(section, label, `fixtures:${label}`, false);
  });

  // Group tables/cards: each group can be opened independently.
  hub.querySelectorAll('#groups .group-table-card, #groups .group-card, #groups .standings-card').forEach((section, index) => {
    const label = section.querySelector('h3, h4')?.textContent?.trim() || `group ${index + 1}`;
    makeCollapsible(section, label, `group:${label}`, false);
  });

  // Knockout/bracket competition and round containers start closed too.
  hub.querySelectorAll('#knockout [data-bracket], #knockout [data-round], #brackets [data-bracket], #brackets [data-round], .bracket-round').forEach((section, index) => {
    const label = section.querySelector('h3, h4, h5')?.textContent?.trim() || section.dataset.bracket || section.dataset.round || `bracket ${index + 1}`;
    makeCollapsible(section, label, `bracket:${label}`, false);
  });
}

function ensurePublicFixtureNav() {
  const hub = document.querySelector('.tournament-hub');
  if (!hub) return;
  const nav = hub.querySelector('.public-section-nav');
  const schedule = hub.querySelector('.schedule-summary');
  if (nav && schedule && !nav.querySelector('a[data-fixture-first="schedule"]')) {
    if (!schedule.id) schedule.id = 'schedule';
    const link = document.createElement('a');
    link.href = '#schedule'; link.dataset.fixtureFirst = 'schedule'; link.textContent = 'Schedule';
    nav.insertBefore(link, nav.firstChild);
  }
  addSectionIcons(hub);
  addCollapsibles(hub);

  const existing = hub.querySelector('[data-fixture-first="public-callout"]');
  if (!existing && nav) {
    const callout = document.createElement('section');
    callout.className = 'fixture-first-callout'; callout.dataset.fixtureFirst = 'public-callout';
    callout.innerHTML = `<div><p class="eyebrow">Looking for your match?</p><strong>Find the date first, then the opponent.</strong><span>The tournament schedule is below. Managers with an account can see their own next fixture and what they need to do.</span></div><div class="fixture-first-actions"><a class="button" href="#schedule">View schedule</a><a class="button secondary" href="${MANAGER_URL}">My fixtures</a></div>`;
    nav.parentNode.insertBefore(callout, nav);
  }
}

function ensureManagerNextAction() {
  const shell = document.querySelector('.manager-portal-shell');
  if (!shell) return;
  const firstFixture = shell.querySelector('.portal-panel .portal-fixture');
  const existing = shell.querySelector('[data-fixture-first="manager-next"]');
  if (!firstFixture) { existing?.remove(); return; }
  const primary = firstFixture.querySelector('strong')?.textContent?.trim() || '';
  const date = firstFixture.querySelector('time')?.textContent?.trim() || 'Date TBC';
  const signature = `${primary}|${date}`;
  if (existing?.dataset.fixtureSignature === signature) return;
  existing?.remove();
  const isHome = /^Home\b/i.test(primary);
  const opponent = primary.replace(/^(Home|Away)\s+vs\s+/i, '').trim() || 'opponent';
  const safePrimary = escapeHtml(primary || 'Upcoming fixture'), safeDate = escapeHtml(date), safeOpponent = escapeHtml(opponent);
  const card = document.createElement('section');
  card.className = 'card fixture-first-manager-card'; card.dataset.fixtureFirst = 'manager-next'; card.dataset.fixtureSignature = signature;
  card.innerHTML = `<div><p class="eyebrow">Your next match</p><h2>${safePrimary}</h2><p class="fixture-first-date">${safeDate}</p><p>${isHome ? `You are <strong>HOME</strong> — send the Soccer Manager friendly request to ${safeOpponent} as soon as the fixture appears.` : `You are <strong>AWAY</strong> — check that ${safeOpponent} has sent the friendly request. If not, chase them rather than waiting until the deadline.`}</p></div><div class="fixture-first-actions"><a class="button secondary" href="https://tournaments.smtop100.blog/#schedule">Full schedule</a></div>`;
  const metrics = shell.querySelector('.portal-metrics');
  if (metrics?.parentNode) metrics.parentNode.insertBefore(card, metrics.nextSibling); else shell.prepend(card);
}

function applyFixtureFirstNavigation() { ensurePublicFixtureNav(); ensureManagerNextAction(); }
let queued = false;
function queueApply() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; applyFixtureFirstNavigation(); }); }
queueApply();
const observer = new MutationObserver(queueApply);
observer.observe(document.documentElement, { childList: true, subtree: true });
