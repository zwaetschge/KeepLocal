import React, { useState } from 'react';
import ThemeToggle from './ThemeToggle';
import Logo from './Logo';
import { useLanguage } from '../contexts/LanguageContext';
import './Sidebar.css';

function Sidebar({
  allTags,
  selectedTag,
  onTagSelect,
  noteCount,
  archivedCount,
  showArchived,
  onShowArchivedToggle,
  onOpenFriends,
  onSettingsClick,
  user,
  onLogout,
  theme,
  onThemeToggle,
  isMobileOpen,
  onMobileClose
}) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { t } = useLanguage();

  return (
    <>
      {/* Mobile overlay */}
      {isMobileOpen && (
        <div className="sidebar-overlay" onClick={onMobileClose} />
      )}

      <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobileOpen ? 'mobile-open' : ''}`}>
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

        <button
          className="sidebar-mobile-user"
          onClick={() => {
            onSettingsClick();
            onMobileClose();
          }}
          aria-label="Einstellungen"
        >
          <span className="mobile-user-icon">👤</span>
          <span className="mobile-user-name">{user?.username}</span>
        </button>

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
          className={`sidebar-item ${!selectedTag && !showArchived ? 'active' : ''}`}
          onClick={() => {
            onTagSelect(null);
            if (showArchived) onShowArchivedToggle();
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

        {allTags.length > 0 && (
          <>
            <div className="sidebar-divider"></div>
            <div className="sidebar-section-title">Labels</div>
            {allTags.map((tag) => (
              <button
                key={tag.name}
                className={`sidebar-item ${selectedTag === tag.name ? 'active' : ''}`}
                onClick={() => {
                  onTagSelect(tag.name);
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
                <span className="count">{tag.count}</span>
              </button>
            ))}
          </>
        )}
      </nav>
    </aside>
    </>
  );
}

export default Sidebar;
