export const APP_CACHE_PREFIX = 'keeplocal-';
export const APP_PREFERENCE_KEYS = ['theme', 'keeplocal_settings', 'token'];

async function unregisterServiceWorkers(environment) {
  let serviceWorker;

  try {
    serviceWorker = environment?.navigator?.serviceWorker;
  } catch {
    return 0;
  }

  if (!serviceWorker || typeof serviceWorker.getRegistrations !== 'function') {
    return 0;
  }

  try {
    const registrations = await serviceWorker.getRegistrations();
    const results = await Promise.all(
      Array.from(registrations).map(async registration => {
        try {
          return await registration.unregister();
        } catch {
          return false;
        }
      })
    );

    return results.filter(Boolean).length;
  } catch {
    return 0;
  }
}

async function removeAppCaches(environment) {
  let cacheStorage;

  try {
    cacheStorage = environment?.caches;
  } catch {
    return 0;
  }

  if (
    !cacheStorage ||
    typeof cacheStorage.keys !== 'function' ||
    typeof cacheStorage.delete !== 'function'
  ) {
    return 0;
  }

  try {
    const cacheNames = await cacheStorage.keys();
    const appCacheNames = cacheNames.filter(cacheName => (
      typeof cacheName === 'string' && cacheName.startsWith(APP_CACHE_PREFIX)
    ));
    const results = await Promise.all(
      appCacheNames.map(async cacheName => {
        try {
          return await cacheStorage.delete(cacheName);
        } catch {
          return false;
        }
      })
    );

    return results.filter(Boolean).length;
  } catch {
    return 0;
  }
}

function removeAppPreferences(environment) {
  let storage;

  try {
    storage = environment?.localStorage;
  } catch {
    return 0;
  }

  if (!storage || typeof storage.removeItem !== 'function') return 0;

  let removedPreferences = 0;
  for (const key of APP_PREFERENCE_KEYS) {
    try {
      storage.removeItem(key);
      removedPreferences += 1;
    } catch {
      // Keep repairing the remaining app state when one key is blocked.
    }
  }

  return removedPreferences;
}

export async function repairAppState(environment = globalThis) {
  const [unregisteredWorkers, removedCaches] = await Promise.all([
    unregisterServiceWorkers(environment),
    removeAppCaches(environment)
  ]);
  const removedPreferences = removeAppPreferences(environment);

  return { unregisteredWorkers, removedCaches, removedPreferences };
}

export const repairAppCaches = repairAppState;
