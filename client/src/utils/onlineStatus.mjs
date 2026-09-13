// Verbindungsstatus und Netzwerk-Fehlererkennung.
//
// Warum (Audit 2026-09-12, Top-30 Nr. 14): Offline war der sichtbarste Zustand
// einer „lokale Notizen"-App und komplett stumm. Der 60-s-Poll feuerte offline
// weiter mit `silent: true`, ein fehlgeschlagenes Speichern zeigte nur
// „Error updating note" — der Nutzer erfuhr weder, dass die Verbindung das
// Problem ist, noch dass seine Änderung NICHT gespeichert wurde. Und
// `resolveApiErrorMessage` warf die Signatur `Failed to fetch` ausdrücklich weg.
//
// Reines Modul (kein React), injizierbare Ziel-Objekte für `node --test`.

/** Browser-Signaturen für „kein Netzwerk" (Chrome, Firefox, Safari, Node/undici). */
export const NETWORK_ERROR_SIGNATURES = [
  'Failed to fetch',
  'NetworkError when attempting to fetch resource',
  'Load failed',
  'fetch failed',
  'network request failed'
];

export function isNetworkErrorMessage(message) {
  if (typeof message !== 'string' || !message) return false;
  const normalized = message.toLowerCase();
  return NETWORK_ERROR_SIGNATURES.some(signature => normalized.includes(signature.toLowerCase()));
}

/** `navigator.onLine` ist in manchen Umgebungen undefined — dann: optimistisch. */
export function isOnlineNow(navigatorLike = globalThis.navigator) {
  return navigatorLike?.onLine !== false;
}

/**
 * Kleiner Tracker über `online`/`offline`. `subscribe` liefert den Status bei
 * jedem Wechsel und gibt die Unsubscribe-Funktion zurück.
 */
export function createOnlineTracker({ target = globalThis, navigator: navigatorLike = globalThis.navigator } = {}) {
  const listeners = new Set();
  let online = isOnlineNow(navigatorLike);

  const onChange = () => {
    const next = isOnlineNow(navigatorLike);
    if (next === online) return;
    online = next;
    for (const listener of listeners) listener(online);
  };

  const attached = Boolean(target?.addEventListener);
  if (attached) {
    target.addEventListener('online', onChange);
    target.addEventListener('offline', onChange);
  }

  return {
    isOnline: () => online,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Nur für Tests: Statuswechsel ohne echtes Event simulieren. */
    recheck: onChange,
    destroy() {
      listeners.clear();
      if (attached) {
        target.removeEventListener('online', onChange);
        target.removeEventListener('offline', onChange);
      }
    }
  };
}

const onlineStatus = { NETWORK_ERROR_SIGNATURES, isNetworkErrorMessage, isOnlineNow, createOnlineTracker };
export default onlineStatus;
