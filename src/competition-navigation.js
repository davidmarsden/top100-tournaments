const COMPETITIONS = [
  { key: 'cup', label: 'Youth Cup', icon: '🏆' },
  { key: 'shield', label: 'Youth Shield', icon: '🛡️' }
];

function normalise(value) {
  return String(value || '').trim().toLowerCase();
}

function optionKind(option) {
  const text = normalise(option?.textContent);
  if (text.includes('shield')) return 'shield';
  if (text.includes('cup')) return 'cup';
  if (/^all\b/.test(text)) return 'all';
  return null;
}

function findCompetitionSelect(container) {
  return [...container.querySelectorAll('select')].find((select) => {
    const kinds = new Set([...select.options].map(optionKind).filter(Boolean));
    return kinds.has('cup') && kinds.has('shield');
  }) || null;
}

function selectCompetition(select, kind) {
  const option = [...select.options].find((candidate) => optionKind(candidate) === kind);
  if (!option) return false;
  select.value = option.value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function currentCompetition(select) {
  return optionKind(select.options[select.selectedIndex]);
}

function renderTabs(container, select, contextLabel) {
  if (!select || container.querySelector('[data-competition-tabs]')) return;

  const available = new Set([...select.options].map(optionKind).filter(Boolean));
  const nav = document.createElement('div');
  nav.className = 'competition-tabs';
  nav.dataset.competitionTabs = contextLabel;
  nav.setAttribute('role', 'group');
  nav.setAttribute('aria-label', `${contextLabel} competition`);

  if (available.has('all')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.competition = 'all';
    button.textContent = 'All';
    nav.appendChild(button);
  }

  COMPETITIONS.forEach((competition) => {
    if (!available.has(competition.key)) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.competition = competition.key;
    button.textContent = `${competition.icon} ${competition.label}`;
    nav.appendChild(button);
  });

  const sync = () => {
    const current = currentCompetition(select);
    nav.querySelectorAll('button').forEach((button) => {
      const active = button.dataset.competition === current;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };

  nav.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-competition]');
    if (!button) return;
    selectCompetition(select, button.dataset.competition);
    sync();
  });
  select.addEventListener('change', sync);

  const toolbar = select.closest('.fixtures-toolbar, .public-section-toolbar, .filter-row, .filters, .toolbar');
  if (toolbar) toolbar.insertAdjacentElement('afterend', nav);
  else select.parentElement?.insertAdjacentElement('afterend', nav);

  select.classList.add('competition-filter-fallback');
  sync();
}

function addCompetitionTabs() {
  const hub = document.querySelector('.tournament-hub');
  if (!hub) return;

  const schedule = hub.querySelector('#schedule, .schedule-summary');
  if (schedule) {
    const select = findCompetitionSelect(schedule);
    if (select) renderTabs(schedule, select, 'Schedule');
  }

  const knockout = hub.querySelector('#knockout');
  if (knockout) {
    const select = findCompetitionSelect(knockout);
    if (select) renderTabs(knockout, select, 'Knockout');
  }

  const brackets = hub.querySelector('#brackets');
  if (brackets) {
    const select = findCompetitionSelect(brackets);
    if (select) renderTabs(brackets, select, 'Bracket');
  }
}

let queued = false;
function queueCompetitionTabs() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    addCompetitionTabs();
  });
}

queueCompetitionTabs();
new MutationObserver(queueCompetitionTabs).observe(document.documentElement, { childList: true, subtree: true });
