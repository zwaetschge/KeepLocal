import React, { useState } from 'react';
import './Sidebar.css';

function Sidebar({ allTags, selectedTag, onTagSelect, noteCount, isAdmin, onAdminClick }) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <aside className={`sidebar ${isCollapsed ? 'collapsed' : ''}`}>
      <button
        className="sidebar-toggle"
        onClick={() => setIsCollapsed(!isCollapsed)}
        aria-label={isCollapsed ? "Sidebar erweitern" : "Sidebar minimieren"}
        title={isCollapsed ? "Erweitern" : "Minimieren"}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          {isCollapsed ? (
            <path d="M9 18l6-6-6-6"/>
          ) : (
            <path d="M15 18l-6-6 6-6"/>
          )}
        </svg>
      </button>
      <nav className="sidebar-nav">
        <button
          className={`sidebar-item ${!selectedTag ? 'active' : ''}`}
          onClick={() => onTagSelect(null)}
          aria-label="Alle Notizen"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
          </svg>
          <span>Notizen</span>
          <span className="count">{noteCount}</span>
        </button>

        {isAdmin && (
          <>
            <div className="sidebar-divider"></div>
            <button
              className="sidebar-item sidebar-admin"
              onClick={onAdminClick}
              aria-label="Admin-Konsole"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
              </svg>
              <span>Admin</span>
            </button>
          </>
        )}

        {allTags.length > 0 && (
          <>
            <div className="sidebar-divider"></div>
            <div className="sidebar-section-title">Labels</div>
            {allTags.map((tag) => (
              <button
                key={tag.name}
                className={`sidebar-item ${selectedTag === tag.name ? 'active' : ''}`}
                onClick={() => onTagSelect(tag.name)}
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
  );
}

export default Sidebar;
