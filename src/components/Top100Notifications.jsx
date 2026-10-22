import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Tolerate a key pasted into Netlify with its label, quotes or whitespace.
const VAPID_PUBLIC_KEY = String(import.meta.env.VITE_VAPID_PUBLIC_KEY || '').trim()
  .replace(/^VITE_VAPID_PUBLIC_KEY\s*=\s*/, '').replace(/^["']|["']$/g, '').trim();

const CATEGORIES = [
  { key: 'fixtures', label: 'Fixtures', description: 'New fixtures, plus day-before and fixture-day reminders.' },
  { key: 'results', label: 'Results', description: 'When a result on one of your fixtures is confirmed.' },
  { key: 'opponent_actions', label: 'Opponent actions', description: 'Your opponent sends, receives or chases the SM match request, or reports a problem.' },
  { key: 'match_comments', label: 'Match comments', description: 'New comments on your fixtures.' },
  { key: 'chat_replies', label: 'Top 100 Chat', description: 'Replies to your posts in Top 100 Chat.' },
  { key: 'broadcasts', label: 'Announcements', description: 'Messages from the Top 100 organisers.' },
];
const DEFAULT_PREFS = Object.fromEntries(CATEGORIES.map((category) => [category.key, true]));

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(padded);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent) || (window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1);
}

function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

async function workerRegistration() {
  const existing = await navigator.serviceWorker.getRegistration('/');
  return existing || navigator.serviceWorker.register('/pwa-sw.js', { scope: '/', updateViaCache: 'none' });
}

function sameKey(buffer, key) {
  if (!buffer) return false;
  const a = new Uint8Array(buffer);
  return a.length === key.length && a.every((byte, index) => byte === key[index]);
}

// The device's subscription for the current VAPID key. A subscription made with
// an older key (after a key rotation) can no longer receive pushes, so it is
// dropped and, when the manager already allowed notifications, replaced.
async function currentSubscription(registration, { create = false } = {}) {
  const key = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options?.applicationServerKey, key)) {
    await supabase.rpc('delete_my_push_subscription', { p_endpoint: subscription.endpoint });
    await subscription.unsubscribe();
    subscription = null;
    create = true;
  }
  if (!subscription && create && Notification.permission === 'granted') {
    subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  return subscription;
}

async function saveSubscription(subscription) {
  const json = subscription.toJSON();
  const { error } = await supabase.rpc('save_my_push_subscription', {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh || '',
    p_auth: json.keys?.auth || '',
    p_user_agent: window.navigator.userAgent.slice(0, 300),
  });
  if (error) throw error;
}

