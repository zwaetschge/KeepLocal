// Account-Preference-Push: debounced, mit Flush bei pagehide und ehrlichem
// Fehler-Verhalten. Framework-frei gehalten, damit die Semantik ohne React
// getestet werden kann (tests/accountPreferences.test.js).
//
// Audit 2026-09-12 (Top-30 Nr. 17): der Push markierte den Zustand VOR dem
// Request als synchronisiert — schlug das PUT fehl (offline, CSRF-Wechsel,
// 5xx), galt die Änderung trotzdem als gespeichert. Kein Retry, keine Meldung,
// und beim nächsten Login kippte Theme/AI-Flag still zurück. Jetzt:
//   - `synced` wird erst nach erfolgreicher Antwort gesetzt,
//   - im Fehlerfall bleibt der alte Wert stehen (der nächste Effect-Durchlauf
//     retryt automatisch) und der Nutzer bekommt einmalig eine Warnung,
//   - ein pending Debounce wird bei pagehide sofort geflusht — sonst kostet
//     „Toggle setzen und Tab schließen" die Änderung.

export const PUSH_DEBOUNCE_MS = 600;

/**
 * @param {Object} options
 * @param {(settings: Object) => Promise} options.push - der eigentliche PUT
 * @param {() => void} [options.warn] - Nutzer-Warnung, maximal einmal pro
 *   fehlgeschlagenem Senden; nach einem Erfolg wieder scharf
 * @param {number} [options.debounceMs]
 * @param {Object} [options.eventTarget] - injizierbar für Tests (default window)
 */
export function createPreferenceSync({ push, warn, debounceMs = PUSH_DEBOUNCE_MS, eventTarget }) {
  let syncedPayload = null;   // letzter vom Server bestätigter Zustand
  let pending = null;         // { payload, settings } — wartet auf den Timer
  let timer = null;
  let sending = null;         // payload des laufenden Requests
  let warnArmed = true;
  let disposed = false;

  const target = eventTarget ?? (typeof window !== 'undefined' ? window : null);

  const send = async ({ payload, settings }) => {
    sending = payload;
    // Echo-Schutz: wurde während des Fluges ein neuerer Server-Stand adoptiert
    // (adopt() setzt syncedPayload), gewinnt der — ein älteres Success würde
    // ihn sonst zurückrollen und einen Phantom-Diff auslösen.
    const syncedBefore = syncedPayload;
    try {
      await push(settings);
      if (!disposed && syncedPayload === syncedBefore) {
        syncedPayload = payload;
      }
      warnArmed = true;
    } catch (error) {
      if (disposed) return;
      // syncedPayload bleibt beim alten Wert: der nächste Effect-Durchlauf
      // sieht weiterhin einen Diff und sendet wieder.
      if (warnArmed && typeof warn === 'function') {
        warnArmed = false;
        try {
          warn();
        } catch {
          /* Eine scheiternde Warnung darf den Flow nicht brechen. */
        }
      }
      // Absichtliches console.error statt logger: Kontext-Code, kein Request.
      console.error('Could not store preferences on the account:', error?.message);
    } finally {
      if (sending === payload) sending = null;
    }
  };

  const flush = () => {
    if (!pending) return;
    const current = pending;
    pending = null;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    send(current);
  };

  const onHide = () => flush();

  if (target && typeof target.addEventListener === 'function') {
    target.addEventListener('pagehide', onHide);
  }

  return {
    /** Server-Stand übernehmen (nach /me, Logout-Reset oder bestätigtem Push). */
    adopt(payload) {
      syncedPayload = payload;
      // Hat der Server den pending-Stand bereits, ist der Push überflüssig.
      if (pending && pending.payload === payload) {
        pending = null;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      }
    },
    /** Lokale Änderung: kein-op, wenn der Server den Stand schon hat. */
    schedule(payload, settings) {
      if (disposed) return;
      if (payload === syncedPayload || payload === sending) return;
      pending = { payload, settings };
      if (timer === null) {
        timer = setTimeout(flush, debounceMs);
      }
    },
    /** Pending-Timer abbrechen, ohne zu senden (Logout). */
    cancel() {
      pending = null;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    },
    /** Listener und Timer auflösen (Unmount des Providers). */
    dispose() {
      disposed = true;
      this.cancel();
      if (target && typeof target.removeEventListener === 'function') {
        target.removeEventListener('pagehide', onHide);
      }
    },
    /** Nur für Tests/Debug: der letzte bestätigte Stand. */
    get synced() {
      return syncedPayload;
    },
    /** Nur für Tests/Debug: ob gerade ein Senden läuft. */
    get inFlight() {
      return sending !== null;
    }
  };
}
