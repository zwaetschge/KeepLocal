(() => {
  'use strict';

  const APP_CACHE_PREFIX = 'keeplocal-';
  const APP_PREFERENCE_KEYS = ['theme', 'keeplocal_settings', 'token'];
  const status = document.querySelector('.recovery-status');
  const statusMark = document.getElementById('recovery-status-mark');
  const statusTitle = document.getElementById('recovery-status-title');
  const statusDetail = document.getElementById('recovery-status-detail');
  const retryButton = document.getElementById('recovery-retry');
  const openLink = document.getElementById('recovery-open');
  let running = false;

  function wait(milliseconds) {
    return new Promise(resolve => window.setTimeout(resolve, milliseconds));
  }

  function setStatus(state, title, detail) {
    if (status) status.className = `recovery-status${state ? ` ${state}` : ''}`;
    if (statusMark) statusMark.textContent = state === 'is-complete' ? '✓' : state === 'is-error' ? '!' : '↻';
    if (statusTitle) statusTitle.textContent = title;
    if (statusDetail) statusDetail.textContent = detail;
  }

  async function unregisterWorkers() {
    try {
      const serviceWorker = navigator.serviceWorker;
      if (!serviceWorker || typeof serviceWorker.getRegistrations !== 'function') return;
      const registrations = await serviceWorker.getRegistrations();
      await Promise.allSettled(
        Array.from(registrations).map(registration => registration.unregister())
      );
    } catch {
      // Continue with cache and preference cleanup when this API is blocked.
    }
  }

  async function removeAppCaches() {
    try {
      const cacheStorage = window.caches;
      if (!cacheStorage || typeof cacheStorage.keys !== 'function') return;
      const cacheNames = await cacheStorage.keys();
      await Promise.allSettled(
        cacheNames
          .filter(cacheName => typeof cacheName === 'string' && cacheName.startsWith(APP_CACHE_PREFIX))
          .map(cacheName => cacheStorage.delete(cacheName))
      );
    } catch {
      // A network reload can still recover when Cache Storage is blocked.
    }
  }

  function removeAppPreferences() {
    try {
      const storage = window.localStorage;
      if (!storage || typeof storage.removeItem !== 'function') return;
      for (const key of APP_PREFERENCE_KEYS) {
        try {
          storage.removeItem(key);
        } catch {
          // Keep removing the remaining KeepLocal-only preferences.
        }
      }
    } catch {
      // The current app tolerates unavailable local storage after redirect.
    }
  }

  function currentAppUrl() {
    const nonce = Date.now().toString(36);
    try {
      const url = new URL('/', window.location.origin);
      url.searchParams.set('app-repair', nonce);
      return url.toString();
    } catch {
      return `/?app-repair=${nonce}`;
    }
  }

  async function repair() {
    if (running) return;
    running = true;
    retryButton.hidden = true;
    setStatus('', 'Reparatur läuft …', 'Service Worker und KeepLocal-Cache werden geprüft.');

    removeAppPreferences();
    await Promise.race([
      Promise.allSettled([unregisterWorkers(), removeAppCaches()]),
      wait(4000)
    ]);

    const appUrl = currentAppUrl();
    openLink.href = appUrl;
    setStatus('is-complete', 'Aktualisierung abgeschlossen', 'Die aktuelle KeepLocal-Version wird geöffnet.');
    await wait(450);

    try {
      window.location.replace(appUrl);
    } catch {
      running = false;
      retryButton.hidden = false;
      setStatus('is-error', 'Automatisches Öffnen wurde blockiert', 'Bitte wählen Sie „App jetzt öffnen“.');
    }
  }

  if (typeof retryButton?.addEventListener === 'function') {
    retryButton.addEventListener('click', repair);
  }
  repair();
})();
