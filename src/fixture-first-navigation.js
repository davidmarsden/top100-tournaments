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

function roundCode(label) {
  const text = String(label || '').trim().toLowerCase();
  if (text.includes('64')) return 'R64';
  if (text.includes('32')) return 'R32';
  if (text.includes('16')) return 'R16';
  if (text.includes('quarter')) return 'QF';
  if (text.includes('semi')) return 'SF';
  if (text.includes('final')) return 'Final';
  return String(label || '').trim();
}

function competitionCode(label) {
  const text = String(label || '').trim().toLowerCase();
  if (text.includes('shield')) return 'YS';
  if (text.includes('cup')) return 'YC';
  return String(label || '').trim();
}

function nextRoundSummary(hub) {
  const table = [...hub.querySelectorAll('.schedule-table')].find((candidate) => {
    const heading = candidate.closest('.schedule-summary')?.querySelector('h3')?.textContent || '';
    return /knockout/i.test(heading);
  });
  if (!table) return '';

  const headers = [...table.querySelectorAll('thead th')].map((cell) => cell.textContent.trim());
  if (headers.length < 2) return '';

  const heroDetail = hub.querySelector('.tournament-hero .hero-countdown small')?.textContent?.trim() || '';
  const dateText = heroDetail.split('·')[0]?.trim();
  if (!dateText) return '';
  const heroDate = new Date(dateText);
  if (Number.isNaN(heroDate.getTime())) return '';

  const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const targetDay = heroDate.getDate();
  const targetMonth = monthNames[heroDate.getMonth()];
  const rounds = [];

  table.querySelectorAll('tbody tr').forEach((row) => {
    const cells = [...row.querySelectorAll('td')];
    if (!cells.length) return;
    const round = roundCode(cells[0].textContent);
    cells.slice(1).forEach((cell, index) => {
      const text = cell.textContent.trim().toLowerCase();
      const match = text.match(/(\d{1,2})\s+([a-z]{3})/);
      if (!match) return;
      if (Number(match[1]) === targetDay && match[2] === targetMonth) {
        rounds.push(`${competitionCode(headers[index + 1])} ${round}`);
      }
    });
  });

  return [...new Set(rounds)].join(' / ');
}

function compactTournamentHero(hub) {
  const hero = hub.querySelector('.tournament-hero');
  if (!hero) return;
  hero.classList.add('compact-round-hero');

  const countdown = hero.querySelector('.hero-countdown');
  if (!countdown) return;
  const label = countdown.querySelector('span');
  const detail = countdown.querySelector('small');
  if (label) label.textContent = 'Next round';

  const summary = nextRoundSummary(hub);
  if (summary && detail) {
    const dateText = detail.textContent.split('·')[0]?.trim();
    detail.textContent = `${dateText} · ${summary}`;
  }
}

function makeCollapsible(element, label, storageKey, defaultOpen = false, persist = true) {
  if (!element || element.dataset.collapsibleReady) return;
  const header = element.querySelector(':scope > .public-section-toolbar, :scope > .fixture-section-header, :scope > .fixtures-toolbar, :scope > h2, :scope > h3');
  if (!header) return;
  const bodyNodes = [...element.children].filter((child) => child !== header);
  if (!bodyNodes.length) return;
  element.dataset.collapsibleReady = 'true';
  element.classList.add('collapsible-block');
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'collapse-toggle';
  header.classList.add('collapsible-heading'); header.appendChild(button);
  let open = defaultOpen;
  if (persist) {
    try { const saved = sessionStorage.getItem(`top100-collapse-v2:${storageKey}`); if (saved !== null) open = saved !== 'closed'; } catch (_) {}
  }
  const render = () => {
    bodyNodes.forEach((node) => { node.hidden = !open; });
    element.classList.toggle('is-collapsed', !open);
    button.setAttribute('aria-expanded', String(open));
    button.textContent = open ? '− Hide' : '+ Show';
    button.setAttribute('aria-label', `${open ? 'Hide' : 'Show'} ${label}`);
  };
  button.addEventListener('click', (event) => {
    event.preventDefault(); event.stopPropagation(); open = !open;
    if (persist) { try { sessionStorage.setItem(`top100-collapse-v2:${storageKey}`, open ? 'open' : 'closed'); } catch (_) {} }
    render();
  });
  render();
}

