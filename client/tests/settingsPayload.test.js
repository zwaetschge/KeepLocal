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
    transcriptionLanguage: 'de'
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
  assert.deepEqual(settings, {
    theme: 'dark',
    aiFeatures: { voiceTranscription: true },
    transcriptionLanguage: 'fr'
  });

  assert.deepEqual(preferencesFromSettings(settings), {
    theme: 'dark',
    aiFeatures: { voiceTranscription: true },
    transcriptionLanguage: 'fr'
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
