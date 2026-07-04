const CACHE_NAME = 'keeplocal-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

function cacheResponse(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') {
    return response;
  }

  caches.open(CACHE_NAME)
    .then(cache => {
      cache.put(request, response.clone());
    })
    .catch(err => {
      console.log('Cache put skipped:', err.message);
    });

  return response;
}

// Install event - cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache.map(url => new Request(url, { cache: 'reload' })))
          .catch(err => {
            console.log('Cache addAll error:', err);
            // Continue even if some resources fail to cache
            return Promise.resolve();
          });
      })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - serve app shell from network first, assets from cache first
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') {
    return;
  }

  // Skip non-http(s) schemes (chrome-extension, etc.)
  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) {
    return;
  }

  // Skip API calls - always fetch from network
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          return new Response(
            JSON.stringify({ error: 'Offline - API nicht verfügbar' }),
            {
              headers: { 'Content-Type': 'application/json' },
              status: 503
            }
          );
        })
    );
    return;
  }

  if (event.request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(
      fetch(event.request)
        .then(response => cacheResponse(event.request, response))
        .catch(() => caches.match(event.request).then(response => response || caches.match('/index.html')))
    );
    return;
  }

  // Hashed static assets can be served cache first.
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }

        return fetch(event.request).then(response => cacheResponse(event.request, response));
      })
  );
});
