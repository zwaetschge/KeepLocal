import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';

/**
 * Breadcrumb des aktiven Ordner-Filters (v1.10.0) über der Notizliste.
 * × hebt den Scope auf. Reine Anzeige — Titel-Auflösung macht die Aufruferin.
 */
function FolderScopeBar({ title, onClear }) {
  const { t } = useLanguage();
  return (
    <div className="folder-scope-breadcrumb">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
      </svg>
      <span>{title}</span>
      <button type="button" onClick={onClear} aria-label={t('clearFolderScope')}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
  );
}

export default FolderScopeBar;
