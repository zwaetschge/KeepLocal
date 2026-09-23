import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
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
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LanguageProvider, useLanguage } from './contexts/LanguageContext';
import { SettingsProvider, useSettings } from './contexts/SettingsContext';
import { initializeCSRF, notesAPI } from './services/api';
import { useKeyboardShortcuts, useNotesManager, useFolderFeatures, useOnlineRefresh, useUpdatePrompt } from './hooks';
import OfflineBanner from './components/OfflineBanner';
import BulkActionBar from './components/BulkActionBar';
import FolderScopeBar from './components/FolderScopeBar';
import { applyThemeToDocument, getBrowserPathname } from './utils/browserEnvironment.mjs';

// Code-Splitting (P14): schwere Routen/Modals erst bei Bedarf laden. Nr. 26
// zieht die drei großen Modals nach (NoteModal-CSS: 33 kB im Initial-Chunk).
const AdminConsole = React.lazy(() => import('./components/AdminConsole.jsx'));
const Settings = React.lazy(() => import('./components/Settings.jsx'));
const OAuthCallback = React.lazy(() => import('./components/OAuthCallback.jsx'));
const NoteModal = React.lazy(() => import('./components/NoteModal.jsx'));
const FriendsModal = React.lazy(() => import('./components/FriendsModal.jsx'));
const CollaborateModal = React.lazy(() => import('./components/CollaborateModal.jsx'));

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
  // Theme ist eine Konto-Einstellung (SettingsContext) und folgt damit dem
  // Login statt dem Gerät. v1.10.0: Tag-Farben, gespeicherte Suchen und der
  // Journal-Ordner reisen auf demselben Weg mit.
  const { settings, setTheme, setTagColor, updateSettings, setSavedSearches } = useSettings();
  const theme = settings.theme;

  // Ansichts-/UI-Zustand — Notiz-Zustand und CRUD leben in useNotesManager (P13)
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [showAdminConsole, setShowAdminConsole] = useState(false);
  const [noteModal, setNoteModal] = useState({ isOpen: false, note: null });
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
    createNote, updateNote, updateNoteInline, deleteNote, restoreNote, purgeNote, emptyTrash,
    togglePinNote, toggleArchiveNote, handleNoteShared,
    handleDragStart, handleDragEnd, handleDragOver, handleDrop,
    // v1.10.0: Baum, Ordner-Scope, Mehrfachauswahl, Journal
    noteTree, treeNodes, folderScope, selectedIds, selectFolder, refreshTree, moveNote,
    toggleNoteSelection, clearSelection, bulkSetPinned, bulkArchive, bulkDelete, bulkAddTag, bulkMove,
    manageTag, findOrCreateTodayNote, draggedNoteId, pendingFriendRequests,
  } = useNotesManager({
    api: notesAPI, isLoggedIn, authLoading, showToast, t,
    showArchived, showTrash, selectedTag, searchTerm,
  });

  // Offline war der stillste Zustand der App: Der 60-s-Poll lief mit
  // `silent: true` weiter, Speichern zeigte nur „Error updating note", und die
  // Liste blieb ohne Hinweis stehen. Der Banner macht den Zustand sichtbar, beim
  // Wiederverbinden wird einmal nachgezogen (Logik im Hook, nicht hier).
  const isOnline = useOnlineRefresh({
    enabled: isLoggedIn,
    onReconnect: () => {
      fetchNotes(searchTerm, pagination.page, { background: true, silent: true });
      showToast(t('backOnline'), 'success', { duration: 4000 });
    }
  });
  // PWA-Update-Prompt: Toast mit „Jetzt laden“ statt lautlosem skipWaiting.
  useUpdatePrompt({ showToast, t });

  // Initialize CSRF token on mount
  useEffect(() => {
    initializeCSRF();
  }, []);

  // Theme anwenden (Persistenz übernimmt der SettingsContext)
  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // Nr. 26: Stabile Identitäten — ohne sie läuft React.memo auf Note/NoteList
  // ins Leere, weil AppContent bei jedem Zustands-Tick neue Handler-Objekte
  // erzeugt und die Karten damit trotzdem alle neu rendern.
  const openCollaborateModal = useCallback((note) => {
    setCollaborateNote(note);
    setShowCollaborateModal(true);
  }, []);
  // Ein offener Editor darf nicht von "Neue Notiz" übernommen werden:
  // noteModal.note kippt auf null, während das Formular noch die Werte der
  // geöffneten Notiz zeigt — Speichern würde ein Duplikat anlegen.
  const openNoteModal = useCallback((note = null) => {
    setNoteModal(prev => (prev.isOpen ? prev : { isOpen: true, note }));
  }, []);
  const closeNoteModal = useCallback(() => setNoteModal({ isOpen: false, note: null }), []);
  const handleModalSave = useCallback(async (noteData) => (
    noteModal.note ? updateNote(noteModal.note._id, noteData) : createNote(noteData)
  ), [noteModal.note, updateNote, createNote]);
  const handleSearch = useCallback((search) => setSearchTerm(search), []);

  // Die drei Ansichten (Notizen, Archiv, Papierkorb) schließen sich aus, genau
  // wie ein Tag-Filter den Papierkorb verlässt.
  const selectView = useCallback((view) => {
    setShowTrash(view === 'trash');
    setShowArchived(view === 'archived');
    if (view === 'trash') setSelectedTag(null);
  }, []);
  const handleTagSelect = useCallback((tag) => {
    if (tag) setShowTrash(false);
    setSelectedTag(tag);
  }, []);

  // v1.10.0: Ordner-Baum, Journal, gespeicherte Suchen, Wiki-Links — die
  // Ableitungen und Handler leben im eigenen Hook, damit App.jsx Verdrahtung
  // bleibt (Zeilen-Guard: tests/notesManagerLogic.test.js). Seit v1.16.0 auch
  // die Tag-Pflege inkl. Mitnahme von Tag-Farben und gespeicherten Suchen.
  const {
    folderOptions, wikiNotes, allKnownTags, upcomingReminders,
    handleOpenNoteById, handleOpenToday, handleRunSavedSearch, handleSaveCurrentSearch,
    handleDeleteSavedSearch, handleTagManage, handleFolderDrop, handleDataImported,
  } = useFolderFeatures({
    notes, noteTree, treeNodes, allTags, noteModal,
    findOrCreateTodayNote, moveNote, draggedNoteId, refreshTree, fetchNotes,
    openNoteModal, showToast, t, searchTerm, selectedTag,
    settings, manageTag, updateSettings, setSavedSearches,
    setSearchTerm, setSelectedTag, setShowTrash, setShowArchived,
  });

  // Nr. 26: listActions in useMemo — ein neues Objekt-Literal pro Render hätte
  // die memoisierten Karten bei jedem AppContent-Tick neu gerendert. Muss vor
  // den Early Returns stehen (Hook-Regeln).
  const listActions = useMemo(() => (showTrash
    ? {
      // Im Papierkorb: kein Bearbeiten/Anheften/Teilen — nur Wiederherstellen
      // und endgültiges Löschen.
      onRestoreNote: restoreNote, onPurgeNote: purgeNote,
      operationLoading, inTrash: true,
    }
    : {
      onDeleteNote: deleteNote, onUpdateNote: updateNote, onUpdateInline: updateNoteInline,
      onTogglePin: togglePinNote, onToggleArchive: toggleArchiveNote,
      onOpenCollaborate: user?.isDemo ? undefined : openCollaborateModal,
      onOpenModal: openNoteModal,
      onDragStart: handleDragStart, onDragEnd: handleDragEnd,
      onDragOver: handleDragOver, onDrop: handleDrop,
      // v1.10.0: Mehrfachauswahl (die Karten zeigen die Checkbox, sobald
      // eine Auswahl aktiv ist)
      selectedIds, onToggleSelect: toggleNoteSelection,
      // v1.16.0: Tag-Chips auf den Karten filtern die Liste
      onTagSelect: handleTagSelect,
      tagColors: settings.tagColors,
      highlight: searchTerm,
      operationLoading,
    }), [showTrash, restoreNote, purgeNote, operationLoading, deleteNote, updateNote, updateNoteInline, togglePinNote, toggleArchiveNote, user?.isDemo, openCollaborateModal, openNoteModal, handleDragStart, handleDragEnd, handleDragOver, handleDrop, selectedIds, toggleNoteSelection, handleTagSelect, settings.tagColors, searchTerm]);

  // Theme umschalten: light -> dark -> oled -> eink -> doodle -> light
  const toggleTheme = () => {
    const next = { light: 'dark', dark: 'oled', oled: 'eink', eink: 'doodle', doodle: 'light' };
    setTheme(next[theme] || 'light');
  };

  // Logout — der Notiz-Zustand räumt der Hook beim isLoggedIn-Wechsel selbst ab
  const handleLogout = async () => {
    await logout();
    showToast(t('loggedOut'), 'info');
  };

  useKeyboardShortcuts({
    // v1.16.0: Strg+N reserviert der Browser (Chrome/Edge) — die Seite sieht das
    // keydown nie; nur Strg+Alt+n kommt durch.
    'Ctrl+Alt+n': () => noteFormRef.current?.focus(),
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
      {/* Nr. 28 (Top-30): erster Tab-Stop der App — überspringt Header und
          Sidebar und springt direkt zur Notizliste. */}
      <a className="skip-link" href="#main-content">{t('skipToContent')}</a>
      <header className="App-header">
        <div className="header-content">
          <button
            className="mobile-menu-toggle"
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label={t('openMenu')}
            aria-expanded={isMobileMenuOpen}
            aria-controls="app-sidebar"
          >
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
          noteTree={noteTree} folderScope={folderScope}
          onSelectFolder={selectFolder} onFolderDrop={handleFolderDrop}
          onOpenToday={handleOpenToday}
          savedSearches={settings.savedSearches}
          onRunSavedSearch={handleRunSavedSearch}
          onDeleteSavedSearch={handleDeleteSavedSearch}
          onSaveCurrentSearch={handleSaveCurrentSearch}
          canSaveSearch={Boolean(searchTerm.trim() || selectedTag)}
          tagColors={settings.tagColors}
          onTagColorSelect={setTagColor}
          onTagManage={handleTagManage} tagManageBusy={Boolean(operationLoading.bulk)}
          pendingFriendRequests={pendingFriendRequests} upcomingReminders={upcomingReminders} onOpenReminder={handleOpenNoteById}
        />

        {/* tabIndex=-1 (Skip-Link-Standard): Fragment-Ziel sonst ohne echten Fokus. */}
        <main id="main-content" tabIndex={-1} className="App-main" role="main" aria-busy={refreshing}
          style={refreshing ? REFRESHING_STYLE : undefined}>
          {!isOnline && (
            <OfflineBanner onRetry={() => fetchNotes(searchTerm, pagination.page, { background: true })} />
          )}
          {showTrash ? (
            <TrashHeader
              count={noteCounts.trash}
              busy={operationLoading.trash}
              onEmpty={emptyTrash}
            />
          ) : (
            <>
              {/* v1.10.0: aktiver Ordner-Scope als Breadcrumb — ein Klick auf ×
                  zeigt wieder alle Notizen. */}
              {folderScope && (
                <FolderScopeBar
                  title={folderScope === 'root' ? t('topLevel') : (treeNodes[folderScope]?.title || t('untitledNote'))}
                  onClear={() => selectFolder(folderScope)}
                />
              )}
              <NoteForm onOpenModal={() => openNoteModal()} ref={noteFormRef} />
            </>
          )}

          {/* v1.10.0: Mehrfachauswahl — Aktionsleiste über der Liste */}
          {!showTrash && selectedIds.size > 0 && (
            <BulkActionBar
              count={selectedIds.size}
              busy={Boolean(operationLoading.bulk)}
              folders={folderOptions}
              onPin={() => bulkSetPinned(true)}
              onUnpin={() => bulkSetPinned(false)}
              onArchive={bulkArchive}
              onDelete={bulkDelete}
              onAddTag={bulkAddTag}
              onMove={bulkMove}
              onCancel={clearSelection}
            />
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
        <Suspense fallback={LAZY_FALLBACK}>
          <NoteModal
            note={noteModal.note}
            serverNote={noteModal.note ? (notes.find(item => item._id === noteModal.note._id) || noteModal.note) : null}
            onSave={handleModalSave} onClose={closeNoteModal} onRestored={() => fetchNotes(searchTerm, pagination.page, { background: true })}
            onToggleArchive={toggleArchiveNote} onDelete={deleteNote}
            onOpenCollaborate={user?.isDemo ? undefined : openCollaborateModal}
            availableTags={allKnownTags}
            wikiNotes={wikiNotes}
            onOpenNote={handleOpenNoteById}
            folders={folderOptions}
            defaultParentId={folderScope && folderScope !== 'root' ? folderScope : null}
          />
        </Suspense>
      )}

      {!user?.isDemo && (
        <Suspense fallback={LAZY_FALLBACK}>
          <FriendsModal isOpen={showFriendsModal} onClose={() => setShowFriendsModal(false)}
            isAdmin={user?.isAdmin}
            onFriendsChanged={() => fetchNotes(searchTerm, pagination.page, { background: true })} />
          <CollaborateModal isOpen={showCollaborateModal} onClose={() => setShowCollaborateModal(false)}
            note={collaborateNote} onNoteUpdate={handleNoteShared} />
        </Suspense>
      )}

      {showSettings && !user?.isDemo && (
        <Suspense fallback={LAZY_FALLBACK}>
          <Settings onClose={() => setShowSettings(false)} isAdmin={user?.isAdmin}
            onAdminClick={() => setShowAdminConsole(true)}
            folders={folderOptions} onDataImported={handleDataImported} />
        </Suspense>
      )}

    </div>
  );
}

// Wrap with providers
function App() {
  return (
    <AuthProvider>
      {/* LanguageProvider sits inside AuthProvider so it can adopt and persist
          the account language; ToastStack needs the language context. */}
      <LanguageProvider>
        <ToastStack /> {/* single app-wide toastBus host; claim mechanism dedupes */}
        <SettingsProvider>
          <AppContent />
        </SettingsProvider>
      </LanguageProvider>
    </AuthProvider>
  );
}

export default App;
