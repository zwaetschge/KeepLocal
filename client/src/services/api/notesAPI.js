import { API_ENDPOINTS } from '../../constants/api';
import { fetchWithAuth, buildQueryString, getCsrfToken, parseResponse, toHttpError, API_BASE_URL } from './apiUtils';
import { createRequestSignal, isAbortError, LONG_REQUEST_TIMEOUT_MS } from '../../utils/requestSignals.mjs';

/**
 * Multipart-Calls (Bild-Upload, Transkription) nutzen fetch() direkt. Sie
 * bekommen dasselbe Abort-/Timeout-Verhalten wie fetchWithAuth, nur mit einem
 * langen Limit: nginx bricht bei `proxy_read_timeout 300s` ab, der Server ruft
 * den AI-Dienst mit 300 s Timeout — ein kürzeres Client-Timeout würde einen
 * Abbruch melden, während der Server noch arbeitet.
 */
async function fetchMultipart(url, formData, fallbackMessage) {
  const { signal, cleanup, timedOut } = createRequestSignal({ timeoutMs: LONG_REQUEST_TIMEOUT_MS });
  const headers = {};
  const csrfToken = getCsrfToken();
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;

  try {
    const response = await fetch(`${API_BASE_URL}${url}`, {
      method: 'POST',
      headers,
      body: formData,
      credentials: 'include',
      signal,
    });

    if (!response.ok) {
      // code/status/retryAfter mitnehmen: ohne sie toastet die UI den deutschen
      // Server-Satz (z. B. „Maximal 25 Bilder pro Notiz erlaubt") statt der
      // vorhandenen Übersetzung, und ein 429 verliert sein Retry-After.
      throw await toHttpError(response, fallbackMessage);
    }

    return parseResponse(response);
  } catch (error) {
    if (isAbortError(error)) {
      const abortError = new Error(timedOut() ? 'Upload timed out' : 'Upload aborted');
      abortError.code = timedOut() ? 'REQUEST_TIMEOUT' : 'ABORTED';
      abortError.name = error.name || 'AbortError';
      throw abortError;
    }
    throw error;
  } finally {
    cleanup();
  }
}

/**
 * Notes API module
 * Handles all note-related operations (CRUD, pin, archive, share)
 */
