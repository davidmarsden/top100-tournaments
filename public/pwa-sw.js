// Top 100 PWA service worker.
//
// manager.smtop100.blog must never be controlled by a cached application shell.
// Older versions of this worker did cache the shared shell, so on the manager
// host this worker deletes those caches and deliberately has no fetch handler:
// every request still goes straight to the network. Its only job there is to
// receive Web Push notifications and open the right page when one is tapped.
const IS_MANAGER_HOST = self.location.hostname === 'manager.smtop100.blog';

if (IS_MANAGER_HOST) {
  self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
  });

  self.addEventListener('activate', event => {
    event.waitUntil((async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(key => key.startsWith('top100-tournaments-shell-'))
          .map(key => caches.delete(key)),
      );
      await self.clients.claim();
    })());
  });

  // Intentionally no fetch handler on the Manager Portal host.

  self.addEventListener('push', event => {
    let payload = {};
    try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data ? event.data.text() : '' }; }
    const title = String(payload.title || 'Top 100').slice(0, 120);
    const url = new URL(String(payload.url || '/'), self.location.origin);
    const target = url.origin === self.location.origin || url.hostname.endsWith('.smtop100.blog') ? url.href : self.location.origin + '/';
    event.waitUntil(self.registration.showNotification(title, {
      body: String(payload.body || '').slice(0, 400),
      icon: '/top100-icon-192.png',
      badge: '/top100-badge-96.png',
      tag: payload.tag ? String(payload.tag).slice(0, 120) : undefined,
      data: { url: target, notificationId: payload.id || null },
    }));
  });

  self.addEventListener('notificationclick', event => {
    event.notification.close();
    const target = event.notification.data?.url || self.location.origin + '/';
    event.waitUntil((async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const sameUrl = clients.find(client => client.url === target);
      if (sameUrl) return sameUrl.focus();
      const sameOrigin = clients.find(client => new URL(client.url).origin === self.location.origin);
      if (sameOrigin && new URL(target).origin === self.location.origin) {
        await sameOrigin.navigate(target);
        return sameOrigin.focus();
      }
      return self.clients.openWindow(target);
    })());
  });
} else {
  const CACHE = 'top100-tournaments-shell-v3';
  const CONTROL_FILES = new Set([
    '/tournaments.webmanifest',
    '/my-matches.webmanifest',
    '/voting.webmanifest',
    '/top100-app-icon.svg',
  ]);
  const SHELL = ['/', ...CONTROL_FILES];

  async function precacheShell() {
    const cache = await caches.open(CACHE);
    const response = await fetch('/', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not fetch Top 100 app shell.');

    await cache.put('/', response.clone());
    const html = await response.text();
    const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(match => match[1]);
    await cache.addAll([...new Set([...SHELL.filter(path => path !== '/'), ...assets])]);
  }

  async function networkFirstAndRefresh(request) {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(request, { cache: 'no-store' });
      if (response.ok) await cache.put(request, response.clone());
      return response;
    } catch (error) {
      const cached = await cache.match(request);
      if (cached) return cached;
      throw error;
    }
  }

  self.addEventListener('install', event => {
    event.waitUntil(precacheShell());
    self.skipWaiting();
  });

  self.addEventListener('activate', event => {
    event.waitUntil(
      caches.keys().then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('top100-tournaments-shell-') && key !== CACHE)
          .map(key => caches.delete(key)),
      )),
    );
    self.clients.claim();
  });

  self.addEventListener('fetch', event => {
    const request = event.request;
    if (request.method !== 'GET') return;

    const url = new URL(request.url);
    if (url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) return;

    if (request.mode === 'navigate') {
      event.respondWith(
        fetch(request, { cache: 'no-store' }).catch(() => caches.match('/')),
      );
      return;
    }

    if (CONTROL_FILES.has(url.pathname)) {
      event.respondWith(networkFirstAndRefresh(request));
      return;
    }

    if (url.pathname.startsWith('/assets/')) {
      event.respondWith(
        caches.match(request).then(cached => cached || fetch(request).then(response => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then(cache => cache.put(request, copy));
          }
          return response;
        })),
      );
    }
  });
}
