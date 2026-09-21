const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

// Audit 2026-09-12 (Top-30 Nr. 13): PR #105 hatte stabile Fehlercodes und
// `resolveApiErrorMessage` eingeführt — aber drei Client-Pfade nahmen den Code
// wieder weg. Beide Multipart-Calls (Bild-Upload, Transkription) warfen ein
// nacktes `new Error(serverText)`, der 401-Pfad einen hartkodierten deutschen
// Satz. Folge: deutsche Server-Sätze in englischer UI, und ein 429 verlor sein
// `Retry-After` samt der Aufnahme.

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');
const httpErrorsUrl = pathToFileURL(path.join(__dirname, '../src/utils/httpErrors.mjs')).href;
const apiErrorsUrl = pathToFileURL(path.join(__dirname, '../src/utils/apiErrors.mjs')).href;

const headers = (map) => ({ get: (name) => map[name.toLowerCase()] ?? null });

test('a 429 keeps its code, status and Retry-After', async () => {
  const { buildHttpError } = await import(httpErrorsUrl);

  const error = buildHttpError({
    status: 429,
    payload: { code: 'TRANSCRIPTION_BUSY', error: 'Der Transkriptionsdienst ist gerade ausgelastet.' },
    headers: headers({ 'retry-after': '30' })
  });

  assert.equal(error.code, 'TRANSCRIPTION_BUSY');
  assert.equal(error.status, 429);
  assert.equal(error.retryAfter, 30);
  assert.equal(error.data.code, 'TRANSCRIPTION_BUSY');
  assert.ok(error instanceof Error);
});

test('a code without server text stays translatable instead of leaking prose', async () => {
  const { buildHttpError } = await import(httpErrorsUrl);
  const { resolveApiErrorMessage, API_ERROR_KEYS } = await import(apiErrorsUrl);

  const error = buildHttpError({
    status: 400,
    payload: { code: 'IMAGE_LIMIT_REACHED' },
    headers: headers({})
  });

  assert.equal(error.message, '', 'no raw server string when a code exists');
  assert.equal(error.code, 'IMAGE_LIMIT_REACHED');
  assert.equal(error.retryAfter, undefined, 'no Retry-After header means no retry hint');

  // Die Übersetzungskette muss den Code kennen (sonst fällt die UI auf den
  // Fallback-Key zurück).
  assert.equal(API_ERROR_KEYS.IMAGE_LIMIT_REACHED, 'errImageLimitReached');
  const translated = resolveApiErrorMessage(error, (key) => (key === 'errImageLimitReached' ? 'At most 25 images.' : key));
  assert.equal(translated, 'At most 25 images.');
});

test('an empty body falls back to the caller message, not to a bare status', async () => {
  const { buildHttpError } = await import(httpErrorsUrl);

  const withFallback = buildHttpError({ status: 500, payload: {}, fallbackMessage: 'Bild-Upload fehlgeschlagen' });
  assert.equal(withFallback.message, 'Bild-Upload fehlgeschlagen');
  assert.equal(withFallback.status, 500);

  const withoutFallback = buildHttpError({ status: 502, payload: {} });
  assert.equal(withoutFallback.message, 'HTTP 502');
});

test('401 always carries a code so the UI translates it', async () => {
  const { unauthorizedError } = await import(httpErrorsUrl);
  const { resolveApiErrorMessage, API_ERROR_KEYS } = await import(apiErrorsUrl);

  const plain = unauthorizedError({ payload: {}, fallbackMessage: 'Nicht autorisiert' });
  assert.equal(plain.status, 401);
  assert.equal(plain.code, 'AUTH_REQUIRED');
  assert.equal(plain.message, 'Nicht autorisiert', 'the prose stays as a fallback for older servers');
  assert.equal(API_ERROR_KEYS.AUTH_REQUIRED, 'errAuthRequired');
  assert.equal(
    resolveApiErrorMessage(plain, (key) => (key === 'errAuthRequired' ? 'Please sign in again.' : key)),
    'Please sign in again.'
  );

  // Ein Server-Code gewinnt vor dem Default.
  const specific = unauthorizedError({ payload: { code: 'SESSION_EXPIRED', error: 'Sitzung abgelaufen' } });
  assert.equal(specific.code, 'SESSION_EXPIRED');
  assert.equal(specific.message, 'Sitzung abgelaufen');
});

test('both multipart calls and the 401 path use the shared error builder', () => {
  const apiUtils = read('services', 'api', 'apiUtils.js');
  const notesAPI = read('services', 'api', 'notesAPI.js');

  assert.match(apiUtils, /import \{ buildHttpError, unauthorizedError \} from '\.\.\/\.\.\/utils\/httpErrors\.mjs';/);
  assert.match(apiUtils, /export async function toHttpError\(response, fallbackMessage\)/);
  assert.match(apiUtils, /throw unauthorizedError\(\{ payload, headers: response\.headers, fallbackMessage: ERROR_MESSAGES\.UNAUTHORIZED \}\);/);
  assert.doesNotMatch(apiUtils, /const error = new Error\(ERROR_MESSAGES\.UNAUTHORIZED\);/, 'the hardcoded 401 must be gone');

  assert.match(notesAPI, /import \{[^}]*toHttpError[^}]*\} from '\.\/apiUtils';/);
  // Beide Multipart-Pfade laufen über denselben Helper: toHttpError (code,
  // status, retryAfter) plus Abort/Timeout mit dem langen Limit.
  assert.match(notesAPI, /async function fetchMultipart\(url, formData, fallbackMessage\)/);
  assert.match(notesAPI, /throw await toHttpError\(response, fallbackMessage\);/);
  assert.match(notesAPI, /LONG_REQUEST_TIMEOUT_MS/);
  assert.equal(notesAPI.match(/return fetchMultipart\(/g)?.length, 3, 'image upload, file upload and transcription all use it');
  assert.match(notesAPI, /'Bild-Upload fehlgeschlagen'/);
  assert.match(notesAPI, /'Datei-Upload fehlgeschlagen'/);
  assert.match(notesAPI, /'Transkription fehlgeschlagen'/);
  assert.doesNotMatch(notesAPI, /throw new Error\(errorData\.error \|\|/, 'no multipart path may drop the code');
});

test('a busy transcription keeps the recording and offers a retry', () => {
  const modal = read('components', 'NoteModal.jsx');

  assert.match(modal, /const lastAudioBlobRef = useRef\(null\);/);
  assert.match(modal, /lastAudioBlobRef\.current = audioBlob;/, 'the recording is kept after the automatic transcription');
  assert.match(modal, /error\?\.code === 'TRANSCRIPTION_BUSY' && lastAudioBlobRef\.current/);
  assert.match(modal, /t\('transcriptionBusyRetry', \{ seconds \}\)/);
  assert.match(modal, /action: \{ label: t\('retryTranscription'\), onClick: \(\) => handleTranscribe\(blob\) \}/);
  assert.match(modal, /Number\.isFinite\(error\?\.retryAfter\) \? error\.retryAfter : 30/, 'Retry-After drives the hint');
  assert.match(modal, /lastAudioBlobRef\.current = null;/, 'the blob is released on unmount');

  for (const file of ['de.js', 'en.js']) {
    const translations = read('translations', file);
    assert.match(translations, /transcriptionBusyRetry: '[^']*\{seconds\}/, `${file} interpolates the wait time`);
    assert.match(translations, /retryTranscription:/, `${file} labels the retry action`);
  }
});
