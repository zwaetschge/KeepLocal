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
 * Base fetch with cookie authentication and CSRF protection.
 *
 * @param {string} url - The API endpoint URL
 * @param {Object} options - Fetch options
 * @returns {Promise<any>} The JSON response
 * @throws {Error} If the request fails
 */
export async function fetchWithAuth(url, options = {}) {
  const csrf = getCsrfToken();

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

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
    throw new Error(ERROR_MESSAGES.UNAUTHORIZED);
  }

  // Handle other errors
  if (!response.ok) {
    const error = await parseResponse(response);
    throw new Error(error.error || `HTTP ${response.status}`);
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
