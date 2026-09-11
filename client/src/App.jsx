import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import './App.css';
import './DoodleTheme.css';
import NoteForm from './components/NoteForm';
import { NotesSkeleton, EmptyState, NotesSection, TrashHeader } from './components/AppStates';
import SearchBar from './components/SearchBar';
import Sidebar from './components/Sidebar';
import ThemeToggle from './components/ThemeToggle';
import ToastStack, { toastBus } from './components/ToastStack';
import Login from './components/Login';
import Register from './components/Register';
import Setup from './components/Setup';
import Logo from './components/Logo';
import NoteModal from './components/NoteModal';
import FriendsModal from './components/FriendsModal';
import CollaborateModal from './components/CollaborateModal';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { initializeCSRF, notesAPI } from './services/api';
import { useKeyboardShortcuts, useNotesManager } from './hooks';
import { readLocalStorage, writeLocalStorage } from './utils/localStorage.mjs';
import { applyThemeToDocument, getBrowserPathname } from './utils/browserEnvironment.mjs';

// Code-Splitting (P14): schwere Routen/Modals erst bei Bedarf laden
const AdminConsole = React.lazy(() => import('./components/AdminConsole.jsx'));
const Settings = React.lazy(() => import('./components/Settings.jsx'));
const OAuthCallback = React.lazy(() => import('./components/OAuthCallback.jsx'));

const THEMES = new Set(['light', 'dark', 'oled', 'eink', 'doodle']);

// Inline-Styles (App.css bleibt bei diesem Refactoring unangetastet)
const REFRESHING_STYLE = { opacity: 0.6, transition: 'opacity 0.2s ease' };
const SESSION_BANNER_STYLE = {
  maxWidth: '420px', margin: '0 auto 16px', padding: '12px 16px', textAlign: 'center',
  borderRadius: 'var(--radius-md, 8px)', border: '1px solid var(--error-color, #DC2626)',
  background: 'var(--bg-secondary, #f6f5f2)', color: 'var(--text-primary, inherit)', fontSize: '0.95rem',
};
// Ladeindikator für lazy Routen/Modals (Suspense-Fallback)
const LAZY_FALLBACK = (
  <div className="loading" role="status" aria-live="polite"><div className="loading-spinner" aria-hidden="true"></div></div>
);

