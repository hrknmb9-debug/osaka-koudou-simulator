/* PWA / ホーム画面用 — 更新時は CACHE 名を increment */
const CACHE = 'setup-lab-v59';
const PRECACHE = [
  './',
  './index.html',
  './sw.js',
  './scripts/red-path-browser.js',
  './scripts/road-gate.js',
  './scripts/attack-gates.js',
  './scripts/time-attack.js',
  './scripts/time-attack.js?v=53',
  './assets/shigisan-ref.png',
  './assets/minoo-ref.png',
  './assets/hanna-ref.png',
  './assets/hanna-up-map.png',
  './assets/kanjo-ref.png',
  './assets/kanjo-banner-tire.png',
  './assets/kanjo-banner-gear.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

function networkFirst(request) {
  return fetch(request)
    .then((res) => {
      if (res && res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return res;
    })
    .catch(() => caches.match(request));
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  const networkFirstReq =
    e.request.mode === 'navigate' ||
    e.request.destination === 'document' ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.html');

  if (networkFirstReq) {
    e.respondWith(networkFirst(e.request));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
