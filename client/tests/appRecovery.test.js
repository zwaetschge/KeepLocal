const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(
  path.join(__dirname, '../src/utils/appRecovery.mjs')
).href;

test('app recovery unregisters workers and resets only KeepLocal browser state', async () => {
  const { repairAppState } = await import(moduleUrl);
  const calls = [];
  const environment = {
    navigator: {
      serviceWorker: {
        async getRegistrations() {
          return [
            { async unregister() { calls.push('worker-1'); return true; } },
            { async unregister() { calls.push('worker-2'); return false; } }
          ];
        }
      }
    },
    caches: {
      async keys() {
        return ['keeplocal-v4', 'keeplocal-v5', 'another-app'];
      },
      async delete(cacheName) {
        calls.push(cacheName);
        return true;
      }
    },
    localStorage: {
      removeItem(key) {
        calls.push(`preference:${key}`);
      }
    }
  };

  const result = await repairAppState(environment);

  assert.deepEqual(result, {
    unregisteredWorkers: 1,
    removedCaches: 2,
    removedPreferences: 3
  });
  assert.deepEqual(
    calls.sort(),
    [
      'keeplocal-v4',
      'keeplocal-v5',
      'preference:keeplocal_settings',
      'preference:theme',
      'preference:token',
      'worker-1',
      'worker-2'
    ].sort()
  );
});

test('app recovery remains usable when browser APIs are blocked', async () => {
  const { repairAppState } = await import(moduleUrl);
  const environment = {};

  Object.defineProperty(environment, 'navigator', {
    get() {
      throw new DOMException('Blocked', 'SecurityError');
    }
  });
  Object.defineProperty(environment, 'caches', {
    get() {
      throw new DOMException('Blocked', 'SecurityError');
    }
  });
  Object.defineProperty(environment, 'localStorage', {
    get() {
      throw new DOMException('Blocked', 'SecurityError');
    }
  });

  await assert.doesNotReject(async () => {
    assert.deepEqual(
      await repairAppState(environment),
      { unregisteredWorkers: 0, removedCaches: 0, removedPreferences: 0 }
    );
  });
});
