const GROUPS = {
  Overview: 'Overview',
  Organisers: 'Setup', Registration: 'Setup', Format: 'Setup', Entrants: 'Setup', Groups: 'Setup',
  Fixtures: 'Matchday', 'Result Approvals': 'Matchday', Results: 'Matchday', Tables: 'Matchday', Forfeits: 'Matchday', Knockout: 'Matchday',
  'Reports & Exports': 'Publish', 'Public Page': 'Publish',
  Challonge: 'Platform',
};

const GROUP_LABELS = {
  Overview: 'Tournament',
  Setup: 'Setup',
  Matchday: 'Matchday',
  Publish: 'Publishing',
  Platform: 'Platform',
};

function slug(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function prepareSidebar(main) {
  const sidebar = main.querySelector('.sidebar');
  if (!sidebar) return;
  const buttons = [...sidebar.querySelectorAll('.nav-pill')];
  let previousGroup = null;
  buttons.forEach((button) => {
    const label = button.textContent.trim();
    const group = GROUPS[label] || 'Platform';
    button.dataset.adminGroup = group;
    button.dataset.adminModule = slug(label);
    button.classList.toggle('admin-group-start', group !== previousGroup);
    if (group !== previousGroup) button.dataset.adminGroupLabel = GROUP_LABELS[group] || group;
    else delete button.dataset.adminGroupLabel;
    previousGroup = group;
  });
}

function activeModule(main) {
  const active = main.querySelector('.sidebar .nav-pill.active');
  return active?.textContent?.trim() || 'Overview';
}

function prepareProgress(main) {
  const card = main.querySelector('.progress-card');
  if (!card || card.dataset.adminCompactReady) return;
  card.dataset.adminCompactReady = 'true';
  const header = card.querySelector('.progress-header');
  if (!header) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary admin-progress-toggle';
  let open = false;
  const render = () => {
    card.classList.toggle('admin-progress-open', open);
    button.textContent = open ? 'Hide workflow' : 'Show workflow';
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => { open = !open; render(); });
  header.appendChild(button);
  render();
}

function prepareHero(main) {
  const hero = main.querySelector(':scope > .hero');
  if (!hero) return;
  hero.classList.add('admin-hero-compact');
  const title = hero.querySelector('h1');
  const tournamentCard = main.querySelector('.workspace .card .card-header h2');
  if (title && /Tournament control centre/i.test(title.textContent) && tournamentCard?.textContent?.trim()) {
    hero.dataset.currentTournament = tournamentCard.textContent.trim();
  }
}

function prepareOverviewCards(main) {
  if (!main.classList.contains('admin-module-overview')) return;
  const cards = [...main.querySelectorAll('.workspace > .grid.two-columns.compact > .card')];
  cards.forEach((card) => {
    if (card.dataset.adminOverviewDisclosure) return;
    const header = card.querySelector(':scope > .card-header');
    if (!header) return;
    card.dataset.adminOverviewDisclosure = 'true';
    card.classList.add('admin-overview-secondary', 'admin-overview-collapsed');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary admin-card-toggle';
    const render = () => {
      const open = !card.classList.contains('admin-overview-collapsed');
      button.textContent = open ? 'Hide' : 'Show';
      button.setAttribute('aria-expanded', String(open));
    };
    button.addEventListener('click', () => { card.classList.toggle('admin-overview-collapsed'); render(); });
    header.appendChild(button);
    render();
  });
}

function prepareFixtureSections(main, module) {
  const sections = [...main.querySelectorAll('.module-card .fixture-section')];
  sections.forEach((section) => {
    if (section.dataset.adminFixtureDisclosure) return;
    const header = section.querySelector(':scope > .fixture-section-header');
    const body = section.querySelector(':scope > .fixture-card-list');
    if (!header || !body) return;
    section.dataset.adminFixtureDisclosure = 'true';
    section.classList.add('admin-fixture-disclosure');
    const inCompletedDesk = Boolean(section.closest('.results-card'));
    const defaultCollapsed = module === 'Results' || inCompletedDesk;
    if (defaultCollapsed) section.classList.add('admin-fixture-collapsed');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary admin-fixture-toggle';
    const render = () => {
      const open = !section.classList.contains('admin-fixture-collapsed');
      button.textContent = open ? '− Hide' : '+ Show';
      button.setAttribute('aria-expanded', String(open));
    };
    button.addEventListener('click', () => { section.classList.toggle('admin-fixture-collapsed'); render(); });
    header.appendChild(button);
    render();
  });
}

function prepareTestTools(main) {
  const buttons = [...main.querySelectorAll('.module-card button')].filter((button) => /auto-fill.*test/i.test(button.textContent));
  if (!buttons.length) return;
  const moduleCard = main.querySelector('.module-card');
  if (!moduleCard) return;
  buttons.forEach((button) => button.classList.add('admin-test-tool'));
  if (moduleCard.dataset.adminTestDisclosure) return;
  moduleCard.dataset.adminTestDisclosure = 'true';
  const header = moduleCard.querySelector(':scope > .card-header');
  if (!header) return;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'secondary admin-test-toggle';
  toggle.textContent = 'Advanced / test tools';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => {
    const open = moduleCard.classList.toggle('admin-test-tools-open');
    toggle.textContent = open ? 'Hide test tools' : 'Advanced / test tools';
    toggle.setAttribute('aria-expanded', String(open));
  });
  header.appendChild(toggle);
}

