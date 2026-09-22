const CACHE_NAME = 'keeplocal-v8';
const urlsToCache = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png'
];

// GET-Lesezugriffe unter /api/notes sind die Liste, der Baum und die Meta-
// Sonde — alles, was die App zum Lesen braucht. Sie werden als SWR-Fallback
// gecacht (v1.16.0): Online kommt wie bisher die Netz-Antwort (und landet im
// Cache), offline der letzte Schnappschuss statt einer leeren Fehlermeldung.
const API_CACHE_PREFIX = '/api/notes';

async function cacheResponse(request, response) {
  if (!response || response.status !== 200 || response.type !== 'basic') {
    return response;
  }

  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  } catch (err) {
    console.log('Cache put skipped:', err.message);
  }

  return response;
}

// Language-neutral offline answer (see the fetch handler below for why).
function offlineJsonResponse() {
  return new Response(
    JSON.stringify({ code: 'OFFLINE' }),
    {
      headers: { 'Content-Type': 'application/json' },
      status: 503
    }
  );
}

/** Gecachte Notiz-Antworten verwerfen (bei 401: Session weg oder gewechselt). */
async function purgeCachedApiResponses() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    for (const request of keys) {
      const url = new URL(request.url);
      if (url.pathname.startsWith(API_CACHE_PREFIX)) {
        await cache.delete(request);
      }
    }
  } catch (err) {
    console.log('Cache purge skipped:', err.message);
  }
}

// Install event - cache resources. Kein skipWaiting mehr (v1.16.0): Der neue
// Worker wartet als „waiting", bis die Seite (Update-Toast) SKIP_WAITING
// schickt. Vorher griff ein Deploy mitten in laufenden Sessions um — alter
// Tab, neue Assets — ohne dass jemand etwas mitbekam.
self.addEventListener('install', event => {
  const precache = caches.open(CACHE_NAME)
    .then(cache => cache.addAll(urlsToCache.map(url => new Request(url, { cache: 'reload' }))))
    .catch(err => {
      console.log('Cache addAll error:', err.message);
    });
  event.waitUntil(precache);
});

// Activate event - clean up old caches (Rotation: Jede CACHE_NAME-Erhöhung
// verwirft den kompletten Bestand des Vorgängers, inklusive gecachter API-
// Antworten — nach einem Deploy wird nie eine alte Antwort-Form ausgeliefert).
self.addEventListener('activate', event => {
  const cleanup = caches.keys().then(cacheNames => Promise.all(
    cacheNames.map(cacheName => (
      cacheName.startsWith('keeplocal-') && cacheName !== CACHE_NAME
        ? caches.delete(cacheName)
        : null
    ))
  ));
  event.waitUntil(Promise.all([cleanup, self.clients.claim()]));
});

// Der Update-Toast schickt { type: 'SKIP_WAITING' } — erst dieser Klick lässt
// den wartenden Worker übernehmen (controllerchange in der Seite lädt neu).
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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

  // Notizen-Lesezugriffe: Netz zuerst, Cache als Offline-Fallback (SWR). Nur
  // 200er werden gecacht; eine 401 räumt die gecachten Antworten weg, damit
  // offline nie die Notizen einer fremden/abgelaufenen Session ausgeliefert
  // werden. Schreiben (POST/PUT/DELETE) erreicht diesen Zweig nie — oben
  // steigt alles Nicht-GET aus.
  if (url.pathname.startsWith(API_CACHE_PREFIX)) {
    event.respondWith(
      fetch(event.request)
        .then(async response => {
          if (response.status === 200) {
            await cacheResponse(event.request, response);
          } else if (response.status === 401) {
            await purgeCachedApiResponses();
          }
          return response;
        })
        .catch(async () =>
          (await caches.match(event.request)) || offlineJsonResponse()
        )
    );
    return;
  }

  // Skip API calls - always fetch from network
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request)
        .catch(() => {
          // Language-neutral on purpose: apiUtils turns a payload with a `code`
          // and no `error` text into an empty message, so callers fall back to
          // their translated strings instead of showing a hardcoded one.
          return offlineJsonResponse();
        })
    );
    return;
  }

  // Uploaded note images are private data. Never persist them in Cache Storage.
  if (url.pathname.startsWith('/uploads/')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  // The standalone recovery path must always come from the network so it can
  // repair a stale app shell or service worker without depending on React.
  // guard.js belongs to that path: it forwards a dead bundle to /recover.html.
  if (['/recover.html', '/recover.js', '/recover.css', '/guard.js'].includes(url.pathname)) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
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
