const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');

// v1.18.0-Web-Runde: (1) Erinnerungen feuern — die Übersicht (v1.17.0) zeigte
// sie nur an, Toast und Notification erschienen nie; (2) Wiki-Links im
// offenen Editor navigieren statt vom Modal-Guard geschluckt zu werden;
// (3) das Suchfeld folgt extern gesetzten Begriffen (gespeicherte Suchen);
// (4) gespeicherte Suchen laufen global, nicht im offenen Ordner-Scope.

test('fällige Erinnerungen feuern Toast und System-Notification einmal pro Notiz', () => {
  const hook = read('hooks', 'useFolderFeatures.js');

  // Einmal pro Notiz und Session …
  assert.match(hook, /const firedRemindersRef = useRef\(new Set\(\)\);/);
  // … über ref.current (ohne .current wäre der Effekt ein Laufzeit-Throw) …
  assert.match(hook, /if \(firedRemindersRef\.current\.has\(node\.id\)\) continue;/);
  assert.match(hook, /firedRemindersRef\.current\.add\(node\.id\);/);
  // … und nur, was SEIT dem letzten Check fällig wurde — mit 15-Minuten-
  // Deckel, damit ein Reload nicht jeden alten Termin nachwirft.
  assert.match(hook, /const lastDueCheckRef = useRef\(Date\.now\(\) - 15 \* 60_000\);/);
  assert.match(hook, /const since = Math\.max\(lastDueCheckRef\.current, now - 15 \* 60_000\);/);
  assert.match(hook, /if \(!due \|\| node\.isArchived \|\| due > now \|\| due <= since\) continue;/);
  // Toast immer, Notification nur mit erteilter Freigabe.
  assert.match(hook, /showToast\(`\$\{t\('reminderDue'\)\}: \$\{title\} · \$\{label\}`/);
  assert.match(hook, /Notification\.permission === 'granted'/);
});

test('die Notification-Freigabe wird in den Einstellungen erteilt', () => {
  const settings = read('components', 'Settings.jsx');

  // Promise-Brücke: alte WebKit-Builds nehmen einen Callback und geben
  // undefined zurück — der Zustand muss in beiden Formen gesetzt werden.
  assert.match(settings, /Notification\.requestPermission\(resolve\)/);
  assert.match(settings, /setNotificationPermission\(result \|\| Notification\.permission\)/);
  // Die vier Browser-Zustände haben je eine Ansage …
  for (const key of ['notificationEnabled', 'notificationBlocked', 'notificationUnsupported', 'notificationEnable']) {
    assert.ok(settings.includes(`t('${key}')`), `Settings muss ${key} anzeigen`);
  }

  for (const file of ['de.js', 'en.js']) {
    const translations = read('translations', file);
    for (const key of ['reminderDue', 'notificationSection', 'notificationSectionDescription',
      'notificationEnable', 'notificationEnabled', 'notificationBlocked', 'notificationUnsupported']) {
      assert.match(translations, new RegExp(`${key}: `), `${file} muss ${key} übersetzen`);
    }
  }
});

test('Wiki-Links im offenen Editor ersetzen die Notiz, „Neue Notiz“ bleibt verboten', () => {
  const app = read('App.jsx');

  assert.match(app, /setNoteModal\(prev => \(!prev\.isOpen/);
  assert.match(app, /String\(prev\.note\?\._id \?\? 'new'\) !== String\(note\._id\)/);
});

test('das Suchfeld folgt extern gesetzten Begriffen (gespeicherte Suchen)', () => {
  const searchBar = read('components', 'SearchBar.jsx');
  const app = read('App.jsx');

  // Externer Wert überschreibt das Feld und killt einen laufenden Debounce —
  // sonst überholte der nach 300 ms den gerade gewählten Suchbegriff.
  assert.match(searchBar, /searchTerm: externalSearchTerm/);
  assert.match(searchBar, /if \(externalSearchTerm === undefined\) return;/);
  assert.match(searchBar, /if \(debounceRef\.current\) clearTimeout\(debounceRef\.current\);/);
  assert.match(app, /<SearchBar onSearch=\{handleSearch\} searchTerm=\{searchTerm\}/);
});

test('gespeicherte Suchen verlassen den Ordner-Scope', () => {
  const hook = read('hooks', 'useFolderFeatures.js');
  const manager = read('hooks', 'useNotesManager.js');

  assert.match(hook, /clearFolderScope\?\.\(\);/);
  // Der Clear ist kein Toggle (selectFolder bräuchte den aktuellen Wert) —
  // ein eigener, wertunabhängiger Reset.
  assert.match(manager, /const clearFolderScope = useCallback\(\(\) => \{\s*\n\s*setFolderScope\(null\);/);
  assert.match(manager, /clearFolderScope,/);
});
