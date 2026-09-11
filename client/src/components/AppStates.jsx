import React from 'react';
import NoteList from './NoteList';
import { useLanguage } from '../contexts/LanguageContext';

/**
 * Presentational pieces of the authenticated app shell, extracted from App.jsx
 * so that file stays pure wiring (state, effects, handlers). Nothing here owns
 * data — everything comes in through props.
 */

/** Skeleton cards for the very first load (shimmer classes live in App.css). */
export function NotesSkeleton({ count = 8 }) {
  return (
    <div className="notes-skeleton" role="status" aria-busy="true" aria-live="polite">
      {Array.from({ length: count }).map((_, index) => (
        <div className="skeleton skeleton-card" key={index}>
          <div className="skeleton skeleton-text" style={{ width: '65%', margin: 'var(--space-4) var(--space-4) var(--space-2)' }} />
          <div className="skeleton skeleton-text" style={{ width: '92%', margin: '0 var(--space-4) var(--space-2)' }} />
          <div className="skeleton-text short" style={{ margin: '0 var(--space-4)' }} />
        </div>
      ))}
    </div>
  );
}

/** Empty state of the note list; the reason is computed in useNotesManager. */
export function EmptyState({ emoji, title, hint, kbd }) {
  const { t } = useLanguage();
  return (
    <div className="empty-state" role="status">
      <p>{emoji} {title}</p>
      <p className="empty-hint">{hint}{kbd ? <> <kbd>{t('shortcutCtrlN')}</kbd></> : null}</p>
    </div>
  );
}

/** A note section (pinned / other) with the shared list props. */
export function NotesSection({ title, notes, actions }) {
  return (
    <div className="notes-section">
      {title && <h2 className="section-title">{title}</h2>}
      <NoteList notes={notes} {...actions} />
    </div>
  );
}

/** Header of the trash view: retention hint plus the "empty trash" action. */
export function TrashHeader({ count, busy, onEmpty }) {
  const { t } = useLanguage();
  return (
    <div className="trash-header">
      <h2 className="section-title">{t('trash')}</h2>
      <p className="trash-hint">{t('trashRetentionHint')}</p>
      <button
        className="btn-empty-trash"
        onClick={onEmpty}
        disabled={busy || count === 0}
      >
        {t('emptyTrash')}
      </button>
    </div>
  );
}
