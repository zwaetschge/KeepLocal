const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, '../src/utils/localStorage.mjs'),
).href;

test('local storage helpers preserve values when storage is available', async () => {
  const { readLocalStorage, removeLocalStorage, writeLocalStorage } = await import(moduleUrl);
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };

  assert.equal(readLocalStorage('theme', 'light', storage), 'light');
  assert.equal(writeLocalStorage('theme', 'doodle', storage), true);
  assert.equal(readLocalStorage('theme', 'light', storage), 'doodle');
  assert.equal(removeLocalStorage('theme', storage), true);
  assert.equal(readLocalStorage('theme', 'light', storage), 'light');
});

test('local storage helpers fail safely when browser storage methods throw', async () => {
  const { readLocalStorage, removeLocalStorage, writeLocalStorage } = await import(moduleUrl);
  const blockedStorage = {
    getItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    setItem: () => { throw new DOMException('blocked', 'SecurityError'); },
    removeItem: () => { throw new DOMException('blocked', 'SecurityError'); },
  };

  assert.equal(readLocalStorage('theme', 'light', blockedStorage), 'light');
  assert.equal(writeLocalStorage('theme', 'dark', blockedStorage), false);
  assert.equal(removeLocalStorage('token', blockedStorage), false);
});

test('local storage helpers fail safely when the browser blocks the storage getter', async () => {
  const { readLocalStorage, removeLocalStorage, writeLocalStorage } = await import(moduleUrl);
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('blocked', 'SecurityError');
    },
  });

  try {
    assert.equal(readLocalStorage('theme', 'light'), 'light');
    assert.equal(writeLocalStorage('theme', 'dark'), false);
    assert.equal(removeLocalStorage('token'), false);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    } else {
      delete globalThis.localStorage;
    }
  }
});