const notesAPI = {
  /**
   * Get all notes with optional filtering
   * @param {Object} params - Query parameters (archived, tags, search, etc.)
   * @param {Object} [options] - `{ signal }` bricht einen laufenden Request ab,
   *   wenn ein neuer Filterwechsel ihn überholt (sonst blockieren die Leichen
   *   die sechs HTTP/1.1-Verbindungen pro Origin).
   * @returns {Promise<Array>} Array of notes
   */
  getAll: (params = {}, options = {}) => {
    const query = buildQueryString(params);
    return fetchWithAuth(`${API_ENDPOINTS.NOTES.BASE}${query ? `?${query}` : ''}`, { signal: options.signal });
  },

  /**
   * Get a single note by ID
   * @param {string} id - Note ID
   * @param {Object} [options] - `{ signal }`
   * @returns {Promise<Object>} Note data
   */
  getById: (id, options = {}) => fetchWithAuth(API_ENDPOINTS.NOTES.BY_ID(id), { signal: options.signal }),

  /**
   * Light note-tree projection (v1.10.0): flat list of {id, parentId, title,
   * order, isPinned, isCode, isArchived, ...} — no contents. The client nests
   * it itself for the folder panel.
   * @param {Object} [options] - `{ signal }`
   * @returns {Promise<Array>} Flat tree nodes
   */
  getTree: (params = {}, options = {}) => {
    // params (v1.16.0): { since } liefert nur geänderte Knoten — der Server
    // kann das seit v1.13, der Client schickte es bis v1.15 nie.
    const query = buildQueryString(params);
    return fetchWithAuth(`${API_ENDPOINTS.NOTES.TREE}${query ? `?${query}` : ''}`, { signal: options.signal });
  },

  /**
   * „Erwähnt in“ (v1.16.0): Notizen, die die angegebene per [[Titel]] erwähnen.
   * Läuft serverseitig über das echte Korpus — das geladene 50er-Fenster
   * zeigte bei vollem Bestand eine leere oder falsche Liste.
   * @returns {Promise<Array>} [{ id, title, updatedAt }]
   */
  getBacklinks: (id, options = {}) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.BACKLINKS(id), { signal: options.signal }),

  /**
   * Markdown ZIP export (v1.10.0): the whole tree as folders of .md files.
   * Blob download — the browser saves it like any other export.
   * @returns {Promise<Blob>} ZIP blob
   */
  exportMarkdown: async () => {
    const response = await fetch(`${API_BASE_URL}${API_ENDPOINTS.NOTES.EXPORT_MARKDOWN}`, {
      credentials: 'include',
      headers: getCsrfToken() ? { 'X-CSRF-Token': getCsrfToken() } : {},
    });
    if (!response.ok) throw await toHttpError(response, 'Export fehlgeschlagen');
    return response.blob();
  },

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
   * Aenderungs-Sonde fuer den 60s-Poll (v1.13.0 Nr. 9): Zaehlungen und
   * max(updatedAt) in einer Aggregation — der Client ueberspringt Liste+Baum,
   * wenn die Signatur unverblueft ist.
   * @returns {Promise<{active: number, archived: number, trash: number, maxUpdatedAt: string|null}>}
   */
  getMeta: (options = {}) => fetchWithAuth(API_ENDPOINTS.NOTES.META, { signal: options.signal }),

  /**
   * Revisions-Historie (v1.14.0 Nr. 7): Liste der gespeicherten Fassungen
   * (nur Metadaten — neueste zuerst) und Volltext einer Fassung via ?at=.
   * `at` ist exakt das savedAt, das die Liste geliefert hat.
   */
  getRevisions: (id, options = {}) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.REVISIONS(id), { signal: options.signal }),

  getRevision: (id, at, options = {}) =>
    fetchWithAuth(`${API_ENDPOINTS.NOTES.REVISIONS(id)}?at=${encodeURIComponent(at)}`, {
      signal: options.signal,
    }),

  /**
   * Fassung wiederherstellen: läuft serverseitig als normales updateNote —
   * der aktuelle Stand wird dabei selbst zur jüngsten Revision (Undo des
   * Undo funktioniert), 409-Konfliktbehandlung inklusive.
   */
  restoreRevision: (id, at) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.RESTORE_REVISION(id), {
      method: 'POST',
      body: JSON.stringify({ at }),
    }),

  /**
   * Markdown-ZIP-Round-trip-Import (v1.13.0 Nr. 7): Das Archiv des
   * Volldaten-Exports inklusive Anhaenge zurueckspielen. Der Server liest
   * das ZIP selbst (Fresh-Namen, Zip-Slip unmöglich) — der Client schickt
   * nur die Datei.
   * @param {File} archive - .zip vom Export oder aus Obsidian/Trilium
   * @returns {Promise<{created: number, foldersCreated: number}>}
   */
  importMarkdownZip: (archive) => {
    const formData = new FormData();
    formData.append('archive', archive);
    return fetchMultipart(
      API_ENDPOINTS.NOTES.IMPORT_MARKDOWN_ZIP,
      formData,
      'ZIP-Import fehlgeschlagen'
    );
  },

  /**
   * Markdown-Bulk-Import (v1.10.1): ein Ordner-Chunk pro Aufruf — die
   * Servergrenze (500 Items) spiegelt chunkImportItems im utils-Helper.
   * @param {Array<{path: string, title: string, content: string}>} items
   * @returns {Promise<{created: number, foldersCreated: number}>}
   */
  importMarkdown: (items) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.IMPORT_MARKDOWN, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),

  /**
   * Tag-Pflege über alle sichtbaren Notizen (v1.11.0): Umbenennen,
   * Zusammenführen oder Löschen als eine Server-Operation statt einer
   * Update-Request pro Notiz.
   * @param {'rename'|'merge'|'delete'} action
   * @param {string[]} from - Quell-Tags
   * @param {string} [to] - Ziel-Tag (rename/merge)
   * @returns {Promise<{action: string, modified: number}>}
   */
  tagOperation: (action, from, to) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.TAGS, {
      method: 'PATCH',
      body: JSON.stringify({ action, from, to }),
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
   * Persist a manual order (drag & drop) for one section
   * @param {string[]} orderedIds - note ids, top first
   * @returns {Promise<{updated: number}>}
   */
  reorder: (orderedIds) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.REORDER, {
      method: 'PATCH',
      body: JSON.stringify({ orderedIds }),
    }),

  /**
   * Restore a note from the trash
   * @param {string} id - Note ID
   * @returns {Promise<Object>} The restored note
   */
  restore: (id) =>
    fetchWithAuth(API_ENDPOINTS.NOTES.RESTORE(id), {
      method: 'POST',
    }),

  /**
   * Permanently delete a trashed note (including its images)
   * @param {string} id - Note ID
   * @returns {Promise<Object>} Confirmation
   */
  purge: (id) =>
    fetchWithAuth(`${API_ENDPOINTS.NOTES.BY_ID(id)}?permanent=true`, {
      method: 'DELETE',
    }),

  /**
   * Empty the trash
   * @returns {Promise<{removed: number}>}
   */
  emptyTrash: () =>
    fetchWithAuth(API_ENDPOINTS.NOTES.TRASH, {
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

    // Manual fetch for multipart/form-data (don't set Content-Type, browser will
    // set it with boundary) — inkl. Abort/Timeout und code/status/retryAfter.
    return fetchMultipart(
      `${API_ENDPOINTS.NOTES.BY_ID(id)}/images`,
      formData,
      'Bild-Upload fehlgeschlagen'
    );
  },

  /**
   * Delete an image from a note
   * @param {string} id - Note ID
   * @param {string} filename - Image filename to delete
   * @returns {Promise<Object>} Updated note without the image
   */
  deleteImage: (id, filename) =>
    fetchWithAuth(`${API_ENDPOINTS.NOTES.BY_ID(id)}/images/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    }),

  /**
   * Upload PDF attachments to a note (v1.12.0)
   * @param {string} id - Note ID
   * @param {FileList|Array} files - PDF files to upload (max 5 per request)
   * @returns {Promise<Object>} Updated note with files
   */
  uploadFiles: async (id, files) => {
    const formData = new FormData();
    Array.from(files).forEach((file) => formData.append('files', file));

    return fetchMultipart(
      `${API_ENDPOINTS.NOTES.BY_ID(id)}/files`,
      formData,
      'Datei-Upload fehlgeschlagen'
    );
  },

  /**
   * Delete an attachment from a note
   * @param {string} id - Note ID
   * @param {string} filename - Stored filename to remove
   * @returns {Promise<Object>} Updated note without the attachment
   */
  deleteFile: (id, filename) =>
    fetchWithAuth(`${API_ENDPOINTS.NOTES.BY_ID(id)}/files/${encodeURIComponent(filename)}`, {
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

    // 429 TRANSCRIPTION_BUSY kommt mit Retry-After: NoteModal behält die
    // Aufnahme und bietet „Erneut versuchen" an, statt sie wegzuwerfen.
    return fetchMultipart(
      `${API_ENDPOINTS.NOTES.BY_ID(id)}/transcribe`,
      formData,
      'Transkription fehlgeschlagen'
    );
  },
};

export default notesAPI;