function addCollapsibles(hub) {
  const majorIds = ['summary', 'featured', 'winners', 'groups', 'knockout', 'rankings', 'seedings', 'brackets'];
  majorIds.forEach((id) => { const section = hub.querySelector(`#${id}`); if (section) makeCollapsible(section, id.replace('-', ' '), `section:${id}`, false, true); });
  // Fair Play owns its own React state. Do not mutate or inject controls into it here.
  hub.querySelectorAll('.fixture-section').forEach((section, index) => {
    const label = section.querySelector('.fixture-section-header h3')?.textContent?.trim() || `fixtures ${index + 1}`;
    makeCollapsible(section, label, `fixtures:${label}`, false, true);
  });
  hub.querySelectorAll('#groups .group-table-card, #groups .group-card, #groups .standings-card').forEach((section, index) => {
    const label = section.querySelector('h3, h4')?.textContent?.trim() || `group ${index + 1}`;
    makeCollapsible(section, label, `group:${label}`, false, true);
  });
  hub.querySelectorAll('#knockout [data-bracket], #knockout [data-round], #brackets [data-bracket], #brackets [data-round], .bracket-round').forEach((section, index) => {
    const label = section.querySelector('h3, h4, h5')?.textContent?.trim() || section.dataset.bracket || section.dataset.round || `bracket ${index + 1}`;
    makeCollapsible(section, label, `bracket:${label}`, false, true);
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
  compactTournamentHero(hub);
  addSectionIcons(hub);
  addCollapsibles(hub);

  const existing = hub.querySelector('[data-fixture-first="public-callout"]');
  if (!existing && nav) {
    const callout = document.createElement('section');
    callout.className = 'fixture-first-callout'; callout.dataset.fixtureFirst = 'public-callout';
    callout.innerHTML = `<div><p class="eyebrow">Looking for your match?</p><strong>Find the date first, then the opponent.</strong><span>The tournament schedule is below. For the simple personalised view — who you send a friendly to, and who you are waiting for — use My Matches.</span></div><div class="fixture-first-actions"><a class="button" href="#schedule">📅 View schedule</a><a class="button secondary" href="${MANAGER_URL}">👤 My Matches</a></div>`;
    nav.parentNode.insertBefore(callout, nav);
  }
}

function managerFixtureRows(shell) {
  const panels = [...shell.querySelectorAll('.portal-panel')];
  const fixturePanel = panels.find((panel) => /your fixtures/i.test(panel.querySelector('h2')?.textContent || ''));
  if (!fixturePanel) return [];
  return [...fixturePanel.querySelectorAll('.portal-fixture')].map((fixture) => {
    const primary = fixture.querySelector('strong')?.textContent?.trim() || '';
    const date = fixture.querySelector('time')?.textContent?.trim() || 'Date TBC';
    const detail = fixture.querySelector('span')?.textContent?.trim() || '';
    const isHome = /^Home\b/i.test(primary);
    const opponent = primary.replace(/^(Home|Away)\s+vs\s+/i, '').trim() || 'opponent';
    return { primary, date, detail, isHome, opponent };
  });
}

function ensureManagerNextAction() {
  const shell = document.querySelector('.manager-portal-shell');
  if (!shell) return;
  const rows = managerFixtureRows(shell);
  const existing = shell.querySelector('[data-fixture-first="manager-next"]');
  if (!rows.length) { existing?.remove(); return; }

  const signature = rows.map((row) => `${row.primary}|${row.date}|${row.detail}`).join('||');
  if (existing?.dataset.fixtureSignature === signature) return;
  existing?.remove();

  const cards = rows.map((row, index) => {
    const action = row.isHome ? 'YOU SEND' : 'THEY SEND';
    const icon = row.isHome ? '🏠' : '📨';
    const instruction = row.isHome
      ? `Send the Soccer Manager friendly request to <strong>${escapeHtml(row.opponent)}</strong>.`
      : `Expect a friendly request from <strong>${escapeHtml(row.opponent)}</strong>. If it has not arrived, chase them — do not wait for the deadline.`;
    return `<article class="my-match-action ${row.isHome ? 'you-send' : 'they-send'}${index === 0 ? ' is-next' : ''}">
      <div class="my-match-action__badge">${icon} ${action}</div>
      <div class="my-match-action__main"><strong>${escapeHtml(row.opponent)}</strong><span>${escapeHtml(row.detail)}</span><time>${escapeHtml(row.date)}</time></div>
      <p>${instruction}</p>
    </article>`;
  }).join('');

  const card = document.createElement('section');
  card.className = 'card fixture-first-manager-card my-matches-action-centre';
  card.dataset.fixtureFirst = 'manager-next'; card.dataset.fixtureSignature = signature;
  card.innerHTML = `<div class="my-matches-action-centre__intro"><p class="eyebrow">👤 My Matches</p><h2>What do I need to do?</h2><p>One simple list: <strong>YOU SEND</strong> means you must offer the friendly; <strong>THEY SEND</strong> means you are expecting the request.</p></div><div class="my-match-action-list">${cards}</div><div class="fixture-first-actions"><a class="button secondary" href="https://tournaments.smtop100.blog/#schedule">📅 Full schedule</a></div>`;

  const metrics = shell.querySelector('.portal-metrics');
  if (metrics?.parentNode) metrics.parentNode.insertBefore(card, metrics.nextSibling); else shell.prepend(card);
}

function applyFixtureFirstNavigation() { ensurePublicFixtureNav(); ensureManagerNextAction(); }
let queued = false;
function queueApply() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; applyFixtureFirstNavigation(); }); }
queueApply();
const observer = new MutationObserver(queueApply);
observer.observe(document.documentElement, { childList: true, subtree: true });
