const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/browserLanguage.mjs')
).href;

test('browser language resolves a supported locale', async () => {
  const { resolveBrowserLanguage } = await import(moduleUrl);

  assert.equal(
    resolveBrowserLanguage({ language: 'EN-us' }, { de: {}, en: {} }, 'de'),
    'en'
  );
});

test('browser language falls back when language access is blocked', async () => {
  const { resolveBrowserLanguage } = await import(moduleUrl);
  const navigatorObject = {};
  Object.defineProperty(navigatorObject, 'language', {
    get() {
      throw new DOMException('Language access blocked', 'SecurityError');
    }
  });

  assert.equal(
    resolveBrowserLanguage(navigatorObject, { de: {}, en: {} }, 'de'),
    'de'
  );
});

test('browser language falls back for missing and unsupported values', async () => {
  const { resolveBrowserLanguage } = await import(moduleUrl);
  const languages = { de: {}, en: {} };

  assert.equal(resolveBrowserLanguage({}, languages, 'de'), 'de');
  assert.equal(resolveBrowserLanguage({ language: 'fr-FR' }, languages, 'de'), 'de');
});
