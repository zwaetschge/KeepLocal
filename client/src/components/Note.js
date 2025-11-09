import React, { useState } from 'react';
import './Note.css';
import ConfirmDialog from './ConfirmDialog';
import ColorPicker from './ColorPicker';
import { sanitize, sanitizeAndLinkify } from '../utils/sanitize';
import { getColorVar } from '../utils/colorMapper';

function Note({ note, onDelete, onUpdate, onTogglePin }) {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [editedTitle, setEditedTitle] = useState(note.title);
  const [editedContent, setEditedContent] = useState(note.content);
  const [editedTags, setEditedTags] = useState((note.tags || []).join(', '));
  const [editedColor, setEditedColor] = useState(note.color);

  const handleSave = () => {
    if (editedContent.trim() === '') {
      return;
    }

    // Tags in Array umwandeln
    const tagArray = editedTags
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag !== '');

    onUpdate(note._id, {
      title: editedTitle.trim(),
      content: editedContent.trim(),
      color: editedColor,
      tags: tagArray
    });

    setIsEditing(false);
  };

  const handleCancel = () => {
    // Auto-save changes when closing
    handleSave();
  };

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

  return (
    <div
      className={`note ${isEditing ? 'editing' : ''}`}
      style={{ backgroundColor: isEditing ? getColorVar(editedColor) : getColorVar(note.color) }}
      onClick={() => !isEditing && setIsEditing(true)}
    >
      {isEditing ? (
        <>
          <input
            type="text"
            value={editedTitle}
            onChange={(e) => setEditedTitle(e.target.value)}
            className="note-edit-title"
            placeholder="Titel"
            onClick={(e) => e.stopPropagation()}
          />
          <textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="note-edit-content"
            rows="4"
            onClick={(e) => e.stopPropagation()}
          />
          <input
            type="text"
            value={editedTags}
            onChange={(e) => setEditedTags(e.target.value)}
            className="note-edit-tags"
            placeholder="Tags (durch Komma getrennt)"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="note-edit-footer">
            <div className="note-toolbar">
              <ColorPicker
                selectedColor={editedColor}
                onColorSelect={setEditedColor}
              />
            </div>
            <div className="note-edit-actions">
              <button onClick={handleCancel} className="btn-text">
                Schließen
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="note-content-wrapper">
          {note.title && <h3 className="note-title">{sanitize(note.title)}</h3>}
          <p
            className="note-content"
            dangerouslySetInnerHTML={{ __html: sanitizeAndLinkify(note.content) }}
            onClick={(e) => {
              // Allow links to be clicked
              if (e.target.tagName === 'A') {
                e.stopPropagation();
              }
            }}
          />
          {note.tags && note.tags.length > 0 && (
            <div className="note-tags">
              {note.tags.map((tag, index) => (
                <span key={index} className="note-tag">
                  {sanitize(tag)}
                </span>
              ))}
            </div>
          )}
          <div className="note-hover-actions">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(note._id);
              }}
              className={`action-btn pin-btn ${note.isPinned ? 'pinned' : ''}`}
              title={note.isPinned ? "Abheften" : "Anheften"}
              aria-label={note.isPinned ? "Abheften" : "Anheften"}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 17v5m-5-9H5a2 2 0 0 1 0-4h14a2 2 0 0 1 0 4h-2m-5-9V2"/>
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteClick();
              }}
              className="action-btn delete-btn"
              title="Löschen"
              aria-label="Löschen"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/>
              </svg>
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Notiz löschen?"
        message="Möchten Sie diese Notiz wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden."
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}

export default Note;
