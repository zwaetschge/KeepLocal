// API Base URL configuration
export const API_BASE_URL = process.env.REACT_APP_API_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5000');

// API Endpoints
export const API_ENDPOINTS = {
  // Auth endpoints
  AUTH: {
    SETUP_NEEDED: '/api/auth/setup-needed',
    REGISTER: '/api/auth/register',
    LOGIN: '/api/auth/login',
    ME: '/api/auth/me',
    CSRF_TOKEN: '/api/csrf-token',
  },

  // Notes endpoints
  NOTES: {
    BASE: '/api/notes',
    BY_ID: (id) => `/api/notes/${id}`,
    PIN: (id) => `/api/notes/${id}/pin`,
    ARCHIVE: (id) => `/api/notes/${id}/archive`,
    SHARE: (id) => `/api/notes/${id}/share`,
    UNSHARE: (id, userId) => `/api/notes/${id}/share/${userId}`,
    LINK_PREVIEW: '/api/notes/link-preview',
  },

  // Friends endpoints
  FRIENDS: {
    BASE: '/api/friends',
    REQUESTS: '/api/friends/requests',
    REQUEST: '/api/friends/request',
    ACCEPT: (requestId) => `/api/friends/accept/${requestId}`,
    REJECT: (requestId) => `/api/friends/reject/${requestId}`,
    REMOVE: (friendId) => `/api/friends/${friendId}`,
    SEARCH: '/api/friends/search',
  },

  // API Keys endpoints
  API_KEYS: {
    BASE: '/api/api-keys',
    BY_ID: (id) => `/api/api-keys/${id}`,
  },

  // Admin endpoints
  ADMIN: {
    USERS: '/api/admin/users',
    STATS: '/api/admin/stats',
    USER_BY_ID: (userId) => `/api/admin/users/${userId}`,
    TOGGLE_ADMIN: (userId) => `/api/admin/users/${userId}/admin`,
    SETTINGS: '/api/admin/settings',
  },
};

// HTTP Methods that require CSRF token
export const CSRF_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];

// Error Messages
export const ERROR_MESSAGES = {
  UNAUTHORIZED: 'Nicht autorisiert',
  GENERIC: 'Ein Fehler ist aufgetreten',
  REGISTRATION_FAILED: 'Registrierung fehlgeschlagen',
  LOGIN_FAILED: 'Anmeldung fehlgeschlagen',
  NETWORK_ERROR: 'Netzwerkfehler',
};
