const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// Audit 2026-09-12 (Top-30 Nr. 14): Offline war der stillste Zustand der App —
// der 60-s-Poll lief mit `silent: true` weiter, ein fehlgeschlagenes Speichern
// zeigte nur „Error updating note", und `resolveApiErrorMessage` warf die
// Signatur `Failed to fetch` ausdrücklich weg. Für eine als „lokale Notizen"
// positionierte App ist ein Tunnel/WLAN-Wechsel der häufigste Alltagsfall.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');
const statusUrl = pathToFileURL(path.join(__dirname, '../src/utils/onlineStatus.mjs')).href;
const apiErrorsUrl = pathToFileURL(path.join(__dirname, '../src/utils/apiErrors.mjs')).href;

function eventTargetStub() {
  const handlers = new Map();
  return {
    handlers,
    addEventListener(name, fn) { handlers.set(name, fn); },
    removeEventListener(name) { handlers.delete(name); },
    emit(name) { handlers.get(name)?.(); }
  };
}

test('navigator.onLine decides the status, undefined stays optimistic', async () => {
  const { isOnlineNow } = await import(statusUrl);
  assert.equal(isOnlineNow({ onLine: true }), true);
  assert.equal(isOnlineNow({ onLine: false }), false);
  assert.equal(isOnlineNow({}), true, 'unknown must not show an offline banner');
  assert.equal(isOnlineNow(undefined), true);
});

test('the tracker notifies on online/offline and cleans up its listeners', async () => {
  const { createOnlineTracker } = await import(statusUrl);
  const target = eventTargetStub();
  const navigatorLike = { onLine: true };

  const tracker = createOnlineTracker({ target, navigator: navigatorLike });
  const seen = [];
  const unsubscribe = tracker.subscribe((value) => seen.push(value));

  assert.equal(tracker.isOnline(), true);

  navigatorLike.onLine = false;
  target.emit('offline');
  assert.equal(tracker.isOnline(), false);
  assert.deepEqual(seen, [false]);

  navigatorLike.onLine = true;
  target.emit('online');
  assert.deepEqual(seen, [false, true]);

  // Ein unveränderter Status darf keinen Render auslösen.
  target.emit('online');
  assert.deepEqual(seen, [false, true]);

  unsubscribe();
  navigatorLike.onLine = false;
  target.emit('offline');
  assert.deepEqual(seen, [false, true], 'after unsubscribe nothing is delivered');

  tracker.destroy();
  assert.equal(target.handlers.size, 0, 'destroy removes both listeners');
});

test('a target without addEventListener does not break the tracker', async () => {
  const { createOnlineTracker } = await import(statusUrl);
  const tracker = createOnlineTracker({ target: {}, navigator: { onLine: false } });
  assert.equal(tracker.isOnline(), false);
  const seen = [];
  tracker.subscribe((value) => seen.push(value));
  tracker.recheck();
  assert.deepEqual(seen, []);
  tracker.destroy();
});

test('browser network-error signatures are recognised', async () => {
  const { isNetworkErrorMessage } = await import(statusUrl);
  for (const message of [
    'Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    'Load failed',
    'fetch failed',
    'TypeError: NetworkError when attempting to fetch resource.'
  ]) {
    assert.equal(isNetworkErrorMessage(message), true, message);
  }
  assert.equal(isNetworkErrorMessage('Notiz nicht gefunden'), false);
  assert.equal(isNetworkErrorMessage(''), false);
  assert.equal(isNetworkErrorMessage(undefined), false);
});

test('a failed save while offline says so instead of "error updating note"', async () => {
  const { resolveApiErrorMessage } = await import(apiErrorsUrl);
  const translate = (key) => (key === 'errOffline' ? 'No connection — changes are not saved.' : key);

  const offlineError = new Error('Failed to fetch');
  assert.equal(resolveApiErrorMessage(offlineError, translate, 'errorUpdating'),
    'No connection — changes are not saved.');

  // Ein Server-Code gewinnt weiterhin vor der Signatur-Erkennung.
  const coded = Object.assign(new Error('Failed to fetch'), { code: 'NOTE_CONFLICT' });
  assert.equal(resolveApiErrorMessage(coded, (key) => (key === 'errNoteConflict' ? 'Changed elsewhere.' : key)),
    'Changed elsewhere.');

  // Eine echte Server-Aussage bleibt unangetastet.
  assert.equal(resolveApiErrorMessage(new Error('Notiz nicht gefunden'), translate, 'errorUpdating'),
    'Notiz nicht gefunden');
});

test('the app shows the banner offline and refreshes on reconnect', () => {
  const app = read('App.jsx');
  assert.match(app, /import \{ useKeyboardShortcuts, useNotesManager, useFolderFeatures, useOnlineRefresh \} from '\.\/hooks';/);
  assert.match(app, /import OfflineBanner from '\.\/components\/OfflineBanner';/);
  assert.match(app, /const isOnline = useOnlineRefresh\(\{\n\s+enabled: isLoggedIn,/);
  assert.match(app, /\{!isOnline && \(\n\s+<OfflineBanner onRetry=/, 'the banner renders in the authenticated shell');
  assert.match(app, /fetchNotes\(searchTerm, pagination\.page, \{ background: true, silent: true \}\);/);
  assert.match(app, /showToast\(t\('backOnline'\), 'success'/);

  const banner = read('components', 'OfflineBanner.jsx');
  assert.match(banner, /role="status" aria-live="polite"/, 'screen readers must announce the state');
  assert.match(banner, /t\('offlineBanner'\)/);
  assert.match(banner, /className="offline-banner-retry"/);

  const hook = read('hooks', 'useOnlineStatus.js');
  assert.match(hook, /createOnlineTracker\(\)/);
  assert.match(hook, /tracker\.destroy\(\);/, 'listeners must not leak');
  // Die Reconnect-Logik lebt im Hook, nicht in App.jsx (dort gilt eine
  // Zeilen-Obergrenze, damit keine Geschäftslogik zurückwandert).
  assert.match(hook, /export function useOnlineRefresh\(\{ enabled = true, onReconnect = null \} = \{\}\)/);
  assert.match(hook, /wasOfflineRef\.current = true;/);
  assert.match(hook, /callbackRef\.current = onReconnect;/, 'the callback lives in a ref so the effect does not re-run per render');
  assert.match(hook, /if \(enabled\) callbackRef\.current\?\.\(\);/);
  assert.doesNotMatch(app, /wasOfflineRef/, 'App.jsx must not carry the reconnect state machine');
});

test('network codes are part of the shared vocabulary and translated', () => {
  const { ALL_CODES, TRANSPORT_CODES } = require('../../server/constants/errorCodes');
  for (const code of ['OFFLINE', 'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'ABORTED']) {
    assert.ok(TRANSPORT_CODES.includes(code), `${code} must be declared`);
    assert.ok(ALL_CODES.includes(code), `${code} must be part of ALL_CODES`);
  }

  const apiErrors = read('utils', 'apiErrors.mjs');
  assert.match(apiErrors, /NETWORK_ERROR: 'errOffline'/);
  assert.match(apiErrors, /import \{ isNetworkErrorMessage \} from '\.\/onlineStatus\.mjs';/);

  for (const file of ['de.js', 'en.js']) {
    const translations = read('translations', file);
    for (const key of ['errOffline', 'offlineBanner', 'offlineRetry', 'backOnline']) {
      assert.match(translations, new RegExp(`${key}:`), `${file} must translate ${key}`);
    }
  }
});
