const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// Improvement #6: preferences follow the account instead of the browser.
// Audit 2026-09-12 (Nr. 17): a failed preference push must not stay silent,
// and the explicit language choice must not survive logout.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('the API layer can read and write account preferences', () => {
  const constants = read('constants', 'api.js');
  assert.match(constants, /PREFERENCES: '\/api\/auth\/preferences'/);

  const authApi = read('services', 'api', 'authAPI.js');
  assert.match(authApi, /updatePreferences: async \(preferences\) =>/);
  assert.match(authApi, /method: 'PUT'/);
  assert.match(authApi, /API_ENDPOINTS\.AUTH\.PREFERENCES/);
});

test('the settings context adopts server preferences and pushes changes debounced', () => {
  const context = read('contexts', 'SettingsContext.jsx');

  // Server is the source of truth after login.
  assert.match(context, /const \{ user, isLoggedIn \} = useAuth\(\);/);
  assert.match(context, /const serverPreferences = user\?\.preferences;/);
  assert.match(context, /const fromServer = normalizeSettings\(serverPreferences\);/);
  assert.match(context, /settingsEqual\(previous, fromServer\) \? previous : fromServer/);

  // Debounced write-back with honest failure handling — the diff, the retry
  // semantics and the pagehide flush live in utils/preferencesSync.mjs (see
  // the executable tests below).
  assert.match(context, /createPreferenceSync\(\{/);
  assert.match(context, /authAPI\.updatePreferences\(preferencesFromSettings\(current\)\)/);
  assert.match(context, /toastBus\.warning\(tRef\.current\('errPreferencesNotSaved'\)\)/);
  assert.match(context, /syncRef\.current\.adopt\(JSON\.stringify\(fromServer\)\)/);
  assert.match(context, /syncRef\.current\.schedule\(/);

  // Logout clears the cache, but only on the logged-in -> logged-out transition
  // (never on first render, which would wipe a visitor's local theme).
  assert.match(context, /wasLoggedInRef/);
  assert.match(context, /removeLocalStorage\(STORAGE_KEY\);/);
  assert.match(context, /if \(!wasLoggedInRef\.current\) return;/);

  // Older installs kept the theme in its own key.
  assert.match(context, /LEGACY_THEME_KEY = 'theme'/);
});

test('the language context follows the account language', () => {
  const context = read('contexts', 'LanguageContext.jsx');

  assert.match(context, /import \{ useAuth \} from '\.\/AuthContext';/);
  assert.match(context, /const accountLanguage = user\?\.preferences\?\.language;/);
  assert.match(context, /setLanguage\(accountLanguage\);/);
  assert.match(context, /authAPI\.updatePreferences\(\{ language: langCode \}\)/);
});

test('logout clears the explicit language choice, but only after login (Nr. 17)', () => {
  const context = read('contexts', 'LanguageContext.jsx');

  // The key used to survive logout and account switches, so the next person on
  // a shared machine inherited the previous user's language.
  assert.match(context, /removeLocalStorage\(LANGUAGE_STORAGE_KEY\)/);
  assert.match(context, /clearLanguagePreference/);
  // Same transition guard as SettingsContext: a logged-out visitor must not
  // lose their own choice on every page load.
  assert.match(context, /if \(!wasLoggedInRef\.current\) return;/);

  // A failed language push warns instead of silently reverting at the next login.
  assert.match(context, /toastBus\.warning\(/);
  assert.match(context, /errPreferencesNotSaved/);

  const de = read('translations', 'de.js');
  const en = read('translations', 'en.js');
  assert.match(de, /errPreferencesNotSaved:/);
  assert.match(en, /errPreferencesNotSaved:/);
});

test('the repair paths clear the language key too, and both lists stay identical', () => {
  const recovery = read('utils', 'appRecovery.mjs');
  const recover = read('..', 'public', 'recover.js');

  assert.match(recovery, /'keeplocal_language'/, 'appRecovery must clear keeplocal_language');
  assert.match(recover, /'keeplocal_language'/, 'recover.js must clear keeplocal_language');

  const keysOf = (source) => {
    const match = source.match(/APP_PREFERENCE_KEYS = \[([^\]]*)\]/);
    return match[1].split(',').map((entry) => entry.trim().replace(/'/g, ''));
  };
  assert.deepEqual(keysOf(recovery), keysOf(recover), 'the two key lists must not drift apart');
});

test('App reads the theme from the account settings and nests providers correctly', () => {
  const app = read('App.jsx');

  assert.match(app, /const \{ settings, setTheme \} = useSettings\(\);/);
  assert.match(app, /const theme = settings\.theme;/);
  assert.doesNotMatch(app, /const \[theme, setTheme\] = useState/);

  // LanguageProvider needs useAuth, so AuthProvider must wrap it.
  const authIndex = app.indexOf('<AuthProvider>');
  const languageIndex = app.indexOf('<LanguageProvider>');
  const settingsIndex = app.indexOf('<SettingsProvider>');
  assert.ok(authIndex > -1 && languageIndex > authIndex, 'AuthProvider must wrap LanguageProvider');
  assert.ok(settingsIndex > languageIndex, 'LanguageProvider must wrap SettingsProvider');
});

// ---------------------------------------------------------------------------
// Executable semantics of the preference push (utils/preferencesSync.mjs).
// Nr. 17: `synced` used to be set BEFORE the request — a failed PUT counted as
// saved, no retry, no warning, and the next login silently reverted the change.
// ---------------------------------------------------------------------------

const moduleUrl = () => import(pathToFileURL(path.join(__dirname, '../src/utils/preferencesSync.mjs')).href);

/** Minimal controllable event target standing in for window. */
function fakeWindow() {
  const listeners = new Map();
  return {
    addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type),
    dispatch: (type) => listeners.get(type)?.()
  };
}

test('schedule is a no-op while the server already has the payload', async () => {
  const { createPreferenceSync } = await moduleUrl();
  const pushes = [];
  const sync = createPreferenceSync({
    push: async (s) => { pushes.push(s); },
    debounceMs: 5,
    eventTarget: fakeWindow()
  });
  sync.adopt('{"theme":"dark"}');
  sync.schedule('{"theme":"dark"}', { theme: 'dark' });
  await sleep(20);
  assert.equal(pushes.length, 0, 'an echoed state must not produce a request');
  sync.dispose();
});

test('a failed push keeps the diff open, retries later and warns once', async () => {
  const { createPreferenceSync } = await moduleUrl();
  let fail = true;
  const pushes = [];
  const warnings = [];
  const sync = createPreferenceSync({
    push: async (s) => {
      pushes.push(s);
      if (fail) throw new Error('offline');
    },
    warn: () => warnings.push(1),
    debounceMs: 5,
    eventTarget: fakeWindow()
  });

  sync.adopt('{"theme":"light"}');
  sync.schedule('{"theme":"dark"}', { theme: 'dark' });
  await sleep(20);
  assert.equal(pushes.length, 1);
  assert.equal(warnings.length, 1, 'the user must be warned about the lost save');
  assert.equal(sync.synced, '{"theme":"light"}', 'the old state stays confirmed');

  // Without a new trigger nothing is sent — but the next change (or the same
  // schedule call from an effect re-run) retries because the diff is open.
  sync.schedule('{"theme":"dark"}', { theme: 'dark' });
  await sleep(20);
  assert.equal(pushes.length, 2, 'the open diff must lead to a retry');
  assert.equal(warnings.length, 1, 'a failure streak warns once, not per retry');

  // Recovery: once the push succeeds, the payload counts as confirmed — and
  // the warning is armed again for the next failure.
  fail = false;
  sync.schedule('{"theme":"dark"}', { theme: 'dark' });
  await sleep(20);
  assert.equal(pushes.length, 3);
  assert.equal(sync.synced, '{"theme":"dark"}');

  fail = true;
  sync.schedule('{"theme":"oled"}', { theme: 'oled' });
  await sleep(20);
  assert.equal(warnings.length, 2, 'after a success the warning re-arms');

  // And the confirmed state no longer triggers requests: after the failed
  // oled push (pushes: 4) the dark payload matches the server, the open diff
  // belongs to oled — re-scheduling dark must not add another request.
  await sleep(20);
  const settled = pushes.length;
  sync.schedule('{"theme":"dark"}', { theme: 'dark' });
  await sleep(20);
  assert.equal(pushes.length, settled, 'a confirmed state must not re-send');
  sync.dispose();
});

test('pagehide flushes a pending debounce immediately', async () => {
  const { createPreferenceSync } = await moduleUrl();
  const pushes = [];
  const window = fakeWindow();
  const sync = createPreferenceSync({
    push: async (s) => { pushes.push(s); },
    debounceMs: 5000,
    eventTarget: window
  });

  sync.adopt('{"theme":"light"}');
  sync.schedule('{"theme":"dark"}', { theme: 'dark' });
  window.dispatch('pagehide');
  await sleep(10);
  assert.equal(pushes.length, 1, 'closing the tab must not eat the change');
  sync.dispose();
});

test('a server adopt during an in-flight push does not roll back the newer state', async () => {
  const { createPreferenceSync } = await moduleUrl();
  const pushes = [];
  const release = { promise: null };
  release.promise = new Promise((resolve) => { release.resolve = resolve; });
  const window = fakeWindow();

  const sync = createPreferenceSync({
    // The first push blocks until the test releases it — simulating a slow PUT
    // while /me comes back with a newer state.
    push: async (s) => {
      pushes.push(s);
      if (pushes.length === 1) await release.promise;
    },
    debounceMs: 5,
    eventTarget: window
  });

  sync.adopt('{"a":1}');
  sync.schedule('{"a":2}', { a: 2 });
  await sleep(20);
  assert.equal(sync.inFlight, true);
  sync.adopt('{"a":3}'); // server told us a newer state meanwhile
  release.resolve();
  await sleep(20);

  assert.equal(sync.synced, '{"a":3}', 'the adopted state must win over the older confirmation');
  sync.dispose();
});

test('cancel drops a pending push without sending (logout)', async () => {
  const { createPreferenceSync } = await moduleUrl();
  const pushes = [];
  const sync = createPreferenceSync({
    push: async (s) => { pushes.push(s); },
    debounceMs: 5000,
    eventTarget: fakeWindow()
  });
  sync.adopt('{"theme":"light"}');
  sync.schedule('{"theme":"dark"}', { theme: 'dark' });
  sync.cancel();
  await sleep(10);
  assert.equal(pushes.length, 0, 'logout must not fire the leftover timer');
  sync.dispose();
});
