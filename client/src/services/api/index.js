/**
 * API Service Layer Index
 * Exports all API modules and utilities for easy importing throughout the app
 *
 * Usage:
 * import { authAPI, notesAPI, initializeCSRF } from 'services/api';
 *
 * Or for backward compatibility:
 * import api from 'services/api';
 * api.authAPI.login(email, password);
 */

import authAPI from './authAPI';
import notesAPI from './notesAPI';
import friendsAPI from './friendsAPI';
import adminAPI from './adminAPI';
import {
  initializeCSRF,
  getCsrfToken,
  fetchWithAuth,
} from './apiUtils';

// Named exports for tree-shaking and better IDE support
export { authAPI, notesAPI, friendsAPI, adminAPI };
export { initializeCSRF, getCsrfToken, fetchWithAuth };

// Backward compatibility: export fetchLinkPreviewAPI as a standalone function
// This maintains the old API surface while using the new structure
export const fetchLinkPreviewAPI = notesAPI.fetchLinkPreview;

// Default export for backward compatibility
const api = {
  authAPI,
  notesAPI,
  friendsAPI,
  adminAPI,
  initializeCSRF,
  fetchLinkPreviewAPI,
};

export default api;
