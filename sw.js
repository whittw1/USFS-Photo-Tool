const CACHE_NAME = 'usfs-collector-v1.2';
const URLS_TO_CACHE = [
  './',
  './index.html',
  './team_guide_citations.json',
  './forest_locations.json',
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
];

// Install — cache the app shell
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(URLS_TO_CACHE))
  );
  self.skipWaiting();
});

// Activate — clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch — network-first for HTML, cache-first for other assets
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isHTML = event.request.mode === 'navigate'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/')
    || url.pathname.endsWith('.json');

  if (isHTML) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(cached => cached || fetch(event.request))
    );
  }
});
