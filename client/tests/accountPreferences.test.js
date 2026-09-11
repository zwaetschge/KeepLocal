const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

// Improvement #6: preferences follow the account instead of the browser.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');

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

  // Debounced write-back, guarded against echoing our own state.
  assert.match(context, /PUSH_DEBOUNCE_MS = 600/);
  assert.match(context, /if \(payload === syncedRef\.current\) return undefined;/);
  assert.match(context, /authAPI\.updatePreferences\(preferencesFromSettings\(settings\)\)/);

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
