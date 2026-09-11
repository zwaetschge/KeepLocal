const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const translationsDir = path.join(__dirname, '../src/translations');
const keysOf = (file) => {
  const source = fs.readFileSync(path.join(translationsDir, file), 'utf8');
  const matches = source.matchAll(/^  ([A-Za-z0-9_]+):/gm);
  return new Set(Array.from(matches, match => match[1]));
};

test('German and English catalogs expose exactly the same keys', () => {
  const de = keysOf('de.js');
  const en = keysOf('en.js');

  assert.ok(de.size > 100, `catalog unexpectedly small: ${de.size} keys`);
  assert.deepEqual(
    Array.from(en).filter(key => !de.has(key)).sort(),
    [],
    'keys missing in German catalog',
  );
  assert.deepEqual(
    Array.from(de).filter(key => !en.has(key)).sort(),
    [],
    'keys missing in English catalog',
  );
});

test('user-facing components keep using catalog keys instead of raw German', () => {
  for (const file of ['Register.jsx', 'Settings.jsx', 'ErrorBoundary.jsx']) {
    const source = fs.readFileSync(path.join(__dirname, '../src/components', file), 'utf8');
    // Erlaubt bleiben: Konsolen-/Fehlerausgaben für Entwickler und CSS-Klassen.
    const jsx = source
      .split('\n')
      .filter(line => !/console\.(log|error|warn)/.test(line))
      .join('\n');
    assert.doesNotMatch(
      jsx,
      />[^<>{}]*\b(Passwort|Benutzername|Kopieren|Erstellen|Fehler beim|Notiz |Seite |Zurück|Weiter)[^<>{}]*</,
      `${file} still renders hardcoded German UI text`,
    );
  }
});

// BUG_REPORT_2026-09-10 #11: the catalogs were complete, but several components
// still rendered hardcoded German next to translated strings, so an English UI
// showed a German/English mix (Setup, Settings, editor toolbar, lightbox).
test('no component renders hardcoded German UI text', () => {
  const files = fs.readdirSync(path.join(__dirname, '../src/components'))
    .filter(file => file.endsWith('.jsx'))
    .concat(['../App.jsx']);

  for (const file of files) {
    const source = fs.readFileSync(
      file.startsWith('..') ? path.join(__dirname, '../src', file.slice(3)) : path.join(__dirname, '../src/components', file),
      'utf8'
    );
    const code = source
      .split('\n')
      .filter(line => !/console\.(log|error|warn)/.test(line) && !line.trim().startsWith('//') && !line.trim().startsWith('*'))
      .join('\n');

    // JSX text nodes
    assert.doesNotMatch(
      code,
      />[^<>{}]*\b(Passwort|Benutzername|Kopieren|Erstellen|Fehler beim|Notiz |Seite |Zurück|Weiter|Einstellungen|Hinweis|Konfiguration|Verwaltung|Genauigkeit|Aufnahmen|Umwgebungsvariable|Umgebungsvariable)[^<>{}]*</,
      `${file} renders hardcoded German UI text`
    );

    // attributes (title / aria-label / placeholder / alt)
    assert.doesNotMatch(
      code,
      /(title|aria-label|placeholder|alt)="[^"]*[äöüßÄÖÜ][^"]*"/,
      `${file} has a hardcoded German attribute`
    );
    assert.doesNotMatch(
      code,
      /(title|aria-label|placeholder|alt)="(Bild löschen|Bilder auswählen|Entfernen|Neu|Schließen|Vorheriges Bild|Nächstes Bild|Aufnahme stoppen|Sprachaufnahme starten|Transkribiere\.\.\.|Vorschau entfernen|Einstellungen|Neue Notiz erstellen|Hochladen\.\.\.)"/,
      `${file} has a hardcoded German attribute`
    );
  }
});

// Mechanical guard: a key that is used but missing renders as the raw key
// string (the `|| 'fallback'` chains never trigger because a key is truthy).
test('every t() key used in the app exists in both catalogs', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
  const sources = walk(path.join(__dirname, '../src'))
    .filter(file => /\.(jsx|js|mjs)$/.test(file) && !file.includes('/translations/'));

  const used = new Set();
  for (const file of sources) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bt\(\s*'([A-Za-z0-9_.]+)'/g)) used.add(match[1]);
  }

  const de = keysOf('de.js');
  const en = keysOf('en.js');
  const missingDe = [...used].filter(key => !de.has(key)).sort();
  const missingEn = [...used].filter(key => !en.has(key)).sort();

  assert.ok(used.size > 150, `unexpectedly few keys scanned: ${used.size}`);
  assert.deepEqual(missingDe, [], 'keys missing in the German catalog');
  assert.deepEqual(missingEn, [], 'keys missing in the English catalog');
});

// #10: the crash screen was always German because getBrowserLanguage() received
// an array where it expects a keyed catalog object.
test('the error boundary resolves the browser language from the catalog object', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/ErrorBoundary.jsx'), 'utf8');

  assert.match(source, /const catalogs = \{ de, en \};/);
  assert.match(source, /getBrowserLanguage\(catalogs, 'de'\)/);
  assert.doesNotMatch(source, /getBrowserLanguage\(\[/);
});

// #11 (a11y): <html lang> ships as "de" in index.html, so the active language
// has to be written back to the document.
test('the language provider syncs <html lang> and the document title', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/contexts/LanguageContext.jsx'), 'utf8');

  assert.match(source, /document\.documentElement\.lang = language;/);
  assert.match(source, /document\.title = title;/);
  assert.match(source, /appTitle/);
});

// #13: the language switcher must be reachable while logged in, not only on the
// auth screens.
test('the language selector is mounted on the auth screens and in settings', () => {
  for (const file of ['Login.jsx', 'Register.jsx', 'Setup.jsx', 'Settings.jsx']) {
    const source = fs.readFileSync(path.join(__dirname, '../src/components', file), 'utf8');
    assert.match(source, /import LanguageSelector from '\.\/LanguageSelector';/, `${file} imports the selector`);
    assert.match(source, /<LanguageSelector \/>/, `${file} mounts the selector`);
  }
});
