import { useEffect } from 'react';

const PUBLIC_STATUS_LABELS = {
  groups_approved: 'Group stage underway',
};

const MAIN_SITE_URL = 'https://smtop100.blog/';
const REGEN_URL = 'https://smtop100.blog/regen/';

const GLOBAL_LINKS = [
  { key: 'top100', label: 'Top 100', href: MAIN_SITE_URL },
  { key: 'regen', label: 'Top 100 Regen', href: REGEN_URL },
  { key: 'about', label: 'About', href: `${MAIN_SITE_URL}about/` },
  { key: 'explore', label: 'Explore', href: `${MAIN_SITE_URL}explore/` },
];

const TOURNAMENT_LINKS = [
  { key: 'youth-cup', label: 'Youth Cup', href: 'https://tournaments.smtop100.blog/top-100/youth-cup' },
  { key: 'world-club-cup', label: 'World Club Cup', href: 'https://tournaments.smtop100.blog/top-100/world-club-cup' },
  { key: 'tournament-centre', label: 'Tournament centre', href: 'https://tournaments.smtop100.blog/' },
];

const POLL_LINKS = [
  { key: 'voting-results', label: 'Results', href: 'https://vote.smtop100.blog/' },
  { key: 'vote', label: 'Vote', href: 'https://vote.smtop100.blog/vote' },
];

function tournamentCurrentFromPath(pathname) {
  if (/^\/top-100\/youth-cup(?:\/|$)/.test(pathname)) return 'youth-cup';
  if (/^\/top-100\/world-club-cup(?:\/|$)/.test(pathname)) return 'world-club-cup';
  return 'tournament-centre';
}

function replaceInternalStatusLabels(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);
  textNodes.forEach((node) => {
    let nextValue = node.nodeValue;
    Object.entries(PUBLIC_STATUS_LABELS).forEach(([internalStatus, publicLabel]) => {
      nextValue = nextValue.replaceAll(internalStatus, publicLabel);
    });
    if (nextValue !== node.nodeValue) node.nodeValue = nextValue;
  });
}

function normalizeCommunityPollUi(root) {
  root.querySelectorAll('.manager-portal-hero h1').forEach((heading) => {
    if (heading.textContent.trim() === 'Manager Voting') heading.textContent = 'Community Polls';
  });
  root.querySelectorAll('.status').forEach((status) => {
    if (status.textContent.trim() === 'Voting account verified.') status.textContent = 'Community Polls account verified.';
  });
}

function normalizeManagerUi(root) {
  root.querySelectorAll('.manager-portal-hero h1').forEach((heading) => {
    if (heading.textContent.trim() === 'Manager Portal') heading.textContent = 'My Matches';
  });
  root.querySelectorAll('.manager-portal-hero .eyebrow').forEach((eyebrow) => {
    if (eyebrow.textContent.trim() === 'Manager Portal') eyebrow.textContent = 'My Matches';
  });
  root.querySelectorAll('.status').forEach((status) => {
    status.textContent = status.textContent.replaceAll('Manager Portal', 'My Matches');
  });
}

