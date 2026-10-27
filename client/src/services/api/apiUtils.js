import { API_BASE_URL, API_ENDPOINTS, CSRF_METHODS, ERROR_MESSAGES } from '../../constants/api';
import { buildHttpError, unauthorizedError } from '../../utils/httpErrors.mjs';
import { createRequestSignal, isAbortError } from '../../utils/requestSignals.mjs';

// Re-export API_BASE_URL for use in other API modules
export { API_BASE_URL };

// Store CSRF token in memory (not in cookie!)
let csrfToken = null;
let csrfInitialization = null;

// Session-Expiry (P16): Name des globalen Events, das bei einem 401 gefeuert
// wird. Der AuthContext hört darauf und loggt den Nutzer mit Hinweis aus.
export const UNAUTHORIZED_EVENT = 'keeplocal:unauthorized';
// Throttle: nicht jeder parallele Request soll ein Event feuern (30s-Fenster).
const UNAUTHORIZED_EVENT_THROTTLE_MS = 30000;
let lastUnauthorizedEventAt = 0;

function notifyUnauthorizedOncePerWindow(endpoint) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') {
    return false;
  }
  const now = Date.now();
  if (now - lastUnauthorizedEventAt < UNAUTHORIZED_EVENT_THROTTLE_MS) {
    return false;
  }
  lastUnauthorizedEventAt = now;
  window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { endpoint } }));
  return true;
}

/**
 * HTTP-Fehler mit Status und geparstem Body anreichern, damit Aufrufer
 * gezielt reagieren können (z.B. 409 { error, currentNote } in NoteModal/B2).
 * Die Logik liegt in utils/httpErrors.mjs, damit sie testbar ist.
 */
function createHttpError(payload, status) {
  return buildHttpError({ status, payload });
}

/**
 * Fehler aus einer rohen Response bauen — mit `code`, `status`, `data` und
 * `Retry-After`.
 *
 * Warum exportiert: Multipart-Pfade nutzen den rohen CSRF-Transport, weil
 * FormData keinen JSON-Wrapper verträgt. Sie warfen
 * ein nacktes `new Error(serverText)`: `resolveApiErrorMessage` sah kein `code`
 * und toastete den deutschen Server-Satz in der englischen UI — obwohl
 * `errTranscriptionBusy`, `errImageLimitReached` und `errAiUnavailable` längst
 * übersetzt sind. Ohne `status`/`retryAfter` war außerdem kein „erneut
 * versuchen in 30 s" möglich, und die Aufnahme war verloren.
 *
 * @param {Response} response
 * @param {string} [fallbackMessage] nur verwendet, wenn der Body weder Text noch Code hat
 */
export async function toHttpError(response, fallbackMessage) {
  const payload = await parseResponse(response);
  return buildHttpError({ status: response.status, payload, headers: response.headers, fallbackMessage });
}

/**
 * Get CSRF token from memory
 * @returns {string|null} The current CSRF token
 */
export function getCsrfToken() {
  return csrfToken;
}

/**
 * Set CSRF token
 * @param {string} token - The CSRF token to store
 */
export function setCsrfToken(token) {
  csrfToken = token;
}

/** Cookie-authenticated transport shared by JSON, auth and FormData calls. */
export async function fetchWithCsrf(url, options = {}) {
  const unsafe = CSRF_METHODS.includes((options.method || 'GET').toUpperCase());
  if (unsafe && !getCsrfToken()) await initializeCSRF();

  let sentToken;
  const send = () => {
    options.signal?.throwIfAborted();
    const headers = new Headers(options.headers);
    sentToken = getCsrfToken();
    if (unsafe && sentToken) headers.set('X-CSRF-Token', sentToken);
    return fetch(url, { ...options, headers, credentials: 'include' });
  };

  let response = await send();
  if (unsafe && response.status === 403) {
    // Only replay a CSRF rejection, which happens before the route executes.
    // Permission errors must never repeat a state-changing operation.
    const payload = await response.clone().json().catch(() => null);
    if (payload?.code === 'CSRF_INVALID' || payload?.error === 'Ungueltiges CSRF-Token') {
      // Another concurrent request may already have recovered this token.
      if (!getCsrfToken() || getCsrfToken() === sentToken) {
        setCsrfToken(null);
        await initializeCSRF();
      }
      if (getCsrfToken()) response = await send();
    }
  }
  return response;
}