function makeKnockoutDisclosure(panel, label) {
  if (!panel || panel.dataset.adminKnockoutDisclosure) return;
  const heading = panel.querySelector(':scope > h3');
  if (!heading) return;
  panel.dataset.adminKnockoutDisclosure = 'true';
  panel.classList.add('admin-knockout-disclosure', 'admin-knockout-collapsed');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary admin-knockout-toggle';
  button.setAttribute('aria-label', `Show or hide ${label}`);
  const render = () => {
    const open = !panel.classList.contains('admin-knockout-collapsed');
    button.textContent = open ? '− Hide' : '+ Show';
    button.setAttribute('aria-expanded', String(open));
  };
  button.addEventListener('click', () => { panel.classList.toggle('admin-knockout-collapsed'); render(); });
  heading.appendChild(button);
  render();
}

function prepareKnockout(main, module) {
  if (module !== 'Knockout') return;
  const manager = main.querySelector('.module-card .knockout-manager');
  if (!manager) return;
  manager.classList.add('admin-knockout-live');
  const setupBlocks = [manager.querySelector(':scope > .ready-banner'), manager.querySelector(':scope > .knockout-exclusions')].filter(Boolean);
  setupBlocks.forEach((block) => block.classList.add('admin-knockout-context'));

  makeKnockoutDisclosure(manager.querySelector(':scope > .schedule-presets'), 'knockout schedule');
  [...manager.querySelectorAll(':scope > .knockout-bracket-grid > .bracket-section')].forEach((panel) => {
    const label = panel.querySelector(':scope > h3')?.textContent?.trim() || 'saved knockout results';
    makeKnockoutDisclosure(panel, label);
  });
}

function applyAdminSanitise() {
  const main = [...document.querySelectorAll('main.app-shell')].find((node) => node.querySelector('.dashboard-layout'));
  if (!main) return;
  main.classList.add('admin-sanitised');
  const module = activeModule(main);
  const moduleClass = `admin-module-${slug(module)}`;
  const currentModuleClass = [...main.classList].find((name) => name.startsWith('admin-module-'));
  if (currentModuleClass !== moduleClass) {
    if (currentModuleClass) main.classList.remove(currentModuleClass);
    main.classList.add(moduleClass);
  }
  prepareSidebar(main);
  prepareProgress(main);
  prepareHero(main);
  prepareOverviewCards(main);
  prepareFixtureSections(main, module);
  prepareTestTools(main);
  prepareKnockout(main, module);
}

let queued = false;
function queueApply() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; applyAdminSanitise(); });
}

if (typeof document !== 'undefined') {
  queueApply();
  const observer = new MutationObserver(queueApply);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}
