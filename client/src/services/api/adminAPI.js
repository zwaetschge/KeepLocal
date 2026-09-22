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
   * Generate a one-time password reset token for a user (admin only).
   * The raw token is returned exactly once and is valid for 15 minutes.
   * @param {string} userId
   * @returns {Promise<{resetToken: string, expiresAt: string, user: Object}>}
   */
  createPasswordReset: (userId) =>
    fetchWithAuth(API_ENDPOINTS.ADMIN.PASSWORD_RESET(userId), {
      method: 'POST',
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

  /**
   * Backup-Status und Recovery Points (v1.13.0 Nr. 3). `status` ist null,
   * solange noch kein Lauf passiert ist; `backups` listet die letzten 20.
   * @returns {Promise<{status: Object|null, backups: Array}>}
   */
  getBackups: () => fetchWithAuth(API_ENDPOINTS.ADMIN.BACKUPS),

  /**
   * Backup sofort anstoßen (v1.13.0 Nr. 3) — wartet auf den Lauf; ein
   * fehlgeschlagener Lauf antwortet 500 mit der Fehlermeldung im Body.
   * @returns {Promise<{status: {ok: boolean, error: string|null, target: string|null, durationMs: number, intervalHours: number}}>}
   */
  runBackup: () =>
    fetchWithAuth(API_ENDPOINTS.ADMIN.BACKUPS_RUN, {
      method: 'POST',
    }),
};

export default adminAPI;
