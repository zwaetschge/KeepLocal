const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const clientRoot = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(clientRoot, 'public/recover.html'), 'utf8');
const script = fs.readFileSync(path.join(clientRoot, 'public/recover.js'), 'utf8');
const styles = fs.readFileSync(path.join(clientRoot, 'public/recover.css'), 'utf8');
const serviceWorker = fs.readFileSync(path.join(clientRoot, 'public/service-worker.js'), 'utf8');
const vercel = JSON.parse(fs.readFileSync(path.join(clientRoot, 'vercel.json'), 'utf8'));

test('standalone recovery remains usable without the React bundle', () => {
  assert.match(html, /<script src="\/recover\.js" defer><\/script>/);
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /Konto und Notizen bleiben erhalten/);
  assert.match(html, /href="\/\?app-repair=manual"/);
  assert.match(styles, /\.recovery-actions (?:button|a):focus-visible/);
  assert.match(styles, /@media \(max-width: 480px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test('standalone recovery removes only KeepLocal browser state before redirecting', () => {
  assert.match(script, /APP_CACHE_PREFIX = 'keeplocal-'/);
  assert.match(script, /\['theme', 'keeplocal_settings', 'token'\]/);
  assert.match(script, /getRegistrations\(\)/);
  assert.match(script, /cacheName\.startsWith\(APP_CACHE_PREFIX\)/);
  assert.match(script, /Promise\.race/);
  assert.match(script, /window\.location\.replace\(appUrl\)/);
  assert.doesNotMatch(script, /classList/);
  assert.doesNotMatch(script, /document\.cookie|localStorage\.clear|indexedDB/);
});

test('recovery assets bypass service worker and edge caches', () => {
  assert.match(serviceWorker, /CACHE_NAME\s*=\s*['"]keeplocal-v7['"]/);
  assert.match(serviceWorker, /\['\/recover\.html', '\/recover\.js', '\/recover\.css'\]\.includes/);
  assert.match(serviceWorker, /fetch\(event\.request, \{ cache: 'no-store' \}\)/);

  for (const source of ['/recover.html', '/recover.js', '/recover.css']) {
    const rule = vercel.headers.find(header => header.source === source);
    assert.ok(rule, `${source} header rule is missing`);
    assert.ok(
      rule.headers.some(header => header.key === 'Cache-Control' && /no-store/.test(header.value)),
      `${source} must be served without caching`
    );
  }
});
