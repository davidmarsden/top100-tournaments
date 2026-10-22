import { useEffect, useState } from 'react';

const DISMISS_KEY = 'top100-install-prompt-dismissed-at';
const DISMISS_DAYS = 30;

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIosSafari() {
  const ua = window.navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
  return ios && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
}

function recentlyDismissed() {
  try {
    const at = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    return at && Date.now() - at < DISMISS_DAYS * 86400000;
  } catch { return false; }
}

// main.jsx stores the beforeinstallprompt event on window before React mounts,
// because Chrome can fire it before this component exists.
export default function Top100InstallPrompt() {
  const [deferred, setDeferred] = useState(() => window.__top100InstallPrompt || null);
  const [hidden, setHidden] = useState(() => isStandalone() || recentlyDismissed());

  useEffect(() => {
    const onPrompt = () => setDeferred(window.__top100InstallPrompt || null);
    const onInstalled = () => setHidden(true);
    window.addEventListener('top100-install-available', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('top100-install-available', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (hidden || (!deferred && !isIosSafari())) return null;

  function dismiss() {
    try { window.localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* storage unavailable */ }
    setHidden(true);
  }

  async function install() {
    deferred.prompt();
    const choice = await deferred.userChoice.catch(() => null);
    window.__top100InstallPrompt = null;
    setDeferred(null);
    if (choice?.outcome === 'accepted') setHidden(true);
  }

  return (
    <aside className="top100-install-prompt" aria-label="Install Top 100">
      <img src="/top100-icon-192.png" alt="" width="48" height="48" />
      <div>
        <strong>Add Top 100 to your home screen</strong>
        {deferred
          ? <span>Open it like an app and get notifications for your fixtures.</span>
          : <span>Tap <b>Share</b> then <b>Add to Home Screen</b>. Notifications on iPhone need this.</span>}
      </div>
      <div className="top100-install-prompt__actions">
        {deferred && <button type="button" onClick={install}>Install</button>}
        <button type="button" className="secondary" onClick={dismiss}>Not now</button>
      </div>
    </aside>
  );
}
