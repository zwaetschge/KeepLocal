const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/settingsPayload.mjs')
).href;

test('settings normalization repairs malformed persisted values', async () => {
  const { DEFAULT_SETTINGS, normalizeSettings } = await import(moduleUrl);

  assert.deepEqual(normalizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(
    normalizeSettings({ aiFeatures: 'yes', transcriptionLanguage: 42 }),
    DEFAULT_SETTINGS
  );
});

test('settings normalization preserves valid supported values', async () => {
  const { normalizeSettings } = await import(moduleUrl);
  const settings = {
    theme: 'oled',
    aiFeatures: { voiceTranscription: true },
    transcriptionLanguage: 'de',
    // v1.10.0: Tag-Farben, gespeicherte Suchen, Journal-Ordner
    tagColors: { ideen: '#84cc16' },
    savedSearches: [{ id: 's-1', name: 'Offene Punkte', query: 'offen', typeFilter: null, tag: null }],
    journalFolderId: '64b1f0c9a1d4e5f6a7b8c9d0',
    // v1.13.0: Markdown-Rendering der Karten
    renderMarkdown: true
  };

  assert.deepEqual(normalizeSettings(settings), settings);
});

// Improvement #6: preferences belong to the account, not to one browser.
test('unknown themes and junk keys are dropped', async () => {
  const { normalizeSettings, DEFAULT_SETTINGS } = await import(moduleUrl);

  assert.deepEqual(
    normalizeSettings({ theme: 'neon', isAdmin: true, aiFeatures: { voiceTranscription: 'yes' } }),
    DEFAULT_SETTINGS
  );
  assert.equal(normalizeSettings({ theme: 'doodle' }).theme, 'doodle');
});

test('user preferences are mapped into settings and back', async () => {
  const { settingsFromUser, preferencesFromSettings, settingsEqual } = await import(moduleUrl);

  const user = {
    id: 'u1',
    preferences: { theme: 'dark', aiFeatures: { voiceTranscription: true }, transcriptionLanguage: 'fr' }
  };
  const settings = settingsFromUser(user);
  // v1.10.0: Die neuen Schlüssel normalisieren mit auf ihre Defaults — ein
  // Account ohne sie bekommt leere Farben/Suchen und keinen Journal-Ordner.
  assert.deepEqual(settings, {
    theme: 'dark',
    aiFeatures: { voiceTranscription: true },
    transcriptionLanguage: 'fr',
    tagColors: {},
    savedSearches: [],
    journalFolderId: null,
    // v1.13.0: ohne gespeicherte Präferenz gilt der Default (an)
    renderMarkdown: true
  });

  assert.deepEqual(preferencesFromSettings(settings), {
    theme: 'dark',
    aiFeatures: { voiceTranscription: true },
    transcriptionLanguage: 'fr',
    tagColors: {},
    savedSearches: [],
    journalFolderId: null,
    renderMarkdown: true
  });

  // A user without preferences (older account) falls back to the defaults.
  assert.deepEqual(settingsFromUser({ id: 'u2' }), settingsFromUser(null));

  assert.equal(settingsEqual(settings, { ...settings }), true);
  assert.equal(settingsEqual(settings, { ...settings, theme: 'eink' }), false);
  assert.equal(
    settingsEqual(settings, { theme: 'dark', aiFeatures: { voiceTranscription: 'true' }, transcriptionLanguage: 'fr' }),
    false,
    'a stringified boolean is not the same preference'
  );
});

// ---------------------------------------------------------------------------
// v1.10.0: Tag-Farben, gespeicherte Suchen, Journal-Ordner
// ---------------------------------------------------------------------------

test('tag colors are clamped like the server (200 max, 6-digit hex only)', async () => {
  const { normalizeSettings } = await import(moduleUrl);

  const colors = {};
  for (let i = 0; i < 220; i += 1) colors[`tag${i}`] = '#ABCDEF';
  colors['bad'] = 'red';
  colors['short'] = '#fff';

  const normalized = normalizeSettings({ tagColors: colors });
  const keys = Object.keys(normalized.tagColors);
  assert.equal(keys.length, 200, 'überzählige Farben fallen weg');
  assert.equal(normalized.tagColors.tag0, '#abcdef', 'Hex wird kleingeschrieben');
  assert.ok(!('bad' in normalized.tagColors), 'kein Hex-Code wird gedroppt');
  assert.ok(!('short' in normalized.tagColors), '3-stelliger Hex wird gedroppt');
  assert.equal(Object.keys(normalizeSettings({ tagColors: 'x' }).tagColors).length, 0);
});

test('saved searches keep at most 20 valid entries', async () => {
  const { normalizeSettings } = await import(moduleUrl);

  const valid = { id: 's-1', name: '  Offen  ', query: 'todo', typeFilter: null, tag: 'arbeit' };
  const searches = Array.from({ length: 25 }, (_, index) => ({ ...valid, id: `s-${index}` }));
  searches.push({ id: 'no-name', name: '', query: 'x' }); // ungültig: leerer Name

  const normalized = normalizeSettings({ savedSearches: searches });
  assert.equal(normalized.savedSearches.length, 20, 'mehr als 20 Suchen werden gekappt');
  assert.equal(normalized.savedSearches[0].name, 'Offen', 'Name wird getrimmt');
  assert.equal(normalized.savedSearches[0].id, 's-0', 'Reihenfolge bleibt erhalten');
});

test('journalFolderId must be a 24-hex Mongo id or null', async () => {
  const { normalizeSettings } = await import(moduleUrl);

  const valid = '64b1f0c9a1d4e5f6a7b8c9d0';
  assert.equal(normalizeSettings({ journalFolderId: valid }).journalFolderId, valid);
  assert.equal(normalizeSettings({ journalFolderId: 'not-an-id' }).journalFolderId, null);
  assert.equal(normalizeSettings({ journalFolderId: 42 }).journalFolderId, null);
  assert.equal(normalizeSettings({}).journalFolderId, null);
});

test('tag colors and saved searches participate in settingsEqual', async () => {
  const { settingsEqual } = await import(moduleUrl);

  const base = { theme: 'light' };
  assert.equal(settingsEqual(base, { ...base, tagColors: {} }), true);
  assert.equal(settingsEqual(base, { ...base, tagColors: { work: '#3b82f6' } }), false);
  assert.equal(settingsEqual(base, { ...base, savedSearches: [] }), true);
  assert.equal(
    settingsEqual(base, { ...base, savedSearches: [{ id: 's', name: 'N', query: '', typeFilter: null, tag: null }] }),
    false
  );
});

test('renderMarkdown ist per Default an und normalisiert falsche Werte', async () => {
  const { DEFAULT_SETTINGS, normalizeSettings, preferencesFromSettings, settingsEqual } =
    await import(moduleUrl);

  assert.equal(DEFAULT_SETTINGS.renderMarkdown, true);
  // Fehlender Schlüssel = an: alte Persistierungen vor v1.13.0 kannten ihn nicht.
  assert.equal(normalizeSettings({}).renderMarkdown, true);
  assert.equal(normalizeSettings(null).renderMarkdown, true);
  assert.equal(normalizeSettings({ renderMarkdown: false }).renderMarkdown, false);
  // Nur exakt false schaltet ab — alles andere fällt auf den Default zurück.
  assert.equal(normalizeSettings({ renderMarkdown: 'nope' }).renderMarkdown, true);
  assert.equal(normalizeSettings({ renderMarkdown: 0 }).renderMarkdown, true);
  assert.equal(normalizeSettings({ renderMarkdown: null }).renderMarkdown, true);

  // Der Schalter wandert in die Account-Präferenzen und in den Gleichheits-
  // vergleich (nur false löst eine Synchronisierung aus).
  assert.equal(preferencesFromSettings(normalizeSettings({ renderMarkdown: false })).renderMarkdown, false);
  const base = normalizeSettings({});
  assert.equal(settingsEqual(base, normalizeSettings({ renderMarkdown: true })), true);
  assert.equal(settingsEqual(base, normalizeSettings({ renderMarkdown: false })), false);
});
