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

function requireUserPayload(data, fallbackMessage) {
  if (!data?.user || typeof data.user !== 'object' || !data.user.id) {
    throw new Error(data?.error || fallbackMessage);
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
      const error = await parseResponse(response);
      throw new Error(error.error || ERROR_MESSAGES.REGISTRATION_FAILED);
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
      const error = await parseResponse(response);
      throw new Error(error.error || ERROR_MESSAGES.LOGIN_FAILED);
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
      const error = await parseResponse(response);
      throw new Error(error.error || ERROR_MESSAGES.LOGIN_FAILED);
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
