// Service worker: precache the app shell, then cache-first for static assets
// and network-first for page navigations (so new releases land on reload).
// BUMP CACHE_V whenever the asset ?v= version changes.
const CACHE_V = 'gto-v17';
const PRECACHE = [
  '.',
  'index.html',
  'guide.html',
  'advanced.html',
  'css/styles.css?v=17',
  'data/equity169.js?v=17',
  'js/constants.js?v=17',
  'js/solver.js?v=17',
  'js/ranges.js?v=17',
  'js/deck.js?v=17',
  'js/postflop.js?v=17',
  'js/postflop-solver.js?v=17',
  'js/main.js?v=17',
  'js/solver-worker.js?v=17',
  'js/postflop-worker.js?v=17',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_V).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_V).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // pages: fresh when online, cached when offline
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_V).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((m) => m || caches.match('index.html')))
    );
    return;
  }
  // static assets are content-addressed by ?v= — cache-first is safe
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE_V).then((c) => c.put(req, copy));
      }
      return res;
    }))
  );
});
