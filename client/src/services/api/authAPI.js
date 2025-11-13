import { API_BASE_URL, API_ENDPOINTS, ERROR_MESSAGES } from '../../constants/api';
import { fetchWithAuth, setAuthToken, initializeCSRF } from './apiUtils';

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

      const data = await response.json();
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
   * @returns {Promise<{token: string, user: Object}>} User data and JWT token
   * @throws {Error} If registration fails
   */
  register: async (username, email, password) => {
    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AUTH.REGISTER}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || ERROR_MESSAGES.REGISTRATION_FAILED);
    }

    const data = await response.json();
    setAuthToken(data.token);
    await initializeCSRF(); // Refresh CSRF token after registration
    return data;
  },

  /**
   * Login user
   * @param {string} email - Email address
   * @param {string} password - Password
   * @returns {Promise<{token: string, user: Object}>} User data and JWT token
   * @throws {Error} If login fails
   */
  login: async (email, password) => {
    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.AUTH.LOGIN}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || ERROR_MESSAGES.LOGIN_FAILED);
    }

    const data = await response.json();
    setAuthToken(data.token);
    await initializeCSRF(); // Refresh CSRF token after login
    return data;
  },

  /**
   * Logout current user
   * Clears the authentication token from localStorage
   */
  logout: () => {
    setAuthToken(null);
  },

  /**
   * Get current authenticated user data
   * @returns {Promise<Object>} Current user data
   * @throws {Error} If not authenticated or request fails
   */
  getCurrentUser: () => fetchWithAuth(API_ENDPOINTS.AUTH.ME),
};

export default authAPI;
