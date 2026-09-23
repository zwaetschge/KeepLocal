import { API_BASE_URL, API_ENDPOINTS, ERROR_MESSAGES } from '../../constants/api';
import { fetchWithAuth, getCsrfToken, setCsrfToken, initializeCSRF, parseResponse } from './apiUtils';

async function authCsrfHeaders() {
  if (!getCsrfToken()) {
    await initializeCSRF();
  }

  const csrfToken = getCsrfToken();
  if (!csrfToken) {
    throw new Error('Sicherheits-Token konnte nicht geladen werden');
  }

  return { 'X-CSRF-Token': csrfToken };
}

/**
 * POST with one CSRF recovery retry. The in-memory token can go stale without
 * the page reloading (previous logout cleared the cookie but not our token, or
 * the cookie expired while the tab stayed open); a 403 then fails every auth
 * mutation until a manual reload. Refetch the token once and retry instead.
 */
async function postWithCsrfRetry(url, body) {
  const doFetch = async () => {
    const csrfHeaders = await authCsrfHeaders();
    return fetch(`${API_BASE_URL}${url}`, {
      method: 'POST',
      headers: body === undefined
        ? csrfHeaders
        : { 'Content-Type': 'application/json', ...csrfHeaders },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      credentials: 'include',
    });
  };

  let response = await doFetch();
  if (response.status === 403) {
    setCsrfToken(null);
    await initializeCSRF();
    if (getCsrfToken()) {
      response = await doFetch();
    }
  }
  return response;
}

/**
 * Build an Error that keeps the server's stable code and status, so callers can
 * translate it (utils/apiErrors.mjs) instead of showing the German prose.
 */
function authError(payload, status, fallbackMessage) {
  const error = new Error(payload?.error || fallbackMessage);
  error.code = payload?.code;
  error.status = status;
  error.data = payload;
  return error;
}

function requireUserPayload(data, fallbackMessage) {
  if (!data?.user || typeof data.user !== 'object' || !data.user.id) {
    throw authError(data, undefined, fallbackMessage);
  }
  return data;
}

/**
 * Authentication API module
 * Handles user registration, login, logout, and session management
 */