export default function Top100BrandShell({ children, product = 'Tournaments', current = 'tournaments' }) {
  const resolvedCurrent = current === 'tournaments' ? tournamentCurrentFromPath(window.location.pathname) : current;
  const isVoting = resolvedCurrent === 'vote' || resolvedCurrent === 'voting-results';
  const isManager = resolvedCurrent === 'manager';
  const isTournament = current === 'tournaments';
  const localLinks = isVoting ? POLL_LINKS : isManager ? [] : TOURNAMENT_LINKS;
  const tournamentPrimary = TOURNAMENT_LINKS.find((link) => link.key === 'tournament-centre');
  const tournamentCompetitions = TOURNAMENT_LINKS.filter((link) => link.key !== 'tournament-centre');

  useEffect(() => {
    const shell = document.querySelector('.top100-site-shell');
    if (!shell) return undefined;
    const normalize = () => {
      replaceInternalStatusLabels(shell);
      if (isVoting) normalizeCommunityPollUi(shell);
      if (isManager) normalizeManagerUi(shell);
    };
    normalize();
    const observer = new MutationObserver(normalize);
    observer.observe(shell, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [isVoting, isManager]);

  return (
    <div className="top100-site-shell">
      <header className={`top100-brand-header${isTournament ? ' top100-brand-header--tournaments' : ''}`}>
        <div className="top100-brand-header__inner">
          <a className="top100-brand-header__identity" href={MAIN_SITE_URL} aria-label="Visit the Top 100 main site">
            <div className="top100-brand-header__wordmark" aria-hidden="true"><span>Top</span><strong>100</strong></div>
            <div className="top100-brand-header__pitch-line" aria-hidden="true"><span /><i /><span /></div>
            <div className="top100-brand-header__tagline">Managers. Stories. A bigger game.</div>
          </a>

          <nav className="top100-brand-header__nav" aria-label="Top 100 public navigation">
            {GLOBAL_LINKS.map((link) => <a key={link.key} href={link.href}>{link.label}</a>)}
          </nav>

          {isTournament ? (
            <div className="top100-brand-header__tournament-stack">
              <div className="top100-brand-header__product"><span>Top 100</span><strong>{product}</strong></div>
              <nav className="top100-brand-header__tournament-primary" aria-label="Tournament shortcuts">
                <a className={resolvedCurrent === tournamentPrimary.key ? 'is-current' : undefined} href={tournamentPrimary.href}>{tournamentPrimary.label}</a>
                <a className="top100-brand-header__manager-link" href="https://manager.smtop100.blog/">👤 My Matches</a>
              </nav>
              <nav className="top100-brand-header__local top100-brand-header__local--competitions" aria-label="Tournament competitions">
                {tournamentCompetitions.map((link) => <a key={link.key} className={resolvedCurrent === link.key ? 'is-current' : undefined} href={link.href}>{link.label}</a>)}
              </nav>
            </div>
          ) : (
            <>
              <div className="top100-brand-header__product"><span>Top 100</span><strong>{product}</strong></div>
              {!isManager && <nav className="top100-brand-header__utility" aria-label="Manager account"><a className="top100-brand-header__manager-link" href="https://manager.smtop100.blog/">👤 My Matches</a></nav>}
              {localLinks.length > 0 && <nav className="top100-brand-header__local" aria-label={`${product} navigation`}>{localLinks.map((link) => <a key={link.key} className={resolvedCurrent === link.key ? 'is-current' : undefined} href={link.href}>{link.label}</a>)}</nav>}
            </>
          )}
        </div>
      </header>
      {children}
      <footer className="top100-footer">
        <div className="top100-footer__inner">
          <div className="top100-footer__brand"><a href={MAIN_SITE_URL} className="top100-footer__wordmark" aria-label="Top 100 main site"><span>Top</span><strong>100</strong></a><span>{product}</span></div>
          <nav aria-label="Top 100 footer links">
            <a href={MAIN_SITE_URL}>Top 100</a><a href={REGEN_URL}>Top 100 Regen</a><a href={`${MAIN_SITE_URL}about/`}>About</a><a href={`${MAIN_SITE_URL}explore/`}>Explore</a><a href={`${MAIN_SITE_URL}support/`}>Support</a><a href={`${MAIN_SITE_URL}subscribe/`}>Subscribe</a><a href="https://manager.smtop100.blog/">My Matches</a>
          </nav>
        </div>
        <div className="top100-footer__note">{isManager ? 'Your fixtures, actions and tournament progress in one place, with the wider Top 100 resources always available publicly.' : isVoting ? 'Community Polls help managers shape how the Top 100 game world is run.' : 'Youth Cup, World Club Cup and other Top 100 competitions.'}</div>
      </footer>
    </div>
  );
}
