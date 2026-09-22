import { fetchWithAuth } from './apiUtils';
import { API_ENDPOINTS } from '../../constants/api';

/**
 * Get all API keys for the current user
 */
export async function getApiKeys() {
  return fetchWithAuth(API_ENDPOINTS.API_KEYS.BASE);
}

/**
 * Create a new API key
 * @param {string} name - Descriptive name
 * @param {string} expiresIn - '30d', '90d', '365d', or 'never'
 * @param {string[]} [scopes] - v1.14.0: ['read'] (default) or ['read','write'];
 *   the server rejects anything else. Write access must be an explicit choice.
 */
export async function createApiKey(name, expiresIn = 'never', scopes = ['read']) {
  return fetchWithAuth(API_ENDPOINTS.API_KEYS.BASE, {
    method: 'POST',
    body: JSON.stringify({ name, expiresIn, scopes }),
  });
}

/**
 * Revoke (delete) an API key
 * @param {string} id - API key ID
 */
export async function revokeApiKey(id) {
  return fetchWithAuth(API_ENDPOINTS.API_KEYS.BY_ID(id), {
    method: 'DELETE',
  });
}
