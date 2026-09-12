const COMPETITIONS = [
  { key: 'cup', label: 'Youth Cup', icon: '🏆' },
  { key: 'shield', label: 'Youth Shield', icon: '🛡️' }
];

const BRACKET_ROUNDS = ['R64', 'R32', 'R16', 'QF', 'SF', 'Final'];
const BRACKET_LABELS = {
  R64: 'Round of 64',
  R32: 'Round of 32',
  R16: 'Round of 16',
  QF: 'Quarter Finals',
  SF: 'Semi Finals',
  Final: 'Final'
};

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

function polishFixtureCallout(hub) {
  const callout = hub.querySelector('[data-fixture-first="public-callout"]');
  const copy = callout?.querySelector(':scope > div:first-child');
  if (!copy || callout.dataset.copyHierarchy === 'v2') return;
  const existingSpans = [...copy.querySelectorAll('span')];
  const detail = existingSpans.at(-1)?.textContent?.trim()
    || 'The tournament schedule is below. For the simple personalised view — who you send a friendly to, and who you are waiting for — use My Matches.';
  copy.innerHTML = `<strong>Looking for your match?</strong><span class="fixture-first-subhead">Find the date first, then the opponent.</span><span>${detail}</span>`;
  callout.dataset.copyHierarchy = 'v2';
}

function roundCodeFromTitle(text) {
  const value = normalise(text);
  if (value.includes('64')) return 'R64';
  if (value.includes('32')) return 'R32';
  if (value.includes('16')) return 'R16';
  if (value.includes('quarter')) return 'QF';
  if (value.includes('semi')) return 'SF';
  if (value.includes('final')) return 'Final';
  return null;
}

function placeholderTie() {
  const tie = document.createElement('article');
  tie.className = 'bracket-tie bracket-placeholder';
  tie.dataset.projectedTie = 'true';
  tie.innerHTML = '<div class="bracket-team"><strong class="bracket-team-name">TBC</strong><span></span></div><div class="bracket-team"><strong class="bracket-team-name">TBC</strong><span></span></div><small>Awaiting previous round</small>';
  return tie;
}

function projectedRound(round, tieCount) {
  const column = document.createElement('div');
  column.className = 'bracket-round-column bracket-round-projected';
  column.dataset.projectedRound = round;
  const title = document.createElement('div');
  title.className = 'bracket-round-title';
  title.textContent = BRACKET_LABELS[round] || round;
  const stack = document.createElement('div');
  stack.className = 'bracket-tie-stack';
  for (let index = 0; index < tieCount; index += 1) stack.appendChild(placeholderTie());
  column.append(title, stack);
  return column;
}

function projectedChampion() {
  const column = document.createElement('div');
  column.className = 'bracket-champion-column bracket-round-projected';
  column.dataset.projectedChampion = 'true';
  column.innerHTML = '<div class="bracket-round-title">Champion</div><div class="champion-card"><div class="champion-trophy">🏆</div><span>Awaiting winner</span><strong>TBC</strong></div>';
  return column;
}

function completeShieldBracket(hub) {
  const bracketCards = [...hub.querySelectorAll('#brackets .visual-bracket-card, .public-bracket-stack .visual-bracket-card')];
  const shieldCard = bracketCards.find((card) => /shield/i.test(card.querySelector('.visual-bracket-header h3')?.textContent || ''));
  if (!shieldCard) return;
  const grid = shieldCard.querySelector('.visual-bracket');
  if (!grid) return;

  const realColumns = [...grid.querySelectorAll(':scope > .bracket-round-column:not(.bracket-round-projected)')];
  if (!realColumns.length) return;
  const realRoundCodes = realColumns.map((column) => roundCodeFromTitle(column.querySelector('.bracket-round-title')?.textContent)).filter(Boolean);
  if (!realRoundCodes.length || realRoundCodes.includes('Final')) return;

  const lastRound = realRoundCodes[realRoundCodes.length - 1];
  const roundIndex = BRACKET_ROUNDS.indexOf(lastRound);
  if (roundIndex < 0) return;
  const previousCount = realColumns.at(-1)?.querySelectorAll('.bracket-tie').length || 1;
  const signature = `${lastRound}:${previousCount}:${realColumns.length}`;
  if (shieldCard.dataset.bracketProjectionSignature === signature && grid.querySelector('[data-projected-round]')) return;

  grid.querySelectorAll('[data-projected-round], [data-projected-champion]').forEach((node) => node.remove());

  let tieCount = previousCount;
  for (let index = roundIndex + 1; index < BRACKET_ROUNDS.length; index += 1) {
    tieCount = Math.max(1, Math.ceil(tieCount / 2));
    grid.appendChild(projectedRound(BRACKET_ROUNDS[index], tieCount));
  }
  grid.appendChild(projectedChampion());

  const columns = grid.querySelectorAll(':scope > .bracket-round-column, :scope > .bracket-champion-column').length;
  grid.style.gridTemplateColumns = `repeat(${columns}, minmax(210px, 1fr))`;
  shieldCard.dataset.bracketProjectionSignature = signature;
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

  polishFixtureCallout(hub);
  completeShieldBracket(hub);
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
