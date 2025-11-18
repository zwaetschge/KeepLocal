import { API_BASE_URL, API_ENDPOINTS, CSRF_METHODS, ERROR_MESSAGES } from '../../constants/api';

// Re-export API_BASE_URL for use in other API modules
export { API_BASE_URL };

// Store CSRF token in memory (not in cookie!)
let csrfToken = null;

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
 * Get JWT token from localStorage
 * @returns {string|null} The authentication token
 */
export function getAuthToken() {
  return localStorage.getItem('token');
}

/**
 * Set JWT token in localStorage
 * @param {string|null} token - The JWT token to store or null to remove
 */
export function setAuthToken(token) {
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }
}

/**
 * Check if user is authenticated
 * @returns {boolean} True if user has a valid token
 */
export function isAuthenticated() {
  return !!getAuthToken();
}

/**
 * Base fetch with authentication and CSRF protection
 * Automatically adds JWT and CSRF tokens to requests
 * Handles 401 errors by redirecting to login
 *
 * @param {string} url - The API endpoint URL
 * @param {Object} options - Fetch options
 * @returns {Promise<any>} The JSON response
 * @throws {Error} If the request fails
 */
export async function fetchWithAuth(url, options = {}) {
  const token = getAuthToken();
  const csrf = getCsrfToken();

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  // Add JWT token if available
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Add CSRF token for state-changing operations
  if (csrf && CSRF_METHODS.includes(options.method)) {
    headers['X-CSRF-Token'] = csrf;
  }

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  // Handle 401 Unauthorized - token expired or invalid
  if (response.status === 401) {
    setAuthToken(null);
    window.location.href = '/login';
    throw new Error(ERROR_MESSAGES.UNAUTHORIZED);
  }

  // Handle other errors
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: ERROR_MESSAGES.GENERIC }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
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
      const data = await response.json();
      setCsrfToken(data.csrfToken);
      console.log('CSRF token initialized successfully');
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
