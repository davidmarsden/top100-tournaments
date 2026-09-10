import { useEffect } from 'react';

const PUBLIC_STATUS_LABELS = {
  groups_approved: 'Group stage underway',
};

const FAMILY_LINKS = [
  { key: 'top100', label: 'Top 100', href: 'https://smtop100.blog/' },
  { key: 'history', label: 'Stats & History', href: 'https://archive.smtop100.blog/' },
  { key: 'tournaments', label: 'Tournaments', href: 'https://tournaments.smtop100.blog/' },
  { key: 'voting', label: 'Voting', href: 'https://vote.smtop100.blog/' },
  { key: 'awards', label: 'Awards', href: 'https://awards.smtop100.blog/' },
  { key: 'regen', label: 'Regen', href: 'https://top100regen.website/' },
];

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

export default function Top100BrandShell({ children, product = 'Tournaments', current = 'tournaments' }) {
  const isVoting = current === 'voting';

  useEffect(() => {
    const shell = document.querySelector('.top100-site-shell');
    if (!shell) return undefined;

    replaceInternalStatusLabels(shell);

    const observer = new MutationObserver(() => replaceInternalStatusLabels(shell));
    observer.observe(shell, { childList: true, subtree: true, characterData: true });

    return () => observer.disconnect();
  }, []);

  return (
    <div className="top100-site-shell">
      <header className="top100-brand-header">
        <div className="top100-brand-header__inner">
          <a className="top100-brand-header__identity" href="https://smtop100.blog/" aria-label="Visit the Top 100 main site">
            <div className="top100-brand-header__wordmark" aria-hidden="true">
              <span>Top</span><strong>100</strong>
            </div>
            <div className="top100-brand-header__pitch-line" aria-hidden="true">
              <span /><i /><span />
            </div>
            <div className="top100-brand-header__tagline">Managers. Stories. A bigger game.</div>
          </a>

          <div className="top100-brand-header__product">
            <span>Top 100</span>
            <strong>{product}</strong>
          </div>

          <nav className="top100-brand-header__nav" aria-label="Top 100 websites">
            {FAMILY_LINKS.map((link) => (
              <a key={link.key} className={current === link.key ? 'is-current' : undefined} href={link.href}>{link.label}</a>
            ))}
          </nav>

          <nav className="top100-brand-header__utility" aria-label={isVoting ? 'Manager tools' : 'Tournament tools'}>
            <a className="top100-brand-header__manager-link" href="https://tournaments.smtop100.blog/manager">Manager portal</a>
            {isVoting && <a className="top100-brand-header__manager-link" href="https://vote.smtop100.blog/vote">Manager voting</a>}
          </nav>
        </div>
      </header>

      {children}

      <footer className="top100-footer">
        <div className="top100-footer__inner">
          <div className="top100-footer__brand">
            <a href="https://smtop100.blog/" className="top100-footer__wordmark" aria-label="Top 100 main site"><span>Top</span><strong>100</strong></a>
            <span>{product}</span>
          </div>
          <nav aria-label="Top 100 footer links">
            <a href="https://smtop100.blog/">Top 100</a>
            <a href="https://archive.smtop100.blog/">Stats &amp; History</a>
            <a href="https://vote.smtop100.blog/">Voting Results</a>
            <a href="https://vote.smtop100.blog/vote">Manager voting</a>
            <a href="https://smtop100.blog/rules/">Rules</a>
            <a href="https://smtop100.blog/support/">Support</a>
            <a href="https://awards.smtop100.blog/">Awards</a>
            <a href="https://tournaments.smtop100.blog/manager">Manager portal</a>
          </nav>
        </div>
        <div className="top100-footer__note">
          {isVoting
            ? 'Published poll and Awards results, with authenticated manager voting available on this Voting site.'
            : 'Tournament fixtures, results and competition history from the Top 100 Soccer Manager community.'}
        </div>
      </footer>
    </div>
  );
}
