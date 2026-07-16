import { API_BASE_URL, API_ENDPOINTS, ERROR_MESSAGES } from '../../constants/api';
import { fetchWithAuth, getCsrfToken, initializeCSRF, parseResponse } from './apiUtils';

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
    const csrfHeaders = await authCsrfHeaders();
    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AUTH.REGISTER}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders },
      body: JSON.stringify({ username, email, password }),
      credentials: 'include',
    });

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
    const csrfHeaders = await authCsrfHeaders();
    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AUTH.LOGIN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });

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
   * Logout current user
   * Clears the cookie-backed session and any legacy local token.
   */
  logout: async () => {
    try {
      const csrfHeaders = await authCsrfHeaders();
      await fetch(`${API_BASE_URL}${API_ENDPOINTS.AUTH.LOGOUT}`, {
        method: 'POST',
        headers: csrfHeaders,
        credentials: 'include'
      });
    } catch {
      // Local session state is cleared even when the server is unavailable.
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