function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function Top100Notifications({ session }) {
  const [device, setDevice] = useState({ state: 'checking', message: '' });
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [inbox, setInbox] = useState([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const loadInbox = useCallback(async () => {
    const { data, error } = await supabase
      .from('manager_notifications')
      .select('id, category, title, body, url, created_at, read_at')
      .order('created_at', { ascending: false })
      .limit(30);
    if (!error) setInbox(data || []);
  }, []);

  useEffect(() => {
    if (!session?.user?.id || !supabase) return undefined;
    let active = true;
    (async () => {
      const [{ data: prefRow }] = await Promise.all([
        supabase.from('manager_notification_preferences').select('*').maybeSingle(),
        loadInbox(),
      ]);
      if (active && prefRow) setPrefs({ ...DEFAULT_PREFS, ...Object.fromEntries(CATEGORIES.map(({ key }) => [key, prefRow[key]])) });

      if (!pushSupported()) {
        if (active) setDevice({ state: isIos() && !isStandalone() ? 'install-first' : 'unsupported', message: '' });
        return;
      }
      if (!VAPID_PUBLIC_KEY) { if (active) setDevice({ state: 'unconfigured', message: '' }); return; }
      if (Notification.permission === 'denied') { if (active) setDevice({ state: 'blocked', message: '' }); return; }
      try {
        const registration = await workerRegistration();
        const subscription = await currentSubscription(registration);
        // Re-save on every visit so the device stays linked to the signed-in account.
        if (subscription && Notification.permission === 'granted') await saveSubscription(subscription);
        if (active) setDevice({ state: subscription ? 'on' : 'off', message: '' });
      } catch (error) {
        if (active) setDevice({ state: 'off', message: error?.message || '' });
      }
    })();
    return () => { active = false; };
  }, [session?.user?.id, loadInbox]);

  useEffect(() => {
    if (window.location.hash === '#notifications') document.getElementById('notifications')?.scrollIntoView();
  }, []);

  const unread = inbox.filter((item) => !item.read_at).length;
  useEffect(() => {
    if (!('setAppBadge' in navigator)) return;
    (unread ? navigator.setAppBadge(unread) : navigator.clearAppBadge()).catch(() => undefined);
  }, [unread]);

  async function enable() {
    setBusy(true); setMessage('');
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') { setDevice({ state: permission === 'denied' ? 'blocked' : 'off', message: '' }); return; }
      const registration = await workerRegistration();
      await navigator.serviceWorker.ready;
      const subscription = await currentSubscription(registration, { create: true });
      await saveSubscription(subscription);
      setDevice({ state: 'on', message: '' });
      setMessage('Notifications are on for this device.');
    } catch (error) {
      setMessage(error?.message || 'Could not turn on notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true); setMessage('');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await supabase.rpc('delete_my_push_subscription', { p_endpoint: subscription.endpoint });
        await subscription.unsubscribe();
      }
      setDevice({ state: 'off', message: '' });
      setMessage('Notifications are off for this device.');
    } catch (error) {
      setMessage(error?.message || 'Could not turn off notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function togglePref(key) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    const { error } = await supabase.rpc('set_my_notification_preferences', { p_preferences: { [key]: next[key] } });
    if (error) { setPrefs(prefs); setMessage(error.message); }
  }

  async function markRead(ids = null) {
    const { error } = await supabase.rpc('mark_my_notifications_read', { p_ids: ids });
    if (!error) setInbox((items) => items.map((item) => (!ids || ids.includes(item.id) ? { ...item, read_at: item.read_at || new Date().toISOString() } : item)));
  }

  return (
    <section id="notifications" className="card top100-notifications" aria-labelledby="top100-notifications-heading">
      <div className="card-header">
        <p className="eyebrow">Notifications{unread ? ` · ${unread} unread` : ''}</p>
        <h2 id="top100-notifications-heading">Stay on top of your fixtures</h2>
      </div>

      <div className="top100-push-status">
        {device.state === 'on' && <><p><strong>✓ Notifications are on for this device.</strong></p><button type="button" className="secondary" onClick={disable} disabled={busy}>Turn off on this device</button></>}
        {device.state === 'off' && <><p>Get alerts on this device for fixtures, results, your opponent's actions, comments, chat replies and announcements.</p><button type="button" onClick={enable} disabled={busy}>{busy ? 'Turning on…' : 'Turn on notifications'}</button></>}
        {device.state === 'install-first' && <p>On iPhone and iPad, notifications work once Top 100 is on your Home Screen: tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>, and open Top 100 from there.</p>}
        {device.state === 'blocked' && <p>Notifications are blocked for this site. Allow them in your browser or phone settings, then reload this page.</p>}
        {device.state === 'unsupported' && <p className="muted">This browser can't receive notifications. Everything still appears in the list below.</p>}
        {device.state === 'unconfigured' && <p className="muted">Push notifications aren't switched on for Top 100 yet. Everything still appears in the list below.</p>}
        {device.state === 'checking' && <p className="muted">Checking this device…</p>}
        {message && <p className="status" role="status">{message}</p>}
      </div>

      <details className="top100-notification-prefs">
        <summary>Choose what to be notified about</summary>
        <div className="top100-notification-prefs__list">
          {CATEGORIES.map((category) => (
            <label key={category.key} className="top100-toggle">
              <input type="checkbox" checked={prefs[category.key] !== false} onChange={() => togglePref(category.key)} />
              <span><strong>{category.label}</strong><small>{category.description}</small></span>
            </label>
          ))}
        </div>
        <p className="muted">Soccer Manager's in-game private messages can't be included: SM doesn't let other apps read them.</p>
      </details>

      <div className="top100-inbox">
        <div className="top100-inbox__header">
          <h3>Recent</h3>
          {unread > 0 && <button type="button" className="secondary" onClick={() => markRead(null)}>Mark all read</button>}
        </div>
        {inbox.length ? (
          <ul>
            {inbox.map((item) => (
              <li key={item.id} className={item.read_at ? undefined : 'is-unread'}>
                <a href={item.url || '/'} onClick={() => { if (!item.read_at) markRead([item.id]); }}>
                  <strong>{item.title}</strong>
                  {item.body && <span>{item.body}</span>}
                  <time dateTime={item.created_at}>{timeLabel(item.created_at)}</time>
                </a>
              </li>
            ))}
          </ul>
        ) : <p className="muted">Nothing yet. New fixtures, results and messages will appear here.</p>}
      </div>
    </section>
  );
}
