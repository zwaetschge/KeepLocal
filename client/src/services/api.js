// Use relative URLs in production (Docker) so requests go through nginx proxy
// Use localhost:5000 in development for direct backend access
const API_BASE_URL = process.env.REACT_APP_API_URL || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:5000');

// Store CSRF token in memory (not in cookie!)
let csrfToken = null;

// Get CSRF token from memory
function getCsrfToken() {
  return csrfToken;
}

// Set CSRF token
function setCsrfToken(token) {
  csrfToken = token;
}

// Get JWT token from localStorage
function getAuthToken() {
  return localStorage.getItem('token');
}

// Set JWT token
export function setAuthToken(token) {
  if (token) {
    localStorage.setItem('token', token);
  } else {
    localStorage.removeItem('token');
  }
}

// Check if user is authenticated
export function isAuthenticated() {
  return !!getAuthToken();
}

// Base fetch with auth and CSRF
async function fetchWithAuth(url, options = {}) {
  const token = getAuthToken();
  const csrfToken = getCsrfToken();

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (csrfToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method)) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 401) {
    // Token expired or invalid
    setAuthToken(null);
    window.location.href = '/login';
    throw new Error('Nicht autorisiert');
  }

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Ein Fehler ist aufgetreten' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// Auth API
export const authAPI = {
  checkSetupNeeded: async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/setup-needed`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        return { setupNeeded: false };
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Failed to check setup status:', error);
      return { setupNeeded: false };
    }
  },

  register: async (username, email, password) => {
    const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Registrierung fehlgeschlagen');
    }

    const data = await response.json();
    setAuthToken(data.token);
    await initializeCSRF(); // Refresh CSRF token after registration
    return data;
  },

  login: async (email, password) => {
    const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Anmeldung fehlgeschlagen');
    }

    const data = await response.json();
    setAuthToken(data.token);
    await initializeCSRF(); // Refresh CSRF token after login
    return data;
  },

  logout: () => {
    setAuthToken(null);
  },

  getCurrentUser: () => fetchWithAuth('/api/auth/me'),
};

// Notes API
export const notesAPI = {
  getAll: (params = {}) => {
    const query = new URLSearchParams(params).toString();
    return fetchWithAuth(`/api/notes${query ? `?${query}` : ''}`);
  },

  getById: (id) => fetchWithAuth(`/api/notes/${id}`),

  create: (noteData) =>
    fetchWithAuth('/api/notes', {
      method: 'POST',
      body: JSON.stringify(noteData),
    }),

  update: (id, noteData) =>
    fetchWithAuth(`/api/notes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(noteData),
    }),

  delete: (id) =>
    fetchWithAuth(`/api/notes/${id}`, {
      method: 'DELETE',
    }),

  togglePin: (id) =>
    fetchWithAuth(`/api/notes/${id}/pin`, {
      method: 'POST',
    }),
};

// Link Preview API
export async function fetchLinkPreviewAPI(url) {
  return fetchWithAuth('/api/notes/link-preview', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

// Admin API
export const adminAPI = {
  getUsers: () => fetchWithAuth('/api/admin/users'),

  getStats: () => fetchWithAuth('/api/admin/stats'),

  createUser: (userData) =>
    fetchWithAuth('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    }),

  deleteUser: (userId) =>
    fetchWithAuth(`/api/admin/users/${userId}`, {
      method: 'DELETE',
    }),

  toggleUserAdmin: (userId) =>
    fetchWithAuth(`/api/admin/users/${userId}/admin`, {
      method: 'PATCH',
    }),

  getSettings: () => fetchWithAuth('/api/admin/settings'),

  updateSettings: (settings) =>
    fetchWithAuth('/api/admin/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),
};

// Fetch CSRF token on app start
export async function initializeCSRF() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/csrf-token`, {
      credentials: 'include',
    });

    if (response.ok) {
      const data = await response.json();
      setCsrfToken(data.csrfToken);
      console.log('CSRF token initialized successfully');
    }
  } catch (error) {
    console.error('Failed to fetch CSRF token:', error);
  }
}

export default {
  authAPI,
  notesAPI,
  adminAPI,
  initializeCSRF,
  isAuthenticated,
  setAuthToken,
};
