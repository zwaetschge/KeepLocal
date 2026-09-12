import { API_BASE_URL, API_ENDPOINTS, CSRF_METHODS, ERROR_MESSAGES } from '../../constants/api';
import { buildHttpError, unauthorizedError } from '../../utils/httpErrors.mjs';

// Re-export API_BASE_URL for use in other API modules
export { API_BASE_URL };

// Store CSRF token in memory (not in cookie!)
let csrfToken = null;

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
 * Warum exportiert: Die beiden Multipart-Pfade (Bild-Upload, Transkription)
 * rufen `fetch()` direkt, weil FormData keinen JSON-Wrapper verträgt. Sie warfen
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

/**
 * Base fetch with cookie authentication and CSRF protection.
 *
 * @param {string} url - The API endpoint URL
 * @param {Object} options - Fetch options
 * @returns {Promise<any>} The JSON response
 * @throws {Error} If the request fails
 */
export async function fetchWithAuth(url, options = {}) {
  const doFetch = async () => {
    const csrf = getCsrfToken();

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    // Add CSRF token for state-changing operations
    if (csrf && CSRF_METHODS.includes(options.method)) {
      headers['X-CSRF-Token'] = csrf;
    }

    return fetch(`${API_BASE_URL}${url}`, {
      ...options,
      headers,
      credentials: 'include',
    });
  };

  let response = await doFetch();

  // A 403 with a CSRF mismatch means the in-memory token no longer matches
  // the cookie (e.g. the cookie expired after 8h while the session lives on,
  // or a previous logout cleared the cookie but not our token). Fetch a fresh
  // token once and retry instead of failing every mutation until a reload.
  if (response.status === 403 && CSRF_METHODS.includes(options.method)) {
    setCsrfToken(null);
    await initializeCSRF();
    if (getCsrfToken()) {
      response = await doFetch();
    }
  }

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

  return parseResponse(response);
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
  try {
    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AUTH.CSRF_TOKEN}`, {
      credentials: 'include',
    });

    if (response.ok) {
      const data = await parseResponse(response);
      setCsrfToken(data.csrfToken);
    }
  } catch (error) {
    console.error('Failed to fetch CSRF token:', error);
  }
}

/**
 * Build query string from params object
 * @param {Object} params - Query parameters
 * @returns {string} Query string (without leading ?)
 */
export function buildQueryString(params = {}) {
  return new URLSearchParams(params).toString();
}