/**
 * Base fetch with cookie authentication and CSRF protection.
 *
 * @param {string} url - The API endpoint URL
 * @param {Object} options - Fetch options
 * @returns {Promise<any>} The JSON response
 * @throws {Error} If the request fails
 */
export async function fetchWithAuth(url, options = {}) {
  // `signal` (vom Aufrufer, z. B. „Filter gewechselt") und `timeoutMs` werden
  // verbunden; ohne Timeout bleibt die UI bei einer halboffenen Verbindung
  // dauerhaft im `refreshing`-Zustand, weil nur das `finally` des neuesten
  // Requests `loading`/`refreshing` räumt.
  const { signal: externalSignal, timeoutMs, ...fetchOptions } = options;
  const { signal, cleanup, timedOut } = createRequestSignal({ timeoutMs, signal: externalSignal });

  const doFetch = async () => {
    const headers = {
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    };

    return fetchWithCsrf(`${API_BASE_URL}${url}`, {
      ...fetchOptions,
      headers,
      credentials: 'include',
      signal,
    });
  };

  try {
    const response = await doFetch();

    // Handle 401 Unauthorized - token expired or invalid.
    // Event (gedrosselt) feuern, damit der AuthContext die Session beenden kann.
    if (response.status === 401) {
      notifyUnauthorizedOncePerWindow(url);
      // Code mitgeben, sonst toastet die englische UI den hartkodierten deutschen
      // Satz „Nicht autorisiert" neben dem korrekt übersetzten Session-Banner.
      const payload = await parseResponse(response);
      throw unauthorizedError({ payload, headers: response.headers, fallbackMessage: ERROR_MESSAGES.UNAUTHORIZED });
    }

    // Handle other errors (inkl. 409-Konflikt: Status/Body durchreichen)
    if (!response.ok) {
      const payload = await parseResponse(response);
      throw createHttpError(payload, response.status);
    }

    return await parseResponse(response);
  } catch (error) {
    if (isAbortError(error)) {
      // Timeout und bewusster Abbruch sind unterschiedliche Fälle: Ein
      // ersetzter Request darf keinen Fehler-Toast auslösen, ein Timeout schon.
      const code = timedOut() ? 'REQUEST_TIMEOUT' : 'ABORTED';
      const abortError = new Error(code === 'REQUEST_TIMEOUT' ? 'Request timed out' : 'Request aborted');
      abortError.code = code;
      abortError.name = error.name || 'AbortError';
      abortError.status = 0;
      throw abortError;
    }
    throw error;
  } finally {
    cleanup();
  }
}

export async function parseResponse(response) {
  const text = await response.text().catch(() => '');
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    const safeText = text
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 500);
    return { error: safeText || ERROR_MESSAGES.GENERIC };
  }
}

/**
 * Initialize CSRF token on app start or after login
 * Should be called when the app loads and after successful authentication
 *
 * @returns {Promise<void>}
 */
export async function initializeCSRF() {
  // React startup, auth and uploads can arrive together without a cookie yet.
  // One shared request keeps the returned header token and browser cookie paired.
  if (!csrfInitialization) {
    csrfInitialization = (async () => {
      const { signal, cleanup } = createRequestSignal();
      try {
        const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AUTH.CSRF_TOKEN}`, {
          credentials: 'include',
          cache: 'no-store',
          signal,
        });
        if (response.ok) {
          const data = await parseResponse(response);
          setCsrfToken(data.csrfToken);
        }
      } catch (error) {
        console.error('Failed to fetch CSRF token:', error);
      } finally {
        cleanup();
      }
    })();
    csrfInitialization.finally(() => { csrfInitialization = null; });
  }
  return csrfInitialization;
}

/**
 * Build query string from params object
 * @param {Object} params - Query parameters
 * @returns {string} Query string (without leading ?)
 */
export function buildQueryString(params = {}) {
  return new URLSearchParams(params).toString();
}
