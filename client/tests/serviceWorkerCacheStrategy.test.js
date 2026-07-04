const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const serviceWorker = fs.readFileSync(
  path.join(__dirname, '../public/service-worker.js'),
  'utf8'
);

test('service worker uses network-first handling before generic cache lookup for navigations', () => {
  const fetchHandlerIndex = serviceWorker.indexOf("self.addEventListener('fetch'");
  const navigationIndex = serviceWorker.indexOf("event.request.mode === 'navigate'", fetchHandlerIndex);
  const genericCacheLookupIndex = serviceWorker.indexOf('caches.match(event.request)', fetchHandlerIndex);

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
  assert.doesNotMatch(serviceWorker, /CACHE_NAME\s*=\s*['"]keeplocal-v1['"]/);
});