const authAPI = {
  /**
   * Check if initial setup is needed (no users in database)
   * @returns {Promise<{setupNeeded: boolean}>} Setup status
   */
  checkSetupNeeded: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AUTH.SETUP_NEEDED}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        return { setupNeeded: false };
      }

      const data = await parseResponse(response);
      return data;
    } catch (error) {
      console.error('Failed to check setup status:', error);
      return { setupNeeded: false };
    }
  },

  /**
   * Register a new user
   * @param {string} username - Username
   * @param {string} email - Email address
   * @param {string} password - Password
   * @returns {Promise<{user: Object}>} User data
   * @throws {Error} If registration fails
   */
  register: async (username, email, password) => {
    const response = await postWithCsrfRetry(API_ENDPOINTS.AUTH.REGISTER, { username, email, password });

    if (!response.ok) {
      throw authError(await parseResponse(response), response.status, ERROR_MESSAGES.REGISTRATION_FAILED);
    }

    const data = requireUserPayload(
      await parseResponse(response),
      ERROR_MESSAGES.REGISTRATION_FAILED
    );
    await initializeCSRF(); // Refresh CSRF token after registration
    return data;
  },

  /**
   * Login user
   * @param {string} email - Email address
   * @param {string} password - Password
   * @returns {Promise<{user: Object}>} User data
   * @throws {Error} If login fails
   */
  login: async (email, password) => {
    const response = await postWithCsrfRetry(API_ENDPOINTS.AUTH.LOGIN, { email, password });

    if (!response.ok) {
      throw authError(await parseResponse(response), response.status, ERROR_MESSAGES.LOGIN_FAILED);
    }

    const data = requireUserPayload(
      await parseResponse(response),
      ERROR_MESSAGES.LOGIN_FAILED
    );
    await initializeCSRF(); // Refresh CSRF token after login
    return data;
  },

  /**
   * Start an isolated public demo session without exposing shared credentials.
   * The endpoint only exists when the server explicitly enables demo mode.
   * @returns {Promise<{user: Object}>} Demo user data
   * @throws {Error} If demo mode is unavailable or the session cannot be created
   */
  demoLogin: async () => {
    const response = await postWithCsrfRetry(API_ENDPOINTS.AUTH.DEMO);

    if (!response.ok) {
      throw authError(await parseResponse(response), response.status, ERROR_MESSAGES.LOGIN_FAILED);
    }

    const data = requireUserPayload(
      await parseResponse(response),
      ERROR_MESSAGES.LOGIN_FAILED
    );
    await initializeCSRF();
    return data;
  },

  /**
   * Logout current user
   * Clears the cookie-backed session and any legacy local token.
   */
  logout: async () => {
    try {
      await postWithCsrfRetry(API_ENDPOINTS.AUTH.LOGOUT);
    } catch {
      // Local session state is cleared even when the server is unavailable.
    } finally {
      // The server cleared the kl_csrf cookie; drop our in-memory copy too so
      // the next login does not send a stale token that no longer matches.
      setCsrfToken(null);
    }
  },

  /**
   * Change the own password. Requires the current password; the server bumps
   * the session version, so every OTHER device is logged out and this session
   * receives a fresh cookie.
   * @param {string} currentPassword
   * @param {string} newPassword
   * @returns {Promise<{user: Object}>}
   * @throws {Error} With the server message (wrong current password, too weak)
   */
  changePassword: async (currentPassword, newPassword) => {
    const response = await postWithCsrfRetry(API_ENDPOINTS.AUTH.CHANGE_PASSWORD, { currentPassword, newPassword });
    const data = await parseResponse(response);
    if (!response.ok) {
      throw authError(data, response.status, ERROR_MESSAGES.GENERIC);
    }
    await initializeCSRF();
    return data;
  },

  /**
   * Redeem a one-time reset token (generated by an administrator). Works
   * without a session; afterwards every session of that account is invalid.
   * @param {string} token
   * @param {string} newPassword
   * @returns {Promise<Object>}
   */
  resetPassword: async (token, newPassword) => {
    const response = await postWithCsrfRetry(API_ENDPOINTS.AUTH.RESET_PASSWORD, { token, newPassword });
    const data = await parseResponse(response);
    if (!response.ok) {
      throw authError(data, response.status, ERROR_MESSAGES.GENERIC);
    }
    return data;
  },

  /**
   * Store account-wide preferences (theme, AI features, transcription
   * language). Partial updates are fine — the server only touches the fields
   * that are sent.
   * @param {Object} preferences
   * @returns {Promise<{preferences: Object}>}
   */
  updatePreferences: async (preferences) => {
    const response = await fetchWithAuth(API_ENDPOINTS.AUTH.PREFERENCES, {
      method: 'PUT',
      body: JSON.stringify(preferences),
    });
    return response;
  },

  /**
   * Storage-Nutzung + Quota-Budget des Accounts (v1.17.0). Der Server antwortet
   * mit { usedBytes, limitBytes, enforced } — enforced=false heißt unlimitiert
   * (UPLOAD_QUOTA_MB=0), dann zeigt die UI nur die Nutzung.
   * @returns {Promise<{usedBytes: number, limitBytes: number, enforced: boolean}>}
   */
  getStorageUsage: async () => fetchWithAuth(API_ENDPOINTS.AUTH.STORAGE),

  /**
   * Get current authenticated user data
   * @returns {Promise<Object>} Current user data
   * @throws {Error} If not authenticated or request fails
   */
  getCurrentUser: async () => requireUserPayload(
    await fetchWithAuth(API_ENDPOINTS.AUTH.ME),
    ERROR_MESSAGES.UNAUTHORIZED
  ),
};

export { requireUserPayload };
export default authAPI;
