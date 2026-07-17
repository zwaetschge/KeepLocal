function resolveLocalStorage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function readLocalStorage(key, fallback = null, storage = resolveLocalStorage()) {
  if (!storage) return fallback;

  try {
    const value = storage.getItem(key);
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

export function writeLocalStorage(key, value, storage = resolveLocalStorage()) {
  if (!storage) return false;

  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeLocalStorage(key, storage = resolveLocalStorage()) {
  if (!storage) return false;

  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