function AppContent() {
  const {
    user, isLoggedIn, loading: authLoading, setupNeeded, sessionExpired,
    login, demoLogin, register, logout, setup, completeOAuthLogin,
  } = useAuth();
  const { t } = useLanguage();

  // Ansichts-/UI-Zustand — Notiz-Zustand und CRUD leben in useNotesManager (P13)
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [showAdminConsole, setShowAdminConsole] = useState(false);
  const [noteModal, setNoteModal] = useState({ isOpen: false, note: null });
  const [theme, setTheme] = useState(() => {
    const savedTheme = readLocalStorage('theme');
    return THEMES.has(savedTheme) ? savedTheme : 'light';
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showTrash, setShowTrash] = useState(false);
  const [showFriendsModal, setShowFriendsModal] = useState(false);
  const [showCollaborateModal, setShowCollaborateModal] = useState(false);
  const [collaborateNote, setCollaborateNote] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  // Der OAuth-Callback bleibt sichtbar, bis die Session geladen ist: nach dem
  // history.replaceState('/') würde sonst für die Dauer von /api/auth/me das
  // Login-Formular aufblitzen.
  const [oauthCallback, setOauthCallback] = useState(() => getBrowserPathname() === '/oauth/callback');

  const noteFormRef = useRef(null);
  const searchBarRef = useRef(null);

  // Stabil, damit der Fetch-Effekt im Hook nicht bei jedem Render neu triggert.
  // Meldungen laufen über den toastBus: <ToastStack /> (App-Root) rendert die
  // Queue als Portal, jede Meldung behält ihren eigenen Timer und geht nicht
  // verloren, wenn kurz darauf die nächste kommt.
  const showToast = useCallback((message, type = 'info', options = null) => {
    toastBus.publish(message, type, options?.duration, options?.action);
  }, []);

  const {
    notes, loading, refreshing, pagination, noteCounts, allTags, operationLoading,
    pinnedNotes, otherNotes, emptyStateReason, fetchNotes,
    createNote, updateNote, deleteNote, restoreNote, purgeNote, emptyTrash,
    togglePinNote, toggleArchiveNote, handleNoteShared,
    handleDragStart, handleDragEnd, handleDragOver, handleDrop,
  } = useNotesManager({
    api: notesAPI, isLoggedIn, authLoading, showToast, t,
    showArchived, showTrash, selectedTag, searchTerm,
  });

  // Initialize CSRF token on mount
  useEffect(() => {
    initializeCSRF();
  }, []);

  // Theme anwenden
  useEffect(() => {
    applyThemeToDocument(theme);
    writeLocalStorage('theme', theme);
  }, [theme]);

  const openCollaborateModal = (note) => {
    setCollaborateNote(note);
    setShowCollaborateModal(true);
  };
  // Ein offener Editor darf nicht von "Neue Notiz" (Button oder Ctrl+N)
  // übernommen werden: noteModal.note kippt auf null, während das Formular noch
  // die Werte der geöffneten Notiz zeigt — Speichern würde dann ein Duplikat
  // anlegen statt die Notiz zu aktualisieren.
  const openNoteModal = (note = null) => setNoteModal(prev => (prev.isOpen ? prev : { isOpen: true, note }));
  const closeNoteModal = () => setNoteModal({ isOpen: false, note: null });
  const handleModalSave = async (noteData) => (
    noteModal.note ? updateNote(noteModal.note._id, noteData) : createNote(noteData)
  );
  const handleSearch = (search) => setSearchTerm(search);

  // Die drei Ansichten (Notizen, Archiv, Papierkorb) schließen sich aus, genau
  // wie ein Tag-Filter den Papierkorb verlässt.
  const selectView = (view) => {
    setShowTrash(view === 'trash');
    setShowArchived(view === 'archived');
    if (view === 'trash') setSelectedTag(null);
  };
  const handleTagSelect = (tag) => {
    if (tag) setShowTrash(false);
    setSelectedTag(tag);
  };

  // Theme umschalten: light -> dark -> oled -> eink -> doodle -> light
  const toggleTheme = () => {
    setTheme(prevTheme => {
      if (prevTheme === 'light') return 'dark';
      if (prevTheme === 'dark') return 'oled';
      if (prevTheme === 'oled') return 'eink';
      if (prevTheme === 'eink') return 'doodle';
      if (prevTheme === 'doodle') return 'light';
      return 'light';
    });
  };

  // Logout — der Notiz-Zustand räumt der Hook beim isLoggedIn-Wechsel selbst ab
  const handleLogout = async () => {
    await logout();
    showToast(t('loggedOut'), 'info');
  };

  useKeyboardShortcuts({
    'Ctrl+n': () => noteFormRef.current?.focus(),
    'Ctrl+f': () => searchBarRef.current?.focus(),
    'Ctrl+k': toggleTheme,
    'Ctrl+Shift+L': () => handleLogout(),
  }, isLoggedIn);

  const handleLogin = async (email, password) => { await login(email, password); showToast(t('loggedIn'), 'success'); };
  const handleDemoLogin = async () => { await demoLogin(); showToast(t('loginSuccess'), 'success'); };
  const handleRegister = async (username, email, password) => { await register(username, email, password); showToast(t('registerSuccess'), 'success'); };
  const handleSetup = async (username, email, password) => { await setup(username, email, password); showToast(t('adminAccountCreated'), 'success'); };

  // Handle OAuth callback route
  if (oauthCallback) {
    return (
      <Suspense fallback={<NotesSkeleton />}>
        <OAuthCallback
          onOAuthSuccess={async () => {
            try {
              await completeOAuthLogin();
              setOauthCallback(false);
              showToast(t('loginSuccess'), 'success');
            } catch {
              setOauthCallback(false);
              showToast(t('oauthFailed'), 'error');
            }
          }}
        />
      </Suspense>
    );
  }

  // Show loading screen while checking auth
  if (authLoading) {
    return (
      <div className="auth-loading">
        <div className="loading-spinner"></div><p>{t('loadingApp')}</p>
      </div>
    );
  }

  // Show setup if initial setup is needed
  if (setupNeeded) {
    return (
      <>
        <div className="floating-controls"><ThemeToggle theme={theme} onToggle={toggleTheme} /></div>
        <Setup onSetup={handleSetup} />
      </>
    );
  }

  // Show login/register if not authenticated
  if (!isLoggedIn) {
    return (
      <>
        <div className="floating-controls"><ThemeToggle theme={theme} onToggle={toggleTheme} /></div>
        {sessionExpired && (
          <div className="session-expired-banner" role="alert" style={SESSION_BANNER_STYLE}>
            {t('sessionExpired')}
          </div>
        )}
        {showRegister ? (
          <Register onRegister={handleRegister} onSwitchToLogin={() => setShowRegister(false)} />
        ) : (
          <Login onLogin={handleLogin} onDemoLogin={handleDemoLogin}
            onSwitchToRegister={() => setShowRegister(true)} />
        )}
      </>
    );
  }

  // Main app (authenticated)
  const listActions = showTrash
    ? {
      // Im Papierkorb gibt es kein Bearbeiten, kein Anheften und kein Teilen —
      // nur Wiederherstellen und endgültiges Löschen.
      onRestoreNote: restoreNote, onPurgeNote: purgeNote,
      operationLoading, inTrash: true,
    }
    : {
      onDeleteNote: deleteNote, onUpdateNote: updateNote,
      onTogglePin: togglePinNote, onToggleArchive: toggleArchiveNote,
      onOpenCollaborate: user?.isDemo ? undefined : openCollaborateModal,
      onOpenModal: openNoteModal,
      onDragStart: handleDragStart, onDragEnd: handleDragEnd,
      onDragOver: handleDragOver, onDrop: handleDrop,
      operationLoading,
    };
  const emptyStateContent = showTrash
    ? (pinnedNotes.length === 0 && otherNotes.length === 0
      ? { emoji: '🗑️', title: t('trashEmpty'), hint: t('trashEmptyHint') }
      : null)
    : {
      noNotes: { emoji: '📝', title: t('noNotesAvailable'), hint: t('createFirstNote'), kbd: true },
      noTagResults: { emoji: '🏷️', title: t('noNotesWithTag'), hint: t('selectOtherTagOrCreate') },
      noSearchResults: { emoji: '🔍', title: t('noNotesFound'), hint: t('tryDifferentSearch') },
    }[emptyStateReason];

  return (
    <div className="App">
      <header className="App-header">
        <div className="header-content">
          <button className="mobile-menu-toggle" onClick={() => setIsMobileMenuOpen(true)} aria-label={t('openMenu')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18"/>
            </svg>
          </button>
          <Logo size={36} />
          <SearchBar onSearch={handleSearch} ref={searchBarRef} aria-label={t('searchNotes')} />
          <div className="user-info">
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
            {user?.isDemo ? (
              <div className="demo-user-identity" title={t('demoBannerTitle')}>
                <svg className="demo-user-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <circle cx="12" cy="8" r="4"/>
                  <path d="M4 21a8 8 0 0116 0"/>
                </svg>
                <span className="user-name">{user?.username}</span>
                <span className="demo-user-badge">{t('demoBadge')}</span>
              </div>
            ) : (
              <button className="user-name clickable" onClick={() => setShowSettings(true)}
                title={`${user?.email}${user?.isAdmin ? ` (${t('admin')})` : ''}`}
                aria-label={t('settings')}>
                👤 {user?.username}
              </button>
            )}
            <button onClick={handleLogout} className="btn-logout" title={t('logout')} aria-label={t('logout')}>
              {t('logout')}
            </button>
          </div>
        </div>
      </header>

      {user?.isDemo && (
        <section className="demo-banner" aria-label={t('demoBannerTitle')}>
          <strong>{t('demoBannerTitle')}</strong>
          <span>{t('demoBannerPrivacy')}</span>
          <span>{t('demoBannerRestrictions')}</span>
          <span>{t('demoBannerReset')}</span>
        </section>
      )}

      <div className="App-container">
        <Sidebar
          allTags={allTags} selectedTag={selectedTag} onTagSelect={handleTagSelect}
          noteCount={noteCounts.active}
          onSettingsClick={user?.isDemo ? undefined : () => setShowSettings(true)}
          user={user} onLogout={handleLogout} theme={theme} onThemeToggle={toggleTheme}
          isMobileOpen={isMobileMenuOpen} onMobileClose={() => setIsMobileMenuOpen(false)}
          archivedCount={noteCounts.archived} showArchived={showArchived}
          onShowArchivedToggle={() => selectView(showArchived ? 'notes' : 'archived')}
          onShowNotes={() => selectView('notes')}
          trashCount={noteCounts.trash} showTrash={showTrash}
          onShowTrashToggle={() => selectView(showTrash ? 'notes' : 'trash')}
          onEmptyTrash={emptyTrash}
          onOpenFriends={user?.isDemo ? undefined : () => setShowFriendsModal(true)}
        />

        <main className="App-main" role="main" aria-busy={refreshing}
          style={refreshing ? REFRESHING_STYLE : undefined}>
          {showTrash ? (
            <TrashHeader
              count={noteCounts.trash}
              busy={operationLoading.trash}
              onEmpty={emptyTrash}
            />
          ) : (
            <NoteForm onOpenModal={() => openNoteModal()} ref={noteFormRef} />
          )}

          {/* P15b: erster Load zeigt Skeletons; Hintergrund-Refresh dimmt die Liste nur */}
          {loading && notes.length === 0 ? (
            <NotesSkeleton />
          ) : (
            <>
              {pinnedNotes.length > 0 && (
                <NotesSection title={t('pinnedSection')} notes={pinnedNotes} actions={listActions} />
              )}
              {otherNotes.length > 0 && (
                <NotesSection title={pinnedNotes.length > 0 ? t('otherSection') : null}
                  notes={otherNotes} actions={listActions} />
              )}
              {emptyStateContent && (
                <EmptyState emoji={emptyStateContent.emoji} title={emptyStateContent.title}
                  hint={emptyStateContent.hint} kbd={emptyStateContent.kbd} />
              )}
              {pagination.pages > 1 && (
                <div className="pagination" role="navigation" aria-label={t('paginationNavigation')}>
                  <button onClick={() => fetchNotes(searchTerm, pagination.page - 1, { background: true })}
                    disabled={pagination.page === 1} aria-label={t('previousPageAria')}>
                    ← {t('previousPage')}
                  </button>
                  <span aria-current="page">{t('pageLabel')} {pagination.page} {t('pageOf')} {pagination.pages}</span>
                  <button onClick={() => fetchNotes(searchTerm, pagination.page + 1, { background: true })}
                    disabled={pagination.page === pagination.pages} aria-label={t('nextPageAria')}>
                    {t('nextPage')} →
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      <ThemeToggle theme={theme} onToggle={toggleTheme} aria-label={t('toggleTheme')} />

      {showAdminConsole && user?.isAdmin && !user?.isDemo && (
        <Suspense fallback={LAZY_FALLBACK}>
          <AdminConsole onClose={() => setShowAdminConsole(false)} />
        </Suspense>
      )}
      {noteModal.isOpen && (
        <NoteModal
          note={noteModal.note} onSave={handleModalSave} onClose={closeNoteModal}
          onToggleArchive={toggleArchiveNote} onDelete={deleteNote}
          onOpenCollaborate={user?.isDemo ? undefined : openCollaborateModal}
        />
      )}

      {!user?.isDemo && (
        <>
          <FriendsModal isOpen={showFriendsModal} onClose={() => setShowFriendsModal(false)}
            isAdmin={user?.isAdmin} />
          <CollaborateModal isOpen={showCollaborateModal} onClose={() => setShowCollaborateModal(false)}
            note={collaborateNote} onNoteUpdate={handleNoteShared} />
        </>
      )}

      {showSettings && !user?.isDemo && (
        <Suspense fallback={LAZY_FALLBACK}>
          <Settings onClose={() => setShowSettings(false)} isAdmin={user?.isAdmin}
            onAdminClick={() => setShowAdminConsole(true)} />
        </Suspense>
      )}

    </div>
  );
}

// Wrap with providers
function App() {
  return (
    <LanguageProvider>
      <ToastStack /> {/* single app-wide toastBus host; claim mechanism dedupes */}
      <AuthProvider>
        <SettingsProvider>
          <AppContent />
        </SettingsProvider>
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;
