const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const serviceWorker = fs.readFileSync(
  path.join(__dirname, '../public/service-worker.js'),
  'utf8'
);
const clientEntry = fs.readFileSync(
  path.join(__dirname, '../src/index.jsx'),
  'utf8'
);
const updatePrompt = fs.readFileSync(
  path.join(__dirname, '../src/hooks/useUpdatePrompt.js'),
  'utf8'
);

test('service worker uses network-first handling before generic cache lookup for navigations', () => {
  const fetchHandlerIndex = serviceWorker.indexOf("self.addEventListener('fetch'");
  const navigationIndex = serviceWorker.indexOf("event.request.mode === 'navigate'", fetchHandlerIndex);
  // Der generische Cache-First-Lookup ist respondWith(caches.match(...)) —
  // das nackte caches.match reicht seit v1.16.0 nicht mehr als Anker, weil der
  // SWR-Offline-Fallback für /api/notes ebenfalls caches.match ruft.
  const genericCacheLookup = serviceWorker.slice(fetchHandlerIndex).match(/respondWith\(\s*caches\.match\(event\.request\)/);
  const genericCacheLookupIndex = genericCacheLookup
    ? fetchHandlerIndex + serviceWorker.slice(fetchHandlerIndex).indexOf(genericCacheLookup[0])
    : -1;

  assert.notEqual(navigationIndex, -1, 'navigation branch is missing');
  assert.notEqual(genericCacheLookupIndex, -1, 'generic cache lookup is missing');
  assert.ok(
    navigationIndex < genericCacheLookupIndex,
    'navigation requests must be handled before the generic cache-first lookup'
  );

  const navigationBlock = serviceWorker.slice(navigationIndex, genericCacheLookupIndex);
  assert.match(navigationBlock, /fetch\(event\.request\)/);
});

test('service worker cache name is bumped so old app-shell caches are discarded', () => {
  assert.doesNotMatch(serviceWorker, /CACHE_NAME\s*=\s*['"]keeplocal-v7['"]/);
  assert.match(serviceWorker, /CACHE_NAME\s*=\s*['"]keeplocal-v8['"]/);
  assert.match(serviceWorker, /cacheName\.startsWith\(['"]keeplocal-['"]\)/);
});

test('private uploaded images are never stored in the service worker cache', () => {
  assert.match(serviceWorker, /url\.pathname\.startsWith\(['"]\/uploads\/['"]\)/);
  assert.match(serviceWorker, /fetch\(event\.request, \{ cache: ['"]no-store['"] \}\)/);
});

test('service worker keeps cache writes and lifecycle work alive', () => {
  assert.match(serviceWorker, /async function cacheResponse/);
  assert.match(serviceWorker, /await cache\.put\(request, response\.clone\(\)\)/);
  assert.match(serviceWorker, /Promise\.all\(\[cleanup, self\.clients\.claim\(\)\]\)/);
});

test('service worker updates bypass browser HTTP caches', () => {
  assert.match(clientEntry, /updateViaCache:\s*['"]none['"]/);
  assert.match(clientEntry, /typeof registration\?\.update === ['"]function['"]/);
  assert.match(clientEntry, /await registration\.update\(\)/);
});

// ---------------------------------------------------------------------------
// v1.16.0 Nr. 7 — PWA-Offline: Notizen offline lesbar (SWR-Fallback für
// GET /api/notes) und Update-Prompt statt lautlosem skipWaiting.
// ---------------------------------------------------------------------------

test('der neue Worker wartet: kein skipWaiting in der Installation', () => {
  const installBlock = serviceWorker.slice(
    serviceWorker.indexOf("self.addEventListener('install'"),
    serviceWorker.indexOf("self.addEventListener('activate'")
  );
  assert.doesNotMatch(installBlock, /skipWaiting/,
    'install muss den wartenden Worker NICHT übernehmen lassen — das entscheidet der Update-Klick');
  assert.match(installBlock, /event\.waitUntil\(precache\)/, 'Precache bleibt install-Pflicht');

  // Übernahme nur auf Anfrage der Seite:
  assert.match(serviceWorker, /self\.addEventListener\('message'/);
  assert.match(serviceWorker, /event\.data\.type === 'SKIP_WAITING'/);
  assert.match(serviceWorker, /self\.skipWaiting\(\)/);
});

test('GET /api/notes ist netz-first mit Offline-Fallback aus dem Cache', () => {
  const fetchHandlerIndex = serviceWorker.indexOf("self.addEventListener('fetch'");
  const swrIndex = serviceWorker.indexOf("url.pathname.startsWith(API_CACHE_PREFIX)", fetchHandlerIndex);
  const genericIndex = serviceWorker.indexOf("event.request.url.includes('/api/')", fetchHandlerIndex);

  assert.ok(swrIndex > -1, 'SWR-Zweig für /api/notes fehlt');
  assert.ok(swrIndex < genericIndex, 'der spezifische Zweig muss vor dem generischen API-Bypass stehen');

  const swrBlock = serviceWorker.slice(swrIndex, genericIndex);
  // Netz zuerst: Online-Verhalten bleibt byte-identisch zu vorher.
  assert.match(swrBlock, /fetch\(event\.request\)\s*\n\s*\.then/);
  // Nur 200er landen im Cache — Fehler/Antwortform werden nie „offline“ ausgeliefert.
  assert.match(swrBlock, /response\.status === 200/);
  assert.match(swrBlock, /await cacheResponse\(event\.request, response\)/);
  // Offline: letzter Schnappschuss, sonst der 503-OFFLINE-Fallback wie vorher.
  assert.match(swrBlock, /caches\.match\(event\.request\)/);
  assert.match(swrBlock, /offlineJsonResponse\(\)/);
});

test('eine 401 räumt gecachte Notiz-Antworten weg', () => {
  // Session weg oder Account gewechselt: Offline darf nie die Notizen der
  // vorherigen Session aus dem Cache servieren.
  assert.match(serviceWorker, /response\.status === 401/);
  assert.match(serviceWorker, /purgeCachedApiResponses\(\)/);
  const purgeBlock = serviceWorker.slice(
    serviceWorker.indexOf('async function purgeCachedApiResponses'),
    serviceWorker.indexOf("self.addEventListener('install'")
  );
  assert.match(purgeBlock, /url\.pathname\.startsWith\(API_CACHE_PREFIX\)/);
  assert.match(purgeBlock, /await cache\.delete\(request\)/);
});

test('index.jsx meldet wartende Worker, der Hook zeigt den Update-Toast', () => {
  // index.jsx: waiting Worker + updatefound/statechange → Event an die App.
  assert.match(clientEntry, /keeplocal:update-available/);
  assert.match(clientEntry, /registration\.waiting/);
  assert.match(clientEntry, /registration\.addEventListener\('updatefound'/);
  assert.match(clientEntry, /installing\.state === 'installed' && navigator\.serviceWorker\.controller/);

  // Hook: Toast mit Aktion, Klick schickt SKIP_WAITING, controllerchange
  // lädt genau einmal neu.
  assert.match(updatePrompt, /t\('updateAvailable'\)/);
  assert.match(updatePrompt, /t\('updateNow'\)/);
  assert.match(updatePrompt, /postMessage\?\.\(\{ type: 'SKIP_WAITING' \}\)/);
  assert.match(updatePrompt, /addEventListener\('controllerchange', reloadOnce\)/);
  assert.match(updatePrompt, /reloadGuard/, 'der Reload ist einmalig');
});
