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
  assert.match(serviceWorker, /\['\/recover\.html', '\/recover\.js', '\/recover\.css', '\/guard\.js'\]\.includes/);
  assert.match(serviceWorker, /fetch\(event\.request, \{ cache: 'no-store' \}\)/);

  for (const source of ['/recover.html', '/recover.js', '/recover.css', '/guard.js']) {
    const rule = vercel.headers.find(header => header.source === source);
    assert.ok(rule, `${source} header rule is missing`);
    assert.ok(
      rule.headers.some(header => header.key === 'Cache-Control' && /no-store/.test(header.value)),
      `${source} must be served without caching`
    );
  }
});

test('startup guard forwards a dead bundle to the recovery page', () => {
  const indexHtml = fs.readFileSync(path.join(clientRoot, 'index.html'), 'utf8');
  const guard = fs.readFileSync(path.join(clientRoot, 'public/guard.js'), 'utf8');

  // Loaded before the module bundle so it can observe its failure.
  assert.match(indexHtml, /<script src="\/guard\.js"><\/script>\s*<script type="module"/);
  // Redirects at most once per minute and never while the app mounted.
  assert.match(guard, /sessionStorage\.getItem\(FLAG\)/);
  assert.match(guard, /appMounted\(\)/);
  assert.match(guard, /\/recover\.html\?from=guard/);
});

// BUG_REPORT_2026-09-10 (Runde 3) #5: recover.js used to repair unconditionally
// and guard.js stopped forwarding for a full minute afterwards. With a genuinely
// broken deploy that produced: blank page -> auto repair -> blank page -> no way
// out (and wiped preferences on every round). The guard now hands over with
// auto=0, and the recovery page only auto-repairs once per tab session.
test('the startup guard hands the second attempt to the manual recovery UI', () => {
  const guard = fs.readFileSync(path.join(clientRoot, 'public/guard.js'), 'utf8');

  assert.match(guard, /LOOP_GUARD_MS = 2000/);
  assert.match(guard, /var alreadyTried = Boolean\(last\);/);
  assert.match(guard, /\(alreadyTried \? '&auto=0' : '&auto=1'\)/);
  // A repeat attempt must still forward instead of leaving the user on a blank
  // page for a minute.
  assert.doesNotMatch(guard, /if \(last && now - last < LOOP_GUARD_MS\) return;\n\s*window\.location\.replace\('\/recover\.html\?from=guard'\)/);
  assert.doesNotMatch(guard, /< 60000/);
});

test('the recovery page auto-repairs once, keeps preferences, and translates itself', () => {
  assert.match(script, /AUTO_REPAIR_FLAG = 'keeplocal-recover-autorepaired'/);
  assert.match(script, /function autoRepairAllowed\(\)/);
  assert.match(script, /params\.get\('from'\) !== 'guard'/);
  assert.match(script, /params\.get\('auto'\) === '0'/);
  assert.match(script, /window\.sessionStorage\.getItem\(AUTO_REPAIR_FLAG\) !== '1'/);
  // Automatic pass: caches/service worker only. Explicit click: preferences too.
  assert.match(script, /repair\(\{ resetPreferences: false \}\)/);
  assert.match(script, /repair\(\{ resetPreferences: true \}\)/);
  assert.match(script, /if \(options\.resetPreferences\) \{\s*removeAppPreferences\(\);/);
  // Without an automatic repair the page shows its UI instead of bouncing back.
  assert.match(script, /setStatus\('', M\.readyTitle, M\.readyDetail\)/);
  assert.match(script, /retryButton\.hidden = false;/);
  // Bilingual, React-independent.
  assert.match(script, /const MESSAGES = \{/);
  assert.match(script, /en: \{/);
  assert.match(script, /document\.documentElement\.lang = resolved\.language;/);
  assert.doesNotMatch(script, /classList/);
});

test('the recovery markup exposes the hooks the translation layer needs', () => {
  for (const id of ['recovery-kicker', 'recovery-title', 'recovery-intro', 'recovery-assurance-strong', 'recovery-assurance-span', 'recovery-retry', 'recovery-open']) {
    assert.match(html, new RegExp(`id="${id}"`), `recover.html is missing #${id}`);
  }
  assert.match(html, /Konto und Notizen bleiben erhalten/);
});
