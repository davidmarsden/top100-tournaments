const CACHE = 'top100-tournaments-shell-v1';
const SHELL = [
  '/',
  '/tournaments.webmanifest',
  '/my-matches.webmanifest',
  '/voting.webmanifest',
  '/top100-app-icon.svg',
];

async function precacheShell() {
  const cache = await caches.open(CACHE);
  const response = await fetch('/', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not fetch Top 100 app shell.');

  await cache.put('/', response.clone());
  const html = await response.text();
  const assets = [...html.matchAll(/(?:src|href)=["'](\/assets\/[^"']+)["']/g)].map(match => match[1]);
  await cache.addAll([...new Set([...SHELL.filter(path => path !== '/'), ...assets])]);
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

  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
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
