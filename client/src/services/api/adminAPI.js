import { API_ENDPOINTS } from '../../constants/api';
import { fetchWithAuth } from './apiUtils';

/**
 * Admin API module
 * Handles administrative functions (user management, stats, settings)
 * Requires admin privileges
 */
const adminAPI = {
  /**
   * Get all users (admin only)
   * @returns {Promise<Array>} Array of users
   */
  getUsers: () => fetchWithAuth(API_ENDPOINTS.ADMIN.USERS),

  /**
   * Get system statistics (admin only)
   * @returns {Promise<Object>} Stats data (user count, note count, etc.)
   */
  getStats: () => fetchWithAuth(API_ENDPOINTS.ADMIN.STATS),

  /**
   * Create a new user (admin only)
   * @param {Object} userData - User data (username, email, password, isAdmin)
   * @returns {Promise<Object>} Created user
   */
  createUser: (userData) =>
    fetchWithAuth(API_ENDPOINTS.ADMIN.USERS, {
      method: 'POST',
      body: JSON.stringify(userData),
    }),

  /**
   * Delete a user (admin only)
   * @param {string} userId - User ID to delete
   * @returns {Promise<Object>} Confirmation
   */
  deleteUser: (userId) =>
    fetchWithAuth(API_ENDPOINTS.ADMIN.USER_BY_ID(userId), {
      method: 'DELETE',
    }),

  /**
   * Toggle admin status of a user (admin only)
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Updated user
   */
  toggleUserAdmin: (userId) =>
    fetchWithAuth(API_ENDPOINTS.ADMIN.TOGGLE_ADMIN(userId), {
      method: 'PATCH',
    }),

  /**
   * Get system settings (admin only)
   * @returns {Promise<Object>} System settings
   */
  getSettings: () => fetchWithAuth(API_ENDPOINTS.ADMIN.SETTINGS),

  /**
   * Update system settings (admin only)
   * @param {Object} settings - Settings to update
   * @returns {Promise<Object>} Updated settings
   */
  updateSettings: (settings) =>
    fetchWithAuth(API_ENDPOINTS.ADMIN.SETTINGS, {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),
};

export default adminAPI;
