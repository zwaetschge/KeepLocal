import React, { useState, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './Note.css';
import ConfirmDialog from './ConfirmDialog';
import LinkPreview from './LinkPreview';
import { sanitize, sanitizeAndLinkify } from '../utils/sanitize';
import { getColorVar } from '../utils/colorMapper';

function Note({ note, onDelete, onUpdate, onTogglePin, onToggleArchive, onOpenCollaborate, onOpenModal, onDragStart, onDragEnd, onDragOver, onDrop }) {
  const { t } = useLanguage();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverTag, setDragOverTag] = useState(false);
  const contentRef = useRef(null);

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    onDelete(note._id);
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
      style={{ backgroundColor: getColorVar(note.color) }}
      onClick={() => onOpenModal(note)}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <div className="note-content-wrapper">
        {note.title && <h3 className="note-title">{sanitize(note.title)}</h3>}

        {note.isTodoList && note.todoItems && note.todoItems.length > 0 ? (
          <div className="note-todo-list">
            {note.todoItems.map((item, index) => (
              <div key={index} className="note-todo-item">
                <input
                  type="checkbox"
                  className="note-todo-checkbox"
                  checked={item.completed}
                  onChange={(e) => {
                    e.stopPropagation();
                    handleTodoItemToggle(index);
                  }}
                />
                <span className={`note-todo-text ${item.completed ? 'completed' : ''}`}>
                  {sanitize(item.text)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <>
            <p
              ref={contentRef}
              className="note-content"
              dangerouslySetInnerHTML={{ __html: sanitizeAndLinkify(note.content) }}
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

        {note.tags && note.tags.length > 0 && (
          <div className="note-tags">
            {note.tags.map((tag, index) => (
              <span key={index} className="note-tag">
                {sanitize(tag)}
              </span>
            ))}
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
                : t('sharedWithCount').replace('{count}', note.sharedWith.filter(u => u).length)}
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

        <div className="note-hover-actions">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(note._id);
            }}
            className={`action-btn pin-btn ${note.isPinned ? 'pinned' : ''}`}
            title={note.isPinned ? t('unpin') : t('pin')}
            aria-label={note.isPinned ? t('unpin') : t('pin')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 17v5m-5-9H5a2 2 0 0 1 0-4h14a2 2 0 0 1 0 4h-2m-5-9V2"/>
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleArchive(note._id);
            }}
            className={`action-btn archive-btn ${note.isArchived ? 'archived' : ''}`}
            title={note.isArchived ? t('unarchive') : t('archive')}
            aria-label={note.isArchived ? t('unarchive') : t('archive')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenCollaborate(note);
            }}
            className="action-btn collaborate-btn"
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
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteClick();
            }}
            className="action-btn delete-btn"
            title={t('delete')}
            aria-label={t('delete')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/>
            </svg>
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={t('confirmDeleteNoteTitle')}
        message={t('confirmDeleteMessage')}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}

export default Note;
