import { API_ENDPOINTS } from '../../constants/api';
import { fetchWithAuth, buildQueryString, getCsrfToken, getAuthToken, API_BASE_URL } from './apiUtils';

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

  /**
   * Upload images to a note
   * @param {string} id - Note ID
   * @param {FileList|Array} files - Files to upload
   * @returns {Promise<Object>} Updated note with images
   */
  uploadImages: async (id, files) => {
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append('images', file));

    // Manual fetch for multipart/form-data (don't set Content-Type, browser will set it with boundary)
    const token = getAuthToken();
    const csrfToken = getCsrfToken();

    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.NOTES.BY_ID(id)}/images`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Bild-Upload fehlgeschlagen');
    }

    return response.json();
  },

  /**
   * Delete an image from a note
   * @param {string} id - Note ID
   * @param {string} filename - Image filename to delete
   * @returns {Promise<Object>} Updated note without the image
   */
  deleteImage: (id, filename) =>
    fetchWithAuth(`${API_ENDPOINTS.NOTES.BY_ID(id)}/images/${filename}`, {
      method: 'DELETE',
    }),

  /**
   * Transcribe audio to text using AI service
   * @param {string} id - Note ID
   * @param {Blob} audioBlob - Audio blob to transcribe
   * @param {Object} options - Transcription options (language)
   * @returns {Promise<Object>} Transcription result {text, language, probability}
   */
  transcribeAudio: async (id, audioBlob, options = {}) => {
    const formData = new FormData();
    formData.append('audio', audioBlob, 'recording.webm');

    // Add language parameter if specified
    if (options.language && options.language !== 'auto') {
      formData.append('language', options.language);
    }

    // Manual fetch for multipart/form-data
    const token = getAuthToken();
    const csrfToken = getCsrfToken();

    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.NOTES.BY_ID(id)}/transcribe`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Transkription fehlgeschlagen');
    }

    return response.json();
  },
};

export default notesAPI;
