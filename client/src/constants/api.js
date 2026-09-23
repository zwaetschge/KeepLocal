// API endpoints below already include /api. Accept both an origin and an
// accidentally /api-suffixed base URL without ever producing /api/api.
const configuredApiUrl = import.meta.env.VITE_API_URL
  || import.meta.env.REACT_APP_API_URL
  || (import.meta.env.PROD ? '' : 'http://localhost:5000');
export const API_BASE_URL = configuredApiUrl
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/api$/, '');

// API Endpoints
export const API_ENDPOINTS = {
  // Auth endpoints
  AUTH: {
    SETUP_NEEDED: '/api/auth/setup-needed',
    REGISTER: '/api/auth/register',
    LOGIN: '/api/auth/login',
    DEMO: '/api/auth/demo',
    LOGOUT: '/api/auth/logout',
    ME: '/api/auth/me',
    PREFERENCES: '/api/auth/preferences',
    STORAGE: '/api/auth/storage',
    CSRF_TOKEN: '/api/csrf-token',
    PROVIDERS: '/api/auth/providers',
    CHANGE_PASSWORD: '/api/auth/change-password',
    RESET_PASSWORD: '/api/auth/reset-password',
    GOOGLE: '/api/auth/google',
    GITHUB: '/api/auth/github',
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
    REORDER: '/api/notes/reorder',
    RESTORE: (id) => `/api/notes/${id}/restore`,
    TRASH: '/api/notes/trash',
    // v1.10.0: Baum-Projektion für das Ordner-Panel + Markdown-ZIP-Export
    TREE: '/api/notes/tree',
    EXPORT_MARKDOWN: '/api/notes/export/markdown',
    // v1.10.1: Bulk-Import (Ordner-Chunk) statt Create-Request pro Datei
    IMPORT_MARKDOWN: '/api/notes/import/markdown',
    // v1.13.0: Round-trip-Import des Volldaten-Exports (ZIP mit Anhangen)
    IMPORT_MARKDOWN_ZIP: '/api/notes/import/markdown-zip',
    // v1.13.0: Aenderungs-Sonde fuer den 60s-Poll (Delta-Sync)
    META: '/api/notes/meta',
    // v1.11.0: Tag umbenennen/zusammenführen/löschen über alle sichtbaren Notizen
    TAGS: '/api/notes/tags',
    // v1.14.0: Revisions-Historie — Liste (Metadaten), Volltext via ?at=,
    // Restore als normales updateNote (aktueller Stand wird selbst Revision).
    REVISIONS: (id) => `/api/notes/${id}/revisions`,
    RESTORE_REVISION: (id) => `/api/notes/${id}/revisions/restore`,
    // v1.16.0: „Erwähnt in“ — Notizen, die diese per [[Titel]] erwähnen.
    // Serverseitig über das echte Korpus (das geladene Fenster lügt sonst).
    BACKLINKS: (id) => `/api/notes/${id}/backlinks`,
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
    PASSWORD_RESET: (userId) => `/api/admin/users/${userId}/password-reset`,
    SETTINGS: '/api/admin/settings',
    // v1.13.0: Backup-Scheduler — Status + Recovery Points, manueller Lauf
    BACKUPS: '/api/admin/backups',
    BACKUPS_RUN: '/api/admin/backups/run',
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
