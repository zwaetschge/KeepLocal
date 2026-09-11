const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// Improvement #3: the API answers with stable codes and the client translates
// them. This test is the contract between three places that would otherwise
// drift apart: server/constants/errorCodes.js, client/src/utils/apiErrors.mjs
// and the two translation catalogs.

const { ALL_CODES, MESSAGE_TO_CODE, STATUS_TO_CODE } = require('../../server/constants/errorCodes');
const moduleUrl = pathToFileURL(path.join(__dirname, '../src/utils/apiErrors.mjs')).href;

const keysOf = (file) => {
  const source = fs.readFileSync(path.join(__dirname, '../src/translations', file), 'utf8');
  return new Set(Array.from(source.matchAll(/^ {2}([A-Za-z0-9_]+):/gm), (m) => m[1]));
};

test('every server error code is mapped and translated in both catalogs', async () => {
  const { API_ERROR_KEYS } = await import(moduleUrl);
  const de = keysOf('de.js');
  const en = keysOf('en.js');

  const unmapped = ALL_CODES.filter((code) => !API_ERROR_KEYS[code]);
  assert.deepEqual(unmapped, [], 'codes without a client mapping');

  const untranslated = Object.values(API_ERROR_KEYS).filter((key) => !de.has(key) || !en.has(key));
  assert.deepEqual([...new Set(untranslated)], [], 'mapped keys missing in a catalog');
});

test('the client mapping has no dead entries', async () => {
  const { API_ERROR_KEYS } = await import(moduleUrl);
  const known = new Set(ALL_CODES);

  const unknown = Object.entries(API_ERROR_KEYS)
    .filter(([code]) => !known.has(code))
    .map(([code]) => code);
  assert.deepEqual(unknown, [], 'client maps codes the server never sends');
});

test('resolveApiErrorMessage prefers the translation, then the server text', async () => {
  const { resolveApiErrorMessage } = await import(moduleUrl);
  const catalog = { errNoteNotFound: 'Note not found', errGeneric: 'Something went wrong' };
  const t = (key) => catalog[key] || key; // LanguageContext returns the key when missing

  assert.equal(
    resolveApiErrorMessage({ code: 'NOTE_NOT_FOUND', message: 'Notiz nicht gefunden' }, t),
    'Note not found',
    'the translated text wins over the German server message'
  );
  assert.equal(
    resolveApiErrorMessage({ code: 'SOMETHING_NEW', message: 'Server says hi' }, t),
    'Server says hi',
    'an unmapped code falls back to the server message'
  );
  assert.equal(
    resolveApiErrorMessage({ code: 'NOTE_NOT_FOUND', message: '' }, t),
    'Note not found'
  );
  assert.equal(
    resolveApiErrorMessage({ message: '' }, t),
    'Something went wrong',
    'without any information the generic key is used'
  );
  assert.equal(
    resolveApiErrorMessage({ code: 'NOTE_NOT_FOUND', message: 'Notiz nicht gefunden' }, undefined),
    'Notiz nicht gefunden',
    'without a translation function the server message is used'
  );
  assert.equal(
    resolveApiErrorMessage({ message: 'Failed to fetch' }, t),
    'Something went wrong',
    'browser network noise is replaced by the translated fallback'
  );
  assert.equal(
    resolveApiErrorMessage({ code: 'NOTE_NOT_FOUND' }, (key) => key),
    'Request failed',
    'a catalog without the key must never render the raw key'
  );
  assert.equal(
    resolveApiErrorMessage({ code: 'NOTE_NOT_FOUND', message: 'Notiz nicht gefunden' }, (key) => key),
    'Notiz nicht gefunden',
    'with an untranslated catalog the server message is kept'
  );
});

test('error call sites use the resolver instead of raw server messages', () => {
  const files = [
    'components/CollaborateModal.jsx',
    'components/AdminConsole.jsx',
    'components/Login.jsx',
    'components/Register.jsx',
    'components/Settings.jsx',
    'components/FriendsModal.jsx',
    'components/Setup.jsx',
    'components/NoteModal.jsx',
    'hooks/useNotesManager.js',
  ];

  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
    assert.match(source, /resolveApiErrorMessage/, `${file} should translate API errors`);
    assert.doesNotMatch(
      source,
      /(setError|showToast|toastBus\.error)\((err|error)\.message/,
      `${file} still surfaces a raw server message`
    );
  }
});

test('the server catalog covers the messages users actually hit', () => {
  const expected = [
    'Notiz nicht gefunden',
    'Ungültige Anmeldedaten',
    'Die Notiz wurde inzwischen geändert',
    'Notizen koennen nur mit Freunden geteilt werden',
    'Ungueltiges CSRF-Token',
    'Authentifizierung erforderlich',
    'Link ist nicht erreichbar',
    'Maximal 10 API-Keys pro Benutzer erlaubt',
    'Bereits Freunde',
    'Zugriff verweigert. Admin-Rechte erforderlich.',
  ];
  for (const message of expected) {
    assert.ok(MESSAGE_TO_CODE[message], `unmapped message: ${message}`);
  }
  assert.equal(STATUS_TO_CODE[502], 'UPSTREAM_ERROR');
});
