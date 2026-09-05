function addTeamForfeitPill(teamNode) {
  if (!teamNode || teamNode.querySelector('.forfeit-team-pill')) return;
  const teamName = teamNode.childNodes[0]?.textContent?.trim() || teamNode.textContent.trim();
  const pill = document.createElement('span');
  pill.className = 'forfeit-result-pill forfeit-team-pill';
  pill.textContent = 'F';
  pill.title = `Forfeit by ${teamName}`;
  pill.setAttribute('aria-label', `Forfeit by ${teamName}`);
  teamNode.appendChild(pill);
}

function applyDoubleForfeitPresentation() {
  document.querySelectorAll('.tournament-hub .fixture-card').forEach((card) => {
    const note = [...card.querySelectorAll('p.muted')]
      .find((node) => node.textContent.trim().toLowerCase().startsWith('double forfeit'));
    if (!note) return;

    note.textContent = 'Double forfeit - both teams disqualified';
    const teams = card.querySelectorAll('.fixture-teams > strong');
    if (teams.length !== 2) return;
    addTeamForfeitPill(teams[0]);
    addTeamForfeitPill(teams[1]);
  });
}

let observer = null;
let applying = false;

function scheduleApply() {
  if (applying) return;
  applying = true;
  window.requestAnimationFrame(() => {
    applyDoubleForfeitPresentation();
    applying = false;
  });
}

if (typeof window !== 'undefined') {
  window.addEventListener('DOMContentLoaded', scheduleApply, { once: true });
  observer = new MutationObserver(scheduleApply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
}
