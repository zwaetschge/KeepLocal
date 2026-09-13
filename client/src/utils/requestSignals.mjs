// AbortController + Timeout für API-Requests.
//
// Warum (Audit 2026-09-12, Top-30 Nr. 15): Kein einziger Request im Client war
// abbrechbar oder hatte ein Timeout (`rg AbortController client/src` → 0
// Treffer). `loading`/`refreshing` werden aber nur im `finally` des *neuesten*
// Requests geräumt — bleibt eine Verbindung halboffen stehen (stehende MongoDB,
// Mobilnetz, Proxy), hing die Liste dauerhaft auf `opacity: 0.6` + `aria-busy`
// bzw. im Skeleton, ohne Fehlermeldung und ohne Retry. Zusätzlich stapelte jeder
// Filterwechsel Requests, statt den alten abzulösen: hinter einem HTTP/1.1-Pfad
// blockieren die Leichen die sechs Verbindungen pro Origin, und die einzig
// relevante Antwort kommt zuletzt.
//
// Reines Modul (kein React, kein fetch), damit `node --test` die Logik wirklich
// ausführen kann.

/** Standard-Timeout für JSON-Requests. */
export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

/**
 * Uploads und Transkription dauern legitimately länger; nginx bricht bei
 * `proxy_read_timeout 300s` ab, der axios-Call zum AI-Dienst bei 300 s — das
 * Client-Timeout muss dahinter liegen, sonst meldet die App einen Abbruch,
 * während der Server noch arbeitet.
 */
export const LONG_REQUEST_TIMEOUT_MS = 330_000;

/**
 * Verbindet ein Timeout mit einem optional externen Signal (z. B. „Filter
 * gewechselt" oder „Komponente entmountet").
 *
 * @param {Object} [options]
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal|null} [options.signal] externes Signal
 * @returns {{signal: AbortSignal, cleanup: () => void, timedOut: () => boolean, abort: (reason?: string) => void}}
 */
export function createRequestSignal({ timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, signal = null } = {}) {
  const controller = new AbortController();
  let timedOutFlag = false;

  const timer = setTimeout(() => {
    timedOutFlag = true;
    controller.abort('REQUEST_TIMEOUT');
  }, timeoutMs);

  const onExternalAbort = () => controller.abort(signal?.reason || 'ABORTED');
  if (signal) {
    if (signal.aborted) controller.abort(signal.reason || 'ABORTED');
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOutFlag,
    abort: (reason = 'ABORTED') => controller.abort(reason),
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onExternalAbort);
    }
  };
}

/**
 * Unterscheidet „von uns abgebrochen/Timeout" von echten Fehlern. Ein
 * ersetzter Request darf keinen Fehler-Toast auslösen.
 */
export function isAbortError(error) {
  if (!error) return false;
  if (error.code === 'ABORTED') return true;
  if (error.name === 'AbortError') return true;
  return typeof error.message === 'string' && /aborted|abort signal/i.test(error.message);
}

/** Transport-Code für einen abgebrochenen Request (Timeout vs. bewusst ersetzt). */
export function abortCode(error, { timedOut = false } = {}) {
  if (timedOut) return 'REQUEST_TIMEOUT';
  if (error?.code === 'REQUEST_TIMEOUT') return 'REQUEST_TIMEOUT';
  return 'ABORTED';
}

const requestSignals = {
  DEFAULT_REQUEST_TIMEOUT_MS,
  LONG_REQUEST_TIMEOUT_MS,
  createRequestSignal,
  isAbortError,
  abortCode
};
export default requestSignals;
