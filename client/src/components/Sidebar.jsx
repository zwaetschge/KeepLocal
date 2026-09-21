import React, { useEffect, useRef, useState } from 'react';
import ThemeToggle from './ThemeToggle';
import Logo from './Logo';
import { useLanguage } from '../contexts/LanguageContext';
import './Sidebar.css';

/** Farbauswahl für Tags (v1.10.0) — 12 unterscheidbare Farben, synchronisiert
 *  über die Konto-Preferences (wie die Notizfarben, aber pro Tag-Name). */
export const TAG_COLOR_PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#22c55e', '#14b8a6',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899', '#6b7280'
];

const FOLDER_ICON = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
  </svg>
);

/**
 * Eine Zeile in der Tag-Liste (v1.11.0): Auswahl-Button plus Menü für die
 * Tag-Pflege — Umbenennen, Zusammenführen mit einem anderen Tag oder überall
 * Löschen. Jede Aktion geht als eine Server-Operation über alle sichtbaren
 * Notizen, nicht als Update-Request pro Notiz. Hauptbutton und Menü-Button
 * sind Geschwister (kein Button-in-Button), wie im Ordner-Baum. Löschen
 * fragt zweimal nach (kein window.confirm im Client).
 */
function TagRow({ tag, tagNames, selected, color, busy, onSelect, onManage, onMobileClose, t }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(tag.name);
  const [mergeTarget, setMergeTarget] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const others = tagNames.filter((name) => name !== tag.name);
  const renameValid = /^[a-zA-Z0-9äöüÄÖÜß\-_]{1,50}$/.test(renameValue.trim()) && renameValue.trim() !== tag.name;

  const run = (action, to) => {
    setMenuOpen(false);
    setConfirmDelete(false);
    onManage(action, [tag.name], to);
  };

  return (
    <>
      <div className="sidebar-tag-row">
        <button
          type="button"
          className={`sidebar-item sidebar-tag-main ${selected ? 'active' : ''}`}
          onClick={() => {
            onSelect(tag.name);
            onMobileClose();
          }}
          draggable="true"
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('application/keeplocal-tag', tag.name);
            e.currentTarget.classList.add('dragging');
          }}
          onDragEnd={(e) => {
            e.currentTarget.classList.remove('dragging');
          }}
          aria-label={`Label: ${tag.name}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/>
            <line x1="7" y1="7" x2="7.01" y2="7"/>
          </svg>
          <span>{tag.name}</span>
          {color && <span className="sidebar-tag-dot" style={{ backgroundColor: color }} aria-hidden="true" />}
          <span className="count">{tag.count}</span>
        </button>
        <button
          type="button"
          className="sidebar-tag-menu-toggle"
          onClick={() => {
            setMenuOpen(prev => !prev);
            setConfirmDelete(false);
          }}
          aria-expanded={menuOpen}
          aria-label={t('tagManage', { tag: tag.name })}
          title={t('tagManage', { tag: tag.name })}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="5" r="1"/>
            <circle cx="12" cy="12" r="1"/>
            <circle cx="12" cy="19" r="1"/>
          </svg>
        </button>
      </div>
      {menuOpen && (
        <div className="sidebar-tag-manage" role="group" aria-label={t('tagManage', { tag: tag.name })}>
          <div className="sidebar-tag-manage-row">
            <input
              type="text"
              className="sidebar-tag-rename-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameValid && !busy) run('rename', renameValue.trim());
                if (e.key === 'Escape') setMenuOpen(false);
              }}
              maxLength={50}
              aria-label={t('tagRenameLabel')}
              disabled={busy}
            />
            <button
              type="button"
              className="sidebar-tag-manage-action"
              disabled={!renameValid || busy}
              onClick={() => run('rename', renameValue.trim())}
            >
              {t('tagRenameButton')}
            </button>
          </div>
          {others.length > 0 && (
            <div className="sidebar-tag-manage-row">
              <select
                className="sidebar-tag-merge-select"
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                aria-label={t('tagMergeLabel')}
                disabled={busy}
              >
                <option value="">{t('tagMergePick')}</option>
                {others.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
              <button
                type="button"
                className="sidebar-tag-manage-action"
                disabled={!mergeTarget || busy}
                onClick={() => run('merge', mergeTarget)}
              >
                {t('tagMergeButton')}
              </button>
            </div>
          )}
          <button
            type="button"
            className={`sidebar-tag-manage-delete ${confirmDelete ? 'confirm' : ''}`}
            disabled={busy}
            onClick={() => (confirmDelete ? run('delete') : setConfirmDelete(true))}
          >
            {confirmDelete ? t('tagDeleteConfirm') : t('tagDeleteButton', { count: tag.count })}
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Eine Zeile im Ordner-Baum (v1.10.0). Jede Notiz mit Kindern ist ein Ordner;
 * Klick scope-t die Liste auf die direkten Kinder, Drop verschiebt die
 * gezogene Notiz hinein. Caret und Zeile sind getrennte Buttons (kein
 * Button-in-Button), der Einzug kommt aus der Tiefe.
 */
function FolderRow({ entry, depth, folderScope, onSelectFolder, onFolderDrop, t }) {
  const { node, children } = entry;
  const [expanded, setExpanded] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const hasChildren = children.length > 0;
  const title = node.title || t('untitledNote');
  const active = folderScope === node.id;

  return (
    <>
      <div className="sidebar-folder-row" style={{ paddingLeft: `${depth * 14}px` }}>
        {hasChildren ? (
          <button
            type="button"
            className={`sidebar-folder-caret ${expanded ? 'open' : ''}`}
            onClick={() => setExpanded(prev => !prev)}
            aria-label={expanded ? t('collapseFolder', { title }) : t('expandFolder', { title })}
            aria-expanded={expanded}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18l6-6-6-6"/>
            </svg>
          </button>
        ) : (
          <span className="sidebar-folder-caret-spacer" aria-hidden="true" />
        )}
        <button
          type="button"
          className={`sidebar-item sidebar-folder ${active ? 'active' : ''} ${dropActive ? 'drop-target' : ''}`}
          onClick={() => onSelectFolder(node.id)}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDropActive(false);
            onFolderDrop(node.id);
          }}
          title={t('moveToFolder', { title })}
          aria-current={active ? 'true' : undefined}
        >
          {FOLDER_ICON}
          <span className="sidebar-folder-title">{title}</span>
          {hasChildren && <span className="count">{children.length}</span>}
        </button>
      </div>
      {expanded && hasChildren && children.map(child => (
        <FolderRow
          key={child.node.id}
          entry={child}
          depth={depth + 1}
          folderScope={folderScope}
          onSelectFolder={onSelectFolder}
          onFolderDrop={onFolderDrop}
          t={t}
        />
      ))}
    </>
  );
}

function Sidebar({
  allTags,
  selectedTag,
  onTagSelect,
  noteCount,
  archivedCount,
  showArchived,
  onShowArchivedToggle,
  trashCount,
  showTrash,
  onShowTrashToggle,
  onShowNotes,
  onOpenFriends,
  onSettingsClick,
  user,
  onLogout,
  theme,
  onThemeToggle,
  isMobileOpen,
  onMobileClose,
  // v1.10.0: Ordner-Baum, Journal, gespeicherte Suchen, Tag-Farben
  noteTree = [],
  folderScope = null,
  onSelectFolder,
  onFolderDrop,
  onOpenToday,
  savedSearches = [],
  onRunSavedSearch,
  onDeleteSavedSearch,
  onSaveCurrentSearch,
  canSaveSearch = false,
  tagColors = {},
  onTagColorSelect,
  // v1.11.0: Tag-Pflege (Umbenennen/Zusammenführen/Löschen) über einen
  // Server-Bulk-Endpoint; tagManageBusy zeigt den laufenden Zustand in der Zeile.
  onTagManage,
  tagManageBusy = false,
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { t } = useLanguage();

  // Nr. 28 (Top-30): der mobile Drawer verhält sich tastaturtechnisch wie ein
  // Dialog — Fokus hinein beim Öffnen, zurück auf den Menü-Button beim
  // Schließen (auch per Escape). Alles nur unterhalb der 768px-Grenze, wo
  // die Sidebar zum off-canvas Drawer wird; am Desktop bleibt sie normal im
  // Fokusfluss.
  const drawerRef = useRef(null);
  const restoreFocusRef = useRef(null);
  const onMobileCloseRef = useRef(onMobileClose);

  useEffect(() => {
    onMobileCloseRef.current = onMobileClose;
  }, [onMobileClose]);

  useEffect(() => {
    if (!isMobileOpen) return undefined;

    const isMobileLayout = window.matchMedia('(max-width: 768px)').matches;
    if (!isMobileLayout) return undefined;

    restoreFocusRef.current = document.activeElement;

    // Nr. 28: Chromium setzt focus() im gleichen Zug wie den Drawer-Öffner
    // gelegentlich stumm außer Kraft — der Aufruf läuft, der Fokus sitzt danach
    // trotzdem noch auf dem Menü-Button (im E2E reproduzierbar, u.a. CI-Flake
    // auf PR #142). Deshalb pro Frame prüfen, ob der Fokus wirklich sitzt, und
    // sonst erneut setzen — begrenzt auf ~1 s und nur, solange der Nutzer den
    // Fokus nicht selbst woandershin bewegt hat.
    const opener = restoreFocusRef.current;
    let retryFrame = 0;
    let attempts = 0;
    const focusFirstInDrawer = () => {
      const drawer = drawerRef.current;
      if (!drawer) return true;
      const current = document.activeElement;
      if (drawer.contains(current)) return true;
      if (current && current !== opener) return true;
      const target = drawer.querySelector('button, a[href]');
      target?.focus();
      return Boolean(target && drawer.contains(document.activeElement));
    };
    const tryFocus = () => {
      if (focusFirstInDrawer() || ++attempts > 60) return;
      retryFrame = requestAnimationFrame(tryFocus);
    };
    tryFocus();

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      // Ein echter Dialog liegt über dem Drawer (z.B. der Admin-Confirm):
      // der gehört dem Dialog, nicht dem Drawer.
      if (document.querySelector('[role="dialog"]')) return;
      event.stopPropagation();
      onMobileCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(retryFrame);
      document.removeEventListener('keydown', handleKeyDown);
      const restore = restoreFocusRef.current;
      if (restore && typeof restore.focus === 'function' && restore.isConnected) {
        restore.focus();
      }
      restoreFocusRef.current = null;
    };
  }, [isMobileOpen]);

  return (
    <>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div className="sidebar-overlay" onClick={onMobileClose} />
      )}

      <aside
        id="app-sidebar"
        ref={drawerRef}
        className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}
      >
      <button
        className="sidebar-toggle"
        onClick={() => setIsCollapsed(!isCollapsed)}
        aria-label={isCollapsed ? t('expandSidebar') || "Sidebar erweitern" : t('collapseSidebar') || "Sidebar minimieren"}
        title={isCollapsed ? t('expand') || "Erweitern" : t('collapse') || "Minimieren"}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {isCollapsed ? (
            <path d="M9 18l6-6-6-6"/>
          ) : (
            <path d="M15 18l-6-6 6-6"/>
          )}
        </svg>
      </button>

      {/* Mobile controls - only visible on mobile */}
      <div className="sidebar-mobile-controls">
        <div className="sidebar-mobile-logo">
          <Logo size={28} />
        </div>

        {user?.isDemo ? (
          <div className="sidebar-mobile-user sidebar-mobile-user-static">
            <svg className="mobile-user-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="8" r="4"/>
              <path d="M4 21a8 8 0 0116 0"/>
            </svg>
            <span className="mobile-user-name">{user?.username}</span>
            <span className="mobile-demo-badge">{t('demoBadge')}</span>
          </div>
        ) : (
          <button
            className="sidebar-mobile-user"
            onClick={() => {
              onSettingsClick();
              onMobileClose();
            }}
            aria-label={t('settings')}
          >
            <span className="mobile-user-icon">👤</span>
            <span className="mobile-user-name">{user?.username}</span>
          </button>
        )}

        <div className="sidebar-mobile-actions">
          <ThemeToggle theme={theme} onToggle={onThemeToggle} />
        </div>

        <button
          className="sidebar-mobile-logout"
          onClick={onLogout}
          aria-label={t('logout')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
          </svg>
          <span>{t('logout')}</span>
        </button>

        <div className="sidebar-divider"></div>
      </div>

      <nav className="sidebar-nav">
        <button
          className={`sidebar-item ${!selectedTag && !showArchived && !showTrash ? 'active' : ''}`}
          onClick={() => {
            onTagSelect(null);
            if (onShowNotes) onShowNotes();
            else if (showArchived) onShowArchivedToggle();
            onMobileClose();
          }}
          aria-label={t('allNotes')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          <span>{t('notes')}</span>
          <span className="count">{noteCount}</span>
        </button>

        <button
          className={`sidebar-item ${showArchived ? 'active' : ''}`}
          onClick={() => {
            onShowArchivedToggle();
            onTagSelect(null);
            onMobileClose();
          }}
          aria-label={t('archived')}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>
          </svg>
          <span>{t('archived')}</span>
          <span className="count">{archivedCount || 0}</span>
        </button>

        {onShowTrashToggle && (
          <button
            className={`sidebar-item ${showTrash ? 'active' : ''}`}
            onClick={() => {
              onShowTrashToggle();
              onMobileClose();
            }}
            aria-label={t('trash')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z"/>
            </svg>
            <span>{t('trash')}</span>
            <span className="count">{trashCount || 0}</span>
          </button>
        )}

        {/* Journal „Heute" (v1.10.0): öffnet (oder legt an) die Tages-Notiz
            im konfigurierten Journal-Ordner — dieselbe Notiz wie in der App. */}
        {onOpenToday && (
          <button
            className="sidebar-item"
            onClick={() => {
              onOpenToday();
              onMobileClose();
            }}
            aria-label={t('today')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
              <line x1="16" y1="2" x2="16" y2="6"/>
              <line x1="8" y1="2" x2="8" y2="6"/>
              <line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span>{t('today')}</span>
          </button>
        )}

        {onOpenFriends && (
          <button
            className="sidebar-item"
            onClick={() => {
              onOpenFriends();
              onMobileClose();
            }}
            aria-label={t('friends')}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/>
            </svg>
            <span>{t('friends')}</span>
          </button>
        )}

        {/* Ordner-Baum (v1.10.0): Jede Notiz mit Kindern ist ein Ordner. Der
            Baum kommt aus der leichten /api/notes/tree-Projektion; Klick scope-t
            die Liste, Drop verschiebt die gezogene Notiz hinein. */}
        {noteTree.length > 0 && (
          <>
            <div className="sidebar-divider"></div>
            <div className="sidebar-section-title">{t('foldersSection')}</div>
            <button
              type="button"
              className={`sidebar-item sidebar-folder ${folderScope === 'root' ? 'active' : ''}`}
              onClick={() => {
                onSelectFolder('root');
                onMobileClose();
              }}
              aria-label={t('topLevel')}
              aria-current={folderScope === 'root' ? 'true' : undefined}
            >
              {FOLDER_ICON}
              <span>{t('topLevel')}</span>
            </button>
            {noteTree.map(entry => (
              <FolderRow
                key={entry.node.id}
                entry={entry}
                depth={0}
                folderScope={folderScope}
                onSelectFolder={onSelectFolder}
                onFolderDrop={onFolderDrop}
                t={t}
              />
            ))}
          </>
        )}

        {/* Gespeicherte Suchen (v1.10.0): Smarte Ordner aus Suchbegriff + Tag,
            synchronisiert über die Konto-Preferences. */}
        {(savedSearches.length > 0 || canSaveSearch) && (
          <>
            <div className="sidebar-divider"></div>
            <div className="sidebar-section-title sidebar-section-title-row">
              <span>{t('savedSearchesSection')}</span>
              {canSaveSearch && (
                <button
                  type="button"
                  className="sidebar-savedsearch-add"
                  onClick={onSaveCurrentSearch}
                  title={t('saveCurrentSearch')}
                  aria-label={t('saveCurrentSearch')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </button>
              )}
            </div>
            {savedSearches.map((search) => (
              <div key={search.id} className="sidebar-savedsearch-row">
                <button
                  type="button"
                  className="sidebar-item sidebar-savedsearch"
                  onClick={() => {
                    onRunSavedSearch(search);
                    onMobileClose();
                  }}
                  title={search.tag ? `#${search.tag}` : undefined}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                  </svg>
                  <span>{search.name}</span>
                </button>
                <button
                  type="button"
                  className="sidebar-savedsearch-delete"
                  onClick={() => onDeleteSavedSearch(search.id)}
                  title={t('savedSearchDelete')}
                  aria-label={t('savedSearchDelete')}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            ))}
          </>
        )}

        {allTags.length > 0 && (
          <>
            <div className="sidebar-divider"></div>
            <div className="sidebar-section-title">Labels</div>
            {/* Tag-Farben (v1.10.0): Palette für den ausgewählten Tag — Farbe
                landet sofort in den Preferences und damit auf allen Geräten. */}
            {selectedTag && onTagColorSelect && (
              <div className="sidebar-tag-palette" role="group" aria-label={t('tagColorTitle', { tag: selectedTag })}>
                {TAG_COLOR_PALETTE.map((hex) => (
                  <button
                    key={hex}
                    type="button"
                    className={`sidebar-tag-color ${tagColors[selectedTag] === hex ? 'selected' : ''}`}
                    style={{ backgroundColor: hex }}
                    onClick={() => onTagColorSelect(selectedTag, tagColors[selectedTag] === hex ? null : hex)}
                    title={t('tagColorTitle', { tag: selectedTag })}
                    aria-label={t('tagColorTitle', { tag: selectedTag })}
                    aria-pressed={tagColors[selectedTag] === hex}
                  />
                ))}
                {tagColors[selectedTag] && (
                  <button
                    type="button"
                    className="sidebar-tag-color sidebar-tag-color-none"
                    onClick={() => onTagColorSelect(selectedTag, null)}
                    title={t('tagColorNone')}
                    aria-label={t('tagColorNone')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                )}
              </div>
            )}
            {allTags.map((tag) => (
              <TagRow
                key={tag.name}
                tag={tag}
                tagNames={allTags.map((entry) => entry.name)}
                selected={selectedTag === tag.name}
                color={tagColors[tag.name]}
                busy={Boolean(tagManageBusy)}
                onSelect={onTagSelect}
                onManage={onTagManage}
                onMobileClose={onMobileClose}
                t={t}
              />
            ))}
          </>
        )}
      </nav>
    </aside>
    </>
  );
}

export default Sidebar;
