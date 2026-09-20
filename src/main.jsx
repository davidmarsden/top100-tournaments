import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './workflow-overrides.css';
import './bracket.css';
import './schedule.css';
import './tournament-hub.css';
import './tournament-builder.css';
import './manager-portal.css';
import './brand-system.css';
import './public-page-overrides.css';
import './fixture-polish.css';
import './public-forfeit-badges.css';
import './reports-exports.css';
import './fixture-first-navigation.css';
import './competition-navigation.css';
import './admin-sanitise.css';
import './public-matchday-boundaries.js';
import './public-double-forfeit-badges.js';
import './fixture-first-navigation.js';
import './competition-navigation.js';
import './admin-sanitise.js';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-shell">
          <section className="warning-card">
            <strong>The app crashed while loading.</strong>
            <span>{this.state.error.message}</span>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

const rootElement = document.getElementById('root');

async function renderApplication() {
  if (window.__TOP100_CHAT_EARLY_CLAIM__) return;

  if (!rootElement) {
    document.body.innerHTML = '<p>Top 100 Tournaments could not find the root element.</p>';
    return;
  }

  const path = window.location.pathname;
  const isManagerHost = window.location.hostname === 'manager.smtop100.blog';
  const isIsolatedChatPath =
    /^\/chat\/?$/.test(path) ||
    (isManagerHost && /^\/manager\/chat\/?$/.test(path));

  let content;
  if (isIsolatedChatPath) {
    // Deliberately avoid importing App.jsx or any Supabase-dependent enhancer
    // here. The persistent Supabase client must not exist before the chat
    // handoff reads a magic-link fragment.
    const [{ default: Top100ChatAccess }, { default: Top100BrandShell }] = await Promise.all([
      import('./components/Top100ChatAccess.jsx'),
      import('./components/Top100BrandShell.jsx'),
    ]);
    content = <Top100BrandShell product="My Matches" current="manager"><Top100ChatAccess /></Top100BrandShell>;
  } else {
    await import('./public-forfeit-badges.js');
    const { default: App } = await import('./App.jsx');
    content = <App />;
  }

  createRoot(rootElement).render(
    <ErrorBoundary>
      {content}
    </ErrorBoundary>
  );
}

renderApplication().catch((error) => {
  if (rootElement) {
    createRoot(rootElement).render(
      <ErrorBoundary>
        <main className="app-shell">
          <section className="warning-card">
            <strong>The app crashed while loading.</strong>
            <span>{error.message}</span>
          </section>
        </main>
      </ErrorBoundary>
    );
  }
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/pwa-sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined);
  });
}
