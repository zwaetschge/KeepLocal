// Baut aus Status, Body und Headern den Fehler, den die UI übersetzen kann.
//
// Reines Modul (kein React, kein fetch), damit `node --test` die Logik wirklich
// ausführen kann — die `.js`/`.jsx`-Dateien im Client sind für Node nicht
// importierbar (kein `"type": "module"`), deshalb lagen genau diese Pfade bisher
// außerhalb jeder Testbarkeit.
//
// Hintergrund (Audit 2026-09-12, Top-30 Nr. 13): PR #105 hatte stabile
// Fehlercodes eingeführt und `resolveApiErrorMessage` übersetzt sie. Drei Pfade
// nahmen den Code wieder weg — die beiden Multipart-Calls (Bild-Upload,
// Transkription) warfen ein nacktes `new Error(serverText)`, und der 401-Pfad
// einen hartkodierten deutschen Satz. Ergebnis: deutsche Server-Sätze in der
// englischen UI, und ein 429 verlor sein `Retry-After`.

/**
 * @param {Object} options
 * @param {number} options.status HTTP-Status
 * @param {Object} [options.payload] geparster Response-Body (`{ error, code, ... }`)
 * @param {{get?: (name: string) => string|null}} [options.headers] Response-Headers (nur `Retry-After` wird gelesen)
 * @param {string} [options.fallbackMessage] Text, falls der Body weder `error` noch `code` hat
 * @returns {Error & {status: number, code?: string, data?: Object, retryAfter?: number}}
 */
export function buildHttpError({ status, payload = {}, headers = null, fallbackMessage = '' }) {
  // Antwort mit `code` aber ohne Text (z. B. die Offline-Antwort des Service
  // Workers) erzeugt bewusst keine Nachricht: Aufrufer fallen dann auf ihre
  // übersetzten `t(...)`-Meldungen zurück, statt einen rohen Server-String in
  // der falschen Sprache zu zeigen.
  const message = payload.error || (payload.code ? '' : (fallbackMessage || `HTTP ${status}`));
  const error = new Error(message);
  error.status = status;
  error.code = payload.code;
  error.data = payload;

  const retryAfter = Number(headers?.get?.('Retry-After'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    error.retryAfter = retryAfter;
  }
  return error;
}

/**
 * 401-Fehler: immer mit `code`, damit die UI übersetzt statt den deutschen
 * Fallback-Satz zu zeigen. Ein Server-`code` gewinnt.
 */
export function unauthorizedError({ payload = {}, headers = null, fallbackMessage = '' } = {}) {
  return buildHttpError({
    status: 401,
    payload: { code: 'AUTH_REQUIRED', ...payload, error: payload.error || fallbackMessage },
    headers
  });
}

const httpErrors = { buildHttpError, unauthorizedError };
export default httpErrors;
