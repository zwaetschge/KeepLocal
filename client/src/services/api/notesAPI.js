import { API_ENDPOINTS } from '../../constants/api';
import { fetchWithAuth, buildQueryString } from './apiUtils';

/**
 * Notes API module
 * Handles all note-related operations (CRUD, pin, archive, share)
 */
const notesAPI = {
  /**
   * Get all notes with optional filtering
   * @param {Object} params - Query parameters (archived, tags, search, etc.)
   * @returns {Promise<Array>} Array of notes
   */
  getAll: (params = {}) => {
    const query = buildQueryString(params);
    return fetchWithAuth(`${API_ENDPOINTS.NOTES.BASE}${query ? `?${query}` : ''}`);
  },

  /**
   * Get a single note by ID
   * @param {string} id - Note ID
   * @returns {Promise<Object>} Note data
   */
  getById: (id) => fetchWithAuth(API_ENDPOINTS.NOTES.BY_ID(id)),

  /**
   * Create a new note
   * @param {Object} noteData - Note data (title, content, color, etc.)
   * @returns {Promise<Object>} Created note
   */
  create: (noteData) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.BASE, {
      method: 'POST',
      body: JSON.stringify(noteData),
    }),

  /**
   * Update an existing note
   * @param {string} id - Note ID
   * @param {Object} noteData - Updated note data
   * @returns {Promise<Object>} Updated note
   */
  update: (id, noteData) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.BY_ID(id), {
      method: 'PUT',
      body: JSON.stringify(noteData),
    }),

  /**
   * Delete a note
   * @param {string} id - Note ID
   * @returns {Promise<Object>} Deletion confirmation
   */
  delete: (id) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.BY_ID(id), {
      method: 'DELETE',
    }),

  /**
   * Toggle pin status of a note
   * @param {string} id - Note ID
   * @returns {Promise<Object>} Updated note
   */
  togglePin: (id) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.PIN(id), {
      method: 'POST',
    }),

  /**
   * Toggle archive status of a note
   * @param {string} id - Note ID
   * @returns {Promise<Object>} Updated note
   */
  toggleArchive: (id) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.ARCHIVE(id), {
      method: 'POST',
    }),

  /**
   * Share a note with another user
   * @param {string} id - Note ID
   * @param {string} userId - User ID to share with
   * @returns {Promise<Object>} Updated note
   */
  shareNote: (id, userId) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.SHARE(id), {
      method: 'POST',
      body: JSON.stringify({ userId }),
    }),

  /**
   * Remove sharing access for a user
   * @param {string} id - Note ID
   * @param {string} userId - User ID to unshare from
   * @returns {Promise<Object>} Updated note
   */
  unshareNote: (id, userId) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.UNSHARE(id, userId), {
      method: 'DELETE',
    }),

  /**
   * Fetch link preview for a URL
   * @param {string} url - URL to fetch preview for
   * @returns {Promise<Object>} Link preview data (title, description, image)
   */
  fetchLinkPreview: (url) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.LINK_PREVIEW, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
};

export default notesAPI;
