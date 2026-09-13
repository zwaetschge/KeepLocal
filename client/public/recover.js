(() => {
  'use strict';

  const APP_CACHE_PREFIX = 'keeplocal-';
  const APP_PREFERENCE_KEYS = ['theme', 'keeplocal_settings', 'keeplocal_language', 'token'];
  const AUTO_REPAIR_FLAG = 'keeplocal-recover-autorepaired';

  const status = document.querySelector('.recovery-status');
  const statusMark = document.getElementById('recovery-status-mark');
  const statusTitle = document.getElementById('recovery-status-title');
  const statusDetail = document.getElementById('recovery-status-detail');
  const retryButton = document.getElementById('recovery-retry');
  const openLink = document.getElementById('recovery-open');
  let running = false;

  // This page is React-independent, so it translates itself. The static markup
  // stays German (server-rendered fallback without JS); with JS available the
  // browser language decides.
  const MESSAGES = {
    de: {
      kicker: 'KeepLocal · Reparatur',
      title: 'Web-App wird sicher aktualisiert',
      intro: 'Alte App-Dateien und lokale Anzeigeoptionen werden entfernt. Danach öffnet sich automatisch die aktuelle Version.',
      assuranceStrong: 'Konto und Notizen bleiben erhalten.',
      assuranceSpan: 'Serverdaten, Passwort und Sitzungscookie werden nicht verändert.',
      readyTitle: 'Bereit',
      readyDetail: 'Eine automatische Reparatur hat in diesem Tab bereits stattgefunden. Starte die Reparatur erneut oder öffne die App direkt.',
      runningTitle: 'Reparatur läuft …',
      runningDetail: 'Service Worker und KeepLocal-Cache werden geprüft.',
      doneTitle: 'Aktualisierung abgeschlossen',
      doneDetail: 'Die aktuelle KeepLocal-Version wird geöffnet.',
      blockedTitle: 'Automatisches Öffnen wurde blockiert',
      blockedDetail: 'Bitte wähle „App jetzt öffnen“.',
      retry: 'Erneut versuchen',
      open: 'App jetzt öffnen',
    },
    en: {
      kicker: 'KeepLocal · Recovery',
      title: 'Refreshing the web app safely',
      intro: 'Stale app files and local display options are removed. The current version then opens automatically.',
      assuranceStrong: 'Your account and notes are kept.',
      assuranceSpan: 'Server data, password and session cookie are not touched.',
      readyTitle: 'Ready',
      readyDetail: 'An automatic repair already ran in this tab. Run it again or open the app directly.',
      runningTitle: 'Repairing …',
      runningDetail: 'Checking the service worker and the KeepLocal cache.',
      doneTitle: 'Update complete',
      doneDetail: 'Opening the current KeepLocal version.',
      blockedTitle: 'Automatic opening was blocked',
      blockedDetail: 'Please choose “Open app now”.',
      retry: 'Try again',
      open: 'Open app now',
    },
  };

  function resolveMessages() {
    let language = 'de';
    try {
      language = String(window.navigator?.language || 'de').slice(0, 2).toLowerCase() === 'de' ? 'de' : 'en';
    } catch {
      language = 'de';
    }
    return { language, text: MESSAGES[language] || MESSAGES.de };
  }

  const resolved = resolveMessages();
  const M = resolved.text;

  function applyMessages() {
    try {
      document.documentElement.lang = resolved.language;
      const set = (id, value) => {
        const el = document.getElementById(id);
        if (el && value) el.textContent = value;
      };
      set('recovery-kicker', M.kicker);
      set('recovery-title', M.title);
      set('recovery-intro', M.intro);
      set('recovery-assurance-strong', M.assuranceStrong);
      set('recovery-assurance-span', M.assuranceSpan);
      if (retryButton) retryButton.textContent = M.retry;
      if (openLink) openLink.textContent = M.open;
      if (document.title && resolved.language === 'en') document.title = 'Refresh KeepLocal safely';
    } catch {
      // Text stays in the server-rendered language; the repair still works.
    }
  }

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

  /**
   * @param {{resetPreferences?: boolean}} [options] The automatic pass only
   *   clears service worker and caches; wiping theme/settings happens on an
   *   explicit click, so an unnoticed background redirect cannot silently
   *   reset the user's preferences.
   */
  async function repair(options = {}) {
    if (running) return;
    running = true;
    retryButton.hidden = true;
    setStatus('', M.runningTitle, M.runningDetail);

    if (options.resetPreferences) {
      removeAppPreferences();
    }
    await Promise.race([
      Promise.allSettled([unregisterWorkers(), removeAppCaches()]),
      wait(4000)
    ]);

    const appUrl = currentAppUrl();
    openLink.href = appUrl;
    setStatus('is-complete', M.doneTitle, M.doneDetail);
    await wait(450);

    try {
      window.location.replace(appUrl);
    } catch {
      running = false;
      retryButton.hidden = false;
      setStatus('is-error', M.blockedTitle, M.blockedDetail);
    }
  }

  function autoRepairAllowed() {
    try {
      const params = new URLSearchParams(window.location.search);
      // Only the startup guard may trigger an unattended repair, and only once
      // per tab session: a broken deploy would otherwise loop forever between
      // the blank app and this page.
      if (params.get('from') !== 'guard') return false;
      if (params.get('auto') === '0') return false;
      return window.sessionStorage.getItem(AUTO_REPAIR_FLAG) !== '1';
    } catch {
      return false;
    }
  }

  function markAutoRepair() {
    try {
      window.sessionStorage.setItem(AUTO_REPAIR_FLAG, '1');
    } catch {
      // Without storage the guard's auto=0 handoff still stops the loop.
    }
  }

  if (typeof retryButton?.addEventListener === 'function') {
    retryButton.addEventListener('click', () => repair({ resetPreferences: true }));
  }

  applyMessages();

  if (autoRepairAllowed()) {
    markAutoRepair();
    repair({ resetPreferences: false });
  } else {
    // Show the page and wait for an explicit choice instead of bouncing the
    // browser back to an app that is still broken.
    setStatus('', M.readyTitle, M.readyDetail);
    if (retryButton) retryButton.hidden = false;
  }
})();
