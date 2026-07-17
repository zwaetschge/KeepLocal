const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/browserEnvironment.mjs')
).href;

test('browser environment applies supported themes without trusting DOM methods', async () => {
  const { applyThemeToDocument } = await import(moduleUrl);
  const calls = [];
  const documentObject = {
    body: {
      classList: {
        remove(...themes) {
          calls.push(['remove', ...themes]);
        },
        add(theme) {
          calls.push(['add', theme]);
        }
      }
    }
  };

  assert.equal(applyThemeToDocument('doodle', documentObject), true);
  assert.deepEqual(calls, [
    ['remove', 'dark-mode', 'oled-mode', 'eink-mode', 'doodle-mode'],
    ['add', 'doodle-mode']
  ]);
  assert.equal(applyThemeToDocument('unknown', documentObject), true);
  assert.equal(applyThemeToDocument('dark', { body: {} }), false);
});

test('browser environment tolerates blocked location and event APIs', async () => {
  const { getBrowserPathname, subscribeToWindowEvent } = await import(moduleUrl);
  const windowObject = {};

  Object.defineProperty(windowObject, 'location', {
    get() {
      throw new DOMException('Blocked', 'SecurityError');
    }
  });
  Object.defineProperty(windowObject, 'addEventListener', {
    get() {
      throw new TypeError('addEventListener is unavailable');
    }
  });

  assert.equal(getBrowserPathname(windowObject), '/');
  const cleanup = subscribeToWindowEvent('keydown', () => {}, windowObject);
  assert.equal(typeof cleanup, 'function');
  assert.doesNotThrow(cleanup);
});
