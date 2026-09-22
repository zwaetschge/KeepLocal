import React, { useState, useRef, useMemo } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { isNoteOwner, lastEditorName } from '../utils/noteAccess.mjs';
import './Note.css';
import ConfirmDialog from './ConfirmDialog';
import LinkPreview from './LinkPreview';
import { sanitizeAndLinkify } from '../utils/sanitize';
import { getColorVar } from '../utils/colorMapper';
import { useMarkdownHtml } from '../hooks/useMarkdown';

function Note({ note, index, onDelete, onUpdate, onTogglePin, onToggleArchive, onOpenCollaborate, onOpenModal, onDragStart, onDragEnd, onDragOver, onDrop, onRestore, onPurge, inTrash = false, highlight = '', operation, selectedIds, onToggleSelect, onTagSelect, tagColors }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { settings } = useSettings();
  // Geteilte Notizen sind gemeinsam editierbar (Inhalt/Titel/Tags/Farbe/Pin),
  // aber Archivieren, Teilen und Löschen bleiben beim Besitzer — der Server
  // lehnt alles andere mit 404 ab, also dürfen die Buttons gar nicht erst
  // für Mitbearbeiter erscheinen.
  const canManage = isNoteOwner(note, user);
  const editorName = lastEditorName(note);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverTag, setDragOverTag] = useState(false);
  const contentRef = useRef(null);

  // Nr. 26: sanitizeAndLinkify macht vier Regex-Durchläufe plus DOMPurify —
  // pro Karte pro Render. Bei 50 Karten pro Seite und einem 60-s-Poll waren
  // das 100 Läufe pro Minute im Leerlauf. Der HTML-String ändert sich nur mit
  // Inhalt oder Such-Highlight, also genau davon abhängig machen.
  const plainHtml = useMemo(
    () => sanitizeAndLinkify(note.content, { highlight }),
    [note.content, highlight]
  );

  // v1.13.0 Nr. 2: Karten als Markdown rendern (Trilium-Bestand). marked ist
  // lazy geladen — bis zur ersten Antwort (und für Code-Notizen, die
  // dicktengleich bleiben sollen) zeigt die Karte den gewohnten Plain-Text.
  const markdownEnabled = settings.renderMarkdown !== false && !note.isCode;
  const markdownHtml = useMarkdownHtml(note.content || '', markdownEnabled, { highlight });
  const contentHtml = markdownHtml ?? plainHtml;

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    // Im Papierkorb bedeutet Löschen: endgültig entfernen (inkl. Bilddateien).
    if (inTrash) {
      onPurge(note._id);
    } else {
      onDelete(note._id);
    }
    setShowDeleteConfirm(false);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  const handleDragStart = (e) => {
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget);
    if (onDragStart) onDragStart(note._id, e);
  };

  const handleDragEnd = (e) => {
    setIsDragging(false);
    if (onDragEnd) onDragEnd(e);
  };

  const handleDragOver = (e) => {
    if (e.preventDefault) {
      e.preventDefault();
    }

    // Check if we're dragging a tag from the sidebar
    const types = Array.from(e.dataTransfer.types || []);
    if (types.includes('application/keeplocal-tag')) {
      e.dataTransfer.dropEffect = 'copy';
      setDragOverTag(true);
    } else {
      e.dataTransfer.dropEffect = 'move';
    }

    if (onDragOver) onDragOver(note._id, e);
    return false;
  };

  const handleDragLeave = (e) => {
    // Only reset if we're actually leaving the note element
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget)) {
      setDragOverTag(false);
    }
  };

  const handleDrop = (e) => {
    if (e.stopPropagation) {
      e.stopPropagation();
    }
    if (e.preventDefault) {
      e.preventDefault();
    }

    setDragOverTag(false);

    // Check if we're dropping a tag from the sidebar
    const tagName = e.dataTransfer.getData('application/keeplocal-tag');
    if (tagName) {
      // Check if the note already has this tag
      const currentTags = note.tags || [];
      if (!currentTags.includes(tagName)) {
        // Add the tag to the note
        const updatedTags = [...currentTags, tagName];
        onUpdate(note._id, { tags: updatedTags });
      }
      return false;
    }

    // Otherwise, handle as note reordering
    if (onDrop) onDrop(note._id, e);
    return false;
  };

  const handleTodoItemToggle = (itemIndex) => {
    if (!note.todoItems || !onUpdate) return;

    const updatedTodoItems = note.todoItems.map((item, index) => {
      if (index === itemIndex) {
        return { ...item, completed: !item.completed };
      }
      return item;
    });

    onUpdate(note._id, { todoItems: updatedTodoItems });
  };

  return (
    <div
      className={`note ${isDragging ? 'dragging' : ''} ${dragOverTag ? 'drag-over-tag' : ''}`}
      style={{
        backgroundColor: getColorVar(note.color),
        '--note-bg-color': getColorVar(note.color),
        '--note-index': Math.min(index || 0, 15)
      }}
      onClick={() => { if (!inTrash && onOpenModal) onOpenModal(note); }}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          // Derselbe Guard wie onClick: Im Papierkorb ist onOpenModal nicht
          // gesetzt, Enter/Space warf vorher "onOpenModal is not a function".
          if (!inTrash && onOpenModal) onOpenModal(note);
        }
      }}
      role="article"
      tabIndex={0}
      aria-label={note.title || t('note') || 'Notiz'}
      aria-busy={Boolean(operation)}
      draggable={inTrash ? 'false' : 'true'}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="note-content-wrapper">
        {/* v1.10.0: Mehrfachauswahl — die Checkbox erscheint dauerhaft, sobald
            eine Auswahl läuft, sonst beim Hover/Fokus der Karte. */}
        {!inTrash && onToggleSelect && (
          <input
            type="checkbox"
            className={`note-select ${selectedIds?.size > 0 ? 'visible' : ''}`}
            checked={Boolean(selectedIds?.has(note._id))}
            onChange={(e) => {
              e.stopPropagation();
              onToggleSelect(note._id);
            }}
            onClick={(e) => e.stopPropagation()}
            aria-label={t('selectNote')}
            disabled={Boolean(operation)}
          />
        )}
        {note.title && <h3 className="note-title">{note.title}</h3>}

        {note.isTodoList && note.todoItems && note.todoItems.length > 0 ? (
          <div className="note-todo-list">
            {note.todoItems.map((item, index) => (
              <div key={index} className="note-todo-item">
                <input
                  type="checkbox"
                  className="note-todo-checkbox"
                  checked={item.completed}
                  disabled={Boolean(operation)}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleTodoItemToggle(index);
                  }}
                />
                <span className={`note-todo-text ${item.completed ? 'completed' : ''}`}>
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <p
              ref={contentRef}
              className={`note-content${markdownHtml ? ' markdown' : ''}`}
              dangerouslySetInnerHTML={{ __html: contentHtml }}
              onClick={(e) => {
                // Allow links to be clicked
                if (e.target.tagName === 'A') {
                  e.stopPropagation();
                }
              }}
            />
            {note.linkPreviews && note.linkPreviews.length > 0 && (
              <div className="note-link-previews">
                {note.linkPreviews.map((preview, index) => (
                  <LinkPreview
                    key={index}
                    preview={preview}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {note.images && note.images.length > 0 && (
          <div className="note-images">
            {/* Nr. 28 (Top-30): image.filename ist ein 52-Zeichen-Hex-Name —
                als alt nutzlos. Die Position in der Notiz sagt mehr. */}
            {note.images.slice(0, 4).map((image, index) => (
              <div key={index} className="note-image-preview">
                <img
                  src={image.thumbnailUrl || image.url}
                  alt={t('imageAlt', { index: index + 1 })}
                  loading="lazy"
                />
              </div>
            ))}
            {note.images.length > 4 && (
              <div className="note-images-more">
                +{note.images.length - 4}
              </div>
            )}
          </div>
        )}

        {note.tags && note.tags.length > 0 && (
          <div className="note-tags">
            {note.tags.map((tag, index) => {
              const colorDot = tagColors?.[tag] ? (
                <span className="note-tag-dot" style={{ backgroundColor: tagColors[tag] }} aria-hidden="true" />
              ) : null;
              // v1.16.0: Der Chip filtert die Liste. stopPropagation ist
              // Pflicht — die Karte darunter öffnet die Notiz.
              return onTagSelect ? (
                <button key={index} type="button" className="note-tag"
                  onClick={(e) => { e.stopPropagation(); onTagSelect(tag); }}>
                  {colorDot}{tag}
                </button>
              ) : (
                <span key={index} className="note-tag">{colorDot}{tag}</span>
              );
            })}
          </div>
        )}

        {note.sharedWith && note.sharedWith.length > 0 && (
          <div className="note-collaborators">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '4px' }}>
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            <span className="collaborators-text">
              {note.sharedWith.length === 1
                ? (note.sharedWith[0]?.username || note.sharedWith[0]?.email || t('unknownUser'))
                : t('sharedWithCount', { count: note.sharedWith.filter(u => u).length })}
            </span>
            <div className="collaborator-avatars">
              {note.sharedWith.filter(user => user).slice(0, 3).map((user, index) => (
                <div
                  key={user._id || index}
                  className="collaborator-avatar"
                  title={user?.username || user?.email || t('unknownUser')}
                >
                  {(user?.username || user?.email || '?').charAt(0).toUpperCase()}
                </div>
              ))}
              {note.sharedWith.filter(u => u).length > 3 && (
                <div className="collaborator-avatar more" title={`+${note.sharedWith.filter(u => u).length - 3} ${t('collaborators')}`}>
                  +{note.sharedWith.filter(u => u).length - 3}
                </div>
              )}
            </div>
          </div>
        )}

        {editorName && (
          <div className="note-edited-by">{t('lastEditedBy', { name: editorName })}</div>
        )}

        <div className="note-hover-actions">
          {inTrash ? (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRestore(note._id);
                }}
                className="action-btn restore-btn"
                disabled={Boolean(operation)}
                title={t('restore')}
                aria-label={t('restore')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteClick();
                }}
                className="action-btn delete-btn purge-btn"
                disabled={Boolean(operation)}
                title={t('deleteForever')}
                aria-label={t('deleteForever')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/>
                </svg>
              </button>
            </>
          ) : (
            <>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(note._id);
            }}
            className={`action-btn pin-btn ${note.isPinned ? 'pinned' : ''}`}
            disabled={Boolean(operation)}
            title={note.isPinned ? t('unpin') : t('pin')}
            aria-label={note.isPinned ? t('unpin') : t('pin')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 17v5m-5-9H5a2 2 0 0 1 0-4h14a2 2 0 0 1 0 4h-2m-5-9V2"/>
            </svg>
          </button>
          {canManage && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleArchive(note._id);
              }}
              className={`action-btn archive-btn ${note.isArchived ? 'archived' : ''}`}
              disabled={Boolean(operation)}
              title={note.isArchived ? t('unarchive') : t('archive')}
              aria-label={note.isArchived ? t('unarchive') : t('archive')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>
              </svg>
            </button>
          )}
          {canManage && onOpenCollaborate && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onOpenCollaborate(note);
              }}
              className="action-btn collaborate-btn"
              disabled={Boolean(operation)}
              title={t('share')}
              aria-label={t('share')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </button>
          )}
          {canManage && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteClick();
              }}
              className="action-btn delete-btn"
              disabled={Boolean(operation)}
              title={t('delete')}
              aria-label={t('delete')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/>
              </svg>
            </button>
          )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={inTrash ? t('confirmPurgeTitle') : t('confirmDeleteNoteTitle')}
        message={inTrash ? t('confirmPurgeMessage') : t('confirmDeleteMessage')}
        confirmLabel={inTrash ? t('deleteForever') : undefined}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}

// Nr. 26: Die Karte rendert nur, wenn sich ihre Props ändern — notwenig ist
// das erst in Kombination mit stabilen Handlern und listActions in App.jsx
// (useCallback/useMemo), sonst läuft das memo ins Leere.
export default React.memo(Note);
