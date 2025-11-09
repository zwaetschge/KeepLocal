import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './App.css';
import NoteForm from './components/NoteForm';
import NoteList from './components/NoteList';
import SearchBar from './components/SearchBar';
import Sidebar from './components/Sidebar';
import ThemeToggle from './components/ThemeToggle';
import Toast from './components/Toast';
import Login from './components/Login';
import Register from './components/Register';
import Setup from './components/Setup';
import AdminConsole from './components/AdminConsole';
import Logo from './components/Logo';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { notesAPI, initializeCSRF } from './services/api';

function AppContent() {
  const { user, isLoggedIn, loading: authLoading, setupNeeded, login, register, logout, setup } = useAuth();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);
  const [toast, setToast] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [showAdminConsole, setShowAdminConsole] = useState(false);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [operationLoading, setOperationLoading] = useState({});
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme === 'dark';
  });

  const noteFormRef = useRef(null);
  const searchBarRef = useRef(null);

  // Initialize CSRF token on mount
  useEffect(() => {
    initializeCSRF();
  }, []);

  // Toast-Benachrichtigung anzeigen
  const showToast = useCallback((message, type = 'info') => {
    setToast({ message, type });
  }, []);

  // Dark Mode anwenden
  useEffect(() => {
    if (isDarkMode) {
      document.body.classList.add('dark-mode');
    } else {
      document.body.classList.remove('dark-mode');
    }
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // Notizen vom Server laden
  const fetchNotes = useCallback(async (search = '', page = 1) => {
    if (!isLoggedIn) return;

    try {
      setLoading(true);
      const params = { page, limit: 50 };
      if (search) params.search = search;

      const response = await notesAPI.getAll(params);
      setNotes(response.notes || []);
      setPagination(response.pagination || { page: 1, limit: 50, total: 0, pages: 0 });
    } catch (error) {
      console.error('Fehler beim Laden der Notizen:', error);
      showToast(error.message || 'Fehler beim Laden der Notizen', 'error');
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn, showToast]);

  // Notizen laden wenn eingeloggt
  useEffect(() => {
    if (isLoggedIn && !authLoading) {
      fetchNotes();
    }
  }, [isLoggedIn, authLoading, fetchNotes]);

  // Neue Notiz erstellen
  const createNote = async (noteData) => {
    setOperationLoading(prev => ({ ...prev, create: true }));
    try {
      const response = await notesAPI.create(noteData);
      setNotes([response, ...notes]);
      showToast('Notiz erfolgreich erstellt', 'success');
    } catch (error) {
      console.error('Fehler beim Erstellen der Notiz:', error);
      showToast(error.message || 'Fehler beim Erstellen der Notiz', 'error');
    } finally {
      setOperationLoading(prev => ({ ...prev, create: false }));
    }
  };

  // Notiz löschen
  const deleteNote = async (id) => {
    setOperationLoading(prev => ({ ...prev, [id]: 'delete' }));
    try {
      await notesAPI.delete(id);
      setNotes(notes.filter(note => note._id !== id));
      showToast('Notiz gelöscht', 'success');
    } catch (error) {
      console.error('Fehler beim Löschen der Notiz:', error);
      showToast(error.message || 'Fehler beim Löschen der Notiz', 'error');
    } finally {
      setOperationLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  // Notiz aktualisieren
  const updateNote = async (id, updatedData) => {
    setOperationLoading(prev => ({ ...prev, [id]: 'update' }));
    try {
      const response = await notesAPI.update(id, updatedData);
      setNotes(notes.map(note => note._id === id ? response : note));
      showToast('Notiz aktualisiert', 'success');
    } catch (error) {
      console.error('Fehler beim Aktualisieren der Notiz:', error);
      showToast(error.message || 'Fehler beim Aktualisieren der Notiz', 'error');
    } finally {
      setOperationLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  // Notiz anheften/abheften
  const togglePinNote = async (id) => {
    setOperationLoading(prev => ({ ...prev, [id]: 'pin' }));
    try {
      const response = await notesAPI.togglePin(id);
      setNotes(notes.map(note => note._id === id ? response : note));
      const message = response.isPinned ? 'Notiz angeheftet' : 'Notiz abgeheftet';
      showToast(message, 'success');
    } catch (error) {
      console.error('Fehler beim Anheften der Notiz:', error);
      showToast(error.message || 'Fehler beim Anheften der Notiz', 'error');
    } finally {
      setOperationLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  // Suche durchführen
  const handleSearch = (search) => {
    setSearchTerm(search);
    fetchNotes(search);
  };

  // Theme umschalten
  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Ctrl/Cmd + N: Neue Notiz (Fokus auf Formular)
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        noteFormRef.current?.focus();
      }

      // Ctrl/Cmd + F: Suche
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchBarRef.current?.focus();
      }

      // Ctrl/Cmd + K: Theme Toggle
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleTheme();
      }

      // Ctrl/Cmd + Shift + L: Logout
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        handleLogout();
      }
    };

    if (isLoggedIn) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isLoggedIn, isDarkMode]);

  // Extract all unique tags from notes with counts
  const allTags = useMemo(() => {
    const tagMap = {};
    notes.forEach(note => {
      if (note.tags && Array.isArray(note.tags)) {
        note.tags.forEach(tag => {
          if (tag) {
            tagMap[tag] = (tagMap[tag] || 0) + 1;
          }
        });
      }
    });
    return Object.entries(tagMap)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [notes]);

  // Filter notes by selected tag and separate into pinned/other categories
  const { pinnedNotes, otherNotes } = useMemo(() => {
    let filtered = selectedTag
      ? notes.filter(note => note.tags && note.tags.includes(selectedTag))
      : notes;

    const pinned = filtered
      .filter(note => note.isPinned)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    const other = filtered
      .filter(note => !note.isPinned)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    return { pinnedNotes: pinned, otherNotes: other };
  }, [notes, selectedTag]);

  // Auth handlers
  const handleLogin = async (email, password) => {
    await login(email, password);
    showToast('Erfolgreich angemeldet', 'success');
  };

  const handleRegister = async (username, email, password) => {
    await register(username, email, password);
    showToast('Erfolgreich registriert', 'success');
  };

  const handleSetup = async (username, email, password) => {
    await setup(username, email, password);
    showToast('Administrator-Konto erfolgreich erstellt', 'success');
  };

  const handleLogout = () => {
    logout();
    setNotes([]);
    showToast('Erfolgreich abgemeldet', 'info');
  };

  // Show loading screen while checking auth
  if (authLoading) {
    return (
      <div className="auth-loading">
        <div className="loading-spinner"></div>
        <p>Lade...</p>
      </div>
    );
  }

  // Show setup if initial setup is needed
  if (setupNeeded) {
    return (
      <>
        <ThemeToggle isDarkMode={isDarkMode} onToggle={toggleTheme} />
        <Setup onSetup={handleSetup} />
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </>
    );
  }

  // Show login/register if not authenticated
  if (!isLoggedIn) {
    return (
      <>
        <ThemeToggle isDarkMode={isDarkMode} onToggle={toggleTheme} />
        {showRegister ? (
          <Register
            onRegister={handleRegister}
            onSwitchToLogin={() => setShowRegister(false)}
          />
        ) : (
          <Login
            onLogin={handleLogin}
            onSwitchToRegister={() => setShowRegister(true)}
          />
        )}
        {toast && (
          <Toast
            message={toast.message}
            type={toast.type}
            onClose={() => setToast(null)}
          />
        )}
      </>
    );
  }

  // Main app (authenticated)
  return (
    <div className="App">
      <header className="App-header">
        <div className="header-content">
          <Logo size={36} />
          <SearchBar
            onSearch={handleSearch}
            ref={searchBarRef}
            aria-label="Notizen durchsuchen"
          />
          <div className="user-info">
            {user?.isAdmin ? (
              <button
                className="user-name clickable"
                onClick={() => setShowAdminConsole(true)}
                title={`${user?.email} (Admin - Klicken für Admin-Panel)`}
                aria-label="Admin-Panel öffnen"
              >
                👤 {user?.username}
              </button>
            ) : (
              <span className="user-name" title={user?.email}>
                👤 {user?.username}
              </span>
            )}
            <button
              onClick={handleLogout}
              className="btn-logout"
              title="Abmelden"
              aria-label="Abmelden"
            >
              Abmelden
            </button>
          </div>
        </div>
      </header>

      <div className="App-container">
        <Sidebar
          allTags={allTags}
          selectedTag={selectedTag}
          onTagSelect={setSelectedTag}
          noteCount={notes.length}
          isAdmin={user?.isAdmin}
          onAdminClick={() => setShowAdminConsole(true)}
        />

        <main className="App-main" role="main">
        <NoteForm
          onCreateNote={createNote}
          ref={noteFormRef}
          loading={operationLoading.create}
          aria-label="Neue Notiz erstellen"
        />

        {loading ? (
          <div className="loading" role="status" aria-live="polite">
            <div className="loading-spinner" aria-hidden="true"></div>
            <p>Lade Notizen...</p>
          </div>
        ) : (
          <>
            {pinnedNotes.length > 0 && (
              <div className="notes-section">
                <h2 className="section-title">ANGEHEFTET</h2>
                <NoteList
                  notes={pinnedNotes}
                  onDeleteNote={deleteNote}
                  onUpdateNote={updateNote}
                  onTogglePin={togglePinNote}
                  operationLoading={operationLoading}
                />
              </div>
            )}
            {otherNotes.length > 0 && (
              <div className="notes-section">
                {pinnedNotes.length > 0 && <h2 className="section-title">ANDERE</h2>}
                <NoteList
                  notes={otherNotes}
                  onDeleteNote={deleteNote}
                  onUpdateNote={updateNote}
                  onTogglePin={togglePinNote}
                  operationLoading={operationLoading}
                />
              </div>
            )}
            {pinnedNotes.length === 0 && otherNotes.length === 0 && !selectedTag && !searchTerm && (
              <div className="empty-state" role="status">
                <p>📝 Keine Notizen vorhanden</p>
                <p className="empty-hint">
                  Erstellen Sie Ihre erste Notiz mit <kbd>Strg+N</kbd>
                </p>
              </div>
            )}
            {pinnedNotes.length === 0 && otherNotes.length === 0 && selectedTag && (
              <div className="empty-state" role="status">
                <p>🏷️ Keine Notizen mit diesem Label</p>
                <p className="empty-hint">
                  Wählen Sie ein anderes Label oder erstellen Sie eine neue Notiz
                </p>
              </div>
            )}
            {pinnedNotes.length === 0 && otherNotes.length === 0 && searchTerm && !selectedTag && (
              <div className="empty-state" role="status">
                <p>🔍 Keine Notizen gefunden</p>
                <p className="empty-hint">
                  Versuchen Sie es mit einem anderen Suchbegriff
                </p>
              </div>
            )}
            {pagination.pages > 1 && (
              <div className="pagination" role="navigation" aria-label="Seitennavigation">
                <button
                  onClick={() => fetchNotes(searchTerm, pagination.page - 1)}
                  disabled={pagination.page === 1}
                  aria-label="Vorherige Seite"
                >
                  ← Zurück
                </button>
                <span aria-current="page">
                  Seite {pagination.page} von {pagination.pages}
                </span>
                <button
                  onClick={() => fetchNotes(searchTerm, pagination.page + 1)}
                  disabled={pagination.page === pagination.pages}
                  aria-label="Nächste Seite"
                >
                  Weiter →
                </button>
              </div>
            )}
          </>
        )}
      </main>
      </div>

      <ThemeToggle
        isDarkMode={isDarkMode}
        onToggle={toggleTheme}
        aria-label={isDarkMode ? 'Zum hellen Modus wechseln' : 'Zum dunklen Modus wechseln'}
      />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}

      {showAdminConsole && user?.isAdmin && (
        <AdminConsole onClose={() => setShowAdminConsole(false)} />
      )}
    </div>
  );
}

// Wrap with AuthProvider
function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App;
