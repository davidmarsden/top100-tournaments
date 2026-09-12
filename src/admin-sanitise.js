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

function applyAdminSanitise() {
  const main = [...document.querySelectorAll('main.app-shell')].find((node) => node.querySelector('.dashboard-layout'));
  if (!main) return;
  main.classList.add('admin-sanitised');
  const module = activeModule(main);
  [...main.classList].filter((name) => name.startsWith('admin-module-')).forEach((name) => main.classList.remove(name));
  main.classList.add(`admin-module-${slug(module)}`);
  prepareSidebar(main);
  prepareProgress(main);
  prepareHero(main);
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
