import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './App.css';
import NoteForm from './components/NoteForm';
import NoteList from './components/NoteList';
import SearchBar from './components/SearchBar';
import Sidebar from './components/Sidebar';
import ThemeToggle from './components/ThemeToggle';
import LanguageSelector from './components/LanguageSelector';
import Toast from './components/Toast';
import Login from './components/Login';
import Register from './components/Register';
import Setup from './components/Setup';
import AdminConsole from './components/AdminConsole';
import Logo from './components/Logo';
import NoteModal from './components/NoteModal';
import FriendsModal from './components/FriendsModal';
import CollaborateModal from './components/CollaborateModal';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { initializeCSRF, notesAPI } from './services/api';
import { useKeyboardShortcuts } from './hooks';

function AppContent() {
  const { user, isLoggedIn, loading: authLoading, setupNeeded, login, register, logout, setup } = useAuth();
  const { t } = useLanguage();
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);
  const [toast, setToast] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [showAdminConsole, setShowAdminConsole] = useState(false);
  const [noteModal, setNoteModal] = useState({ isOpen: false, note: null });
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [operationLoading, setOperationLoading] = useState({});
  const [theme, setTheme] = useState(() => {
    const savedTheme = localStorage.getItem('theme');
    return savedTheme || 'light'; // 'light', 'dark', or 'oled'
  });
  const [draggedNoteId, setDraggedNoteId] = useState(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [showCollaborateModal, setShowCollaborateModal] = useState(false);
  const [collaborateNote, setCollaborateNote] = useState(null);

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

  // Theme anwenden
  useEffect(() => {
    // Remove all theme classes
    document.body.classList.remove('dark-mode', 'oled-mode');

    // Add appropriate theme class
    if (theme === 'dark') {
      document.body.classList.add('dark-mode');
    } else if (theme === 'oled') {
      document.body.classList.add('oled-mode');
    }

    localStorage.setItem('theme', theme);
  }, [theme]);

  // Notizen vom Server laden
  const fetchNotes = useCallback(async (search = '', page = 1) => {
    if (!isLoggedIn) return;

    try {
      setLoading(true);
      const params = {
        page,
        limit: 50,
        archived: showArchived ? 'true' : 'false'
      };
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
  }, [isLoggedIn, showToast, showArchived]);

  // Notizen laden wenn eingeloggt oder showArchived ändert
  useEffect(() => {
    if (isLoggedIn && !authLoading) {
      fetchNotes();
    }
  }, [isLoggedIn, authLoading, showArchived, fetchNotes]);

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
      const message = response.isPinned ? t('notePinned') : t('noteUnpinned');
      showToast(message, 'success');
    } catch (error) {
      console.error('Fehler beim Anheften der Notiz:', error);
      showToast(error.message || 'Fehler beim Anheften der Notiz', 'error');
    } finally {
      setOperationLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  // Notiz archivieren/dearchivieren
  const toggleArchiveNote = async (id) => {
    setOperationLoading(prev => ({ ...prev, [id]: 'archive' }));
    try {
      const response = await notesAPI.toggleArchive(id);
      const message = response.isArchived ? t('noteArchived') : t('noteUnarchived');
      showToast(message, 'success');

      // Notiz aus der Liste entfernen wenn sie archiviert/dearchiviert wird
      // und wir nicht in der entsprechenden Ansicht sind
      if (response.isArchived && !showArchived) {
        setNotes(notes.filter(note => note._id !== id));
      } else if (!response.isArchived && showArchived) {
        setNotes(notes.filter(note => note._id !== id));
      } else {
        setNotes(notes.map(note => note._id === id ? response : note));
      }
    } catch (error) {
      console.error('Fehler beim Archivieren der Notiz:', error);
      showToast(error.message || t('errorUpdating'), 'error');
    } finally {
      setOperationLoading(prev => ({ ...prev, [id]: false }));
    }
  };

  // Collaborate Modal öffnen
  const openCollaborateModal = (note) => {
    setCollaborateNote(note);
    setShowCollaborateModal(true);
  };

  // Wenn eine Notiz geteilt wurde, aktualisieren
  const handleNoteShared = (updatedNote) => {
    setNotes(notes.map(note => note._id === updatedNote._id ? updatedNote : note));
  };

  // Modal handlers
  const openNoteModal = (note = null) => {
    setNoteModal({ isOpen: true, note });
  };

  const closeNoteModal = () => {
    setNoteModal({ isOpen: false, note: null });
  };

  const handleModalSave = async (noteData) => {
    if (noteModal.note) {
      // Update existing note
      await updateNote(noteModal.note._id, noteData);
    } else {
      // Create new note
      await createNote(noteData);
    }
  };

  // Drag & Drop Handlers
  const handleDragStart = (noteId, e) => {
    setDraggedNoteId(noteId);
  };

  const handleDragEnd = (e) => {
    setDraggedNoteId(null);
  };

  const handleDragOver = (noteId, e) => {
    // Allow drop
  };

  const handleDrop = async (targetNoteId, e) => {
    if (!draggedNoteId || draggedNoteId === targetNoteId) {
      return;
    }

    // Find the dragged note and target note
    const draggedNote = notes.find(n => n._id === draggedNoteId);
    const targetNote = notes.find(n => n._id === targetNoteId);

    if (!draggedNote || !targetNote) {
      return;
    }

    // If dropped in different section, toggle pin status
    if (draggedNote.isPinned !== targetNote.isPinned) {
      await togglePinNote(draggedNoteId);
      showToast(
        targetNote.isPinned ? t('noteWasPinned') : t('noteWasUnpinned'),
        'success'
      );
      return;
    }

    // Reorder notes array within same section
    const newNotes = [...notes];
    const draggedIndex = newNotes.findIndex(n => n._id === draggedNoteId);
    const targetIndex = newNotes.findIndex(n => n._id === targetNoteId);

    // Remove dragged note and insert at target position
    const [removed] = newNotes.splice(draggedIndex, 1);
    newNotes.splice(targetIndex, 0, removed);

    setNotes(newNotes);
    setDraggedNoteId(null);
  };

  // Suche durchführen
  const handleSearch = (search) => {
    setSearchTerm(search);
    fetchNotes(search);
  };

  // Theme umschalten
  const toggleTheme = () => {
    // Cycle through themes: light -> dark -> oled -> light
    setTheme(prevTheme => {
      if (prevTheme === 'light') return 'dark';
      if (prevTheme === 'dark') return 'oled';
      return 'light';
    });
  };

  // Logout handler
  const handleLogout = () => {
    logout();
    setNotes([]);
    showToast('Erfolgreich abgemeldet', 'info');
  };

  // Keyboard shortcuts
  useKeyboardShortcuts(
    {
      'Ctrl+n': () => noteFormRef.current?.focus(),
      'Ctrl+f': () => searchBarRef.current?.focus(),
      'Ctrl+k': toggleTheme,
      'Ctrl+Shift+L': () => handleLogout(),
    },
    isLoggedIn
  );

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

  // Count archived notes (shows count when in normal view, 0 when in archived view)
  const archivedCount = showArchived ? 0 : pagination.total;

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
        <div className="floating-controls">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <LanguageSelector />
        </div>
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
        <div className="floating-controls">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <LanguageSelector />
        </div>
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
          <button
            className="mobile-menu-toggle"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Menu"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18"/>
            </svg>
          </button>
          <Logo size={36} />
          <SearchBar
            onSearch={handleSearch}
            ref={searchBarRef}
            aria-label={t('searchNotes')}
          />
          <div className="user-info">
            <LanguageSelector />
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            {user?.isAdmin ? (
              <button
                className="user-name clickable"
                onClick={() => setShowAdminConsole(true)}
                title={`${user?.email} (${t('admin')} - ${t('openAdminPanel')})`}
                aria-label={t('openAdminPanel')}
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
              title={t('logout')}
              aria-label={t('logout')}
            >
              {t('logout')}
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
          user={user}
          onLogout={handleLogout}
          theme={theme}
          onThemeToggle={toggleTheme}
          isMobileOpen={isMobileMenuOpen}
          onMobileClose={() => setIsMobileMenuOpen(false)}
          archivedCount={archivedCount}
          showArchived={showArchived}
          onShowArchivedToggle={() => setShowArchived(!showArchived)}
          onOpenFriends={() => setShowFriendsModal(true)}
        />

        <main className="App-main" role="main">
        <NoteForm
          onOpenModal={() => openNoteModal()}
          ref={noteFormRef}
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
                <h2 className="section-title">{t('pinnedSection')}</h2>
                <NoteList
                  notes={pinnedNotes}
                  onDeleteNote={deleteNote}
                  onUpdateNote={updateNote}
                  onTogglePin={togglePinNote}
                  onToggleArchive={toggleArchiveNote}
                  onOpenCollaborate={openCollaborateModal}
                  onOpenModal={openNoteModal}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  operationLoading={operationLoading}
                />
              </div>
            )}
            {otherNotes.length > 0 && (
              <div className="notes-section">
                {pinnedNotes.length > 0 && <h2 className="section-title">{t('otherSection')}</h2>}
                <NoteList
                  notes={otherNotes}
                  onDeleteNote={deleteNote}
                  onUpdateNote={updateNote}
                  onTogglePin={togglePinNote}
                  onToggleArchive={toggleArchiveNote}
                  onOpenCollaborate={openCollaborateModal}
                  onOpenModal={openNoteModal}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  operationLoading={operationLoading}
                />
              </div>
            )}
            {pinnedNotes.length === 0 && otherNotes.length === 0 && !selectedTag && !searchTerm && (
              <div className="empty-state" role="status">
                <p>📝 {t('noNotesAvailable')}</p>
                <p className="empty-hint">
                  {t('createFirstNote')} <kbd>Strg+N</kbd>
                </p>
              </div>
            )}
            {pinnedNotes.length === 0 && otherNotes.length === 0 && selectedTag && (
              <div className="empty-state" role="status">
                <p>🏷️ {t('noNotesWithTag')}</p>
                <p className="empty-hint">
                  {t('selectOtherTagOrCreate')}
                </p>
              </div>
            )}
            {pinnedNotes.length === 0 && otherNotes.length === 0 && searchTerm && !selectedTag && (
              <div className="empty-state" role="status">
                <p>🔍 {t('noNotesFound')}</p>
                <p className="empty-hint">
                  {t('tryDifferentSearch')}
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
        theme={theme}
        onToggle={toggleTheme}
        aria-label="Toggle theme"
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

      {noteModal.isOpen && (
        <NoteModal
          note={noteModal.note}
          onSave={handleModalSave}
          onClose={closeNoteModal}
          onToggleArchive={toggleArchiveNote}
          onOpenCollaborate={openCollaborateModal}
        />
      )}

      <FriendsModal
        isOpen={showFriendsModal}
        onClose={() => setShowFriendsModal(false)}
        isAdmin={user?.isAdmin}
      />

      <CollaborateModal
        isOpen={showCollaborateModal}
        onClose={() => setShowCollaborateModal(false)}
        note={collaborateNote}
        onNoteUpdate={handleNoteShared}
      />
    </div>
  );
}

// Wrap with providers
function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;
