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
    aiFeatures: { voiceTranscription: true },
    transcriptionLanguage: 'de'
  };

  assert.deepEqual(normalizeSettings(settings), settings);
});
