const LOGO_URL = 'https://anotherurl.wordpress.com/wp-content/uploads/2026/07/edited-photo.png';

export default function Top100BrandShell({ children }) {
  return (
    <div className="top100-site-shell">
      <header className="top100-brand-header">
        <div className="top100-brand-header__inner">
          <a className="top100-brand-header__logo-link" href="https://smtop100.blog/" aria-label="Visit the Top 100 main site">
            <span className="top100-brand-header__logo-plaque">
              <img className="top100-brand-header__logo" src={LOGO_URL} alt="Top 100 — Probably the best GW in SM" />
            </span>
          </a>

          <div className="top100-brand-header__copy">
            <span>Top 100</span>
            <strong>Tournament Hub</strong>
          </div>

          <nav className="top100-brand-header__nav" aria-label="Top 100 websites">
            <a href="https://smtop100.blog/">Main site</a>
            <a href="https://archive.smtop100.blog/">Archive</a>
            <a className="is-current" href="https://youth-cup.smtop100.blog/">Tournaments</a>
            <a className="top100-brand-header__manager-link" href="https://youth-cup.smtop100.blog/manager">Manager portal</a>
          </nav>
        </div>
      </header>

      {children}

      <footer className="top100-footer">
        <div className="top100-footer__inner">
          <div>
            <strong>Top 100 Soccer Manager Worlds</strong>
            <p>Probably the best GW in SM.</p>
          </div>
          <nav aria-label="Top 100 footer links">
            <a href="https://smtop100.blog/">Main site</a>
            <a href="https://archive.smtop100.blog/">Archive</a>
            <a href="https://youth-cup.smtop100.blog/">Tournament hub</a>
            <a href="https://youth-cup.smtop100.blog/manager">Manager portal</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
