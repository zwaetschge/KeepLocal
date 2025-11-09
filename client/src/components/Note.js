import React, { useState } from 'react';
import './Note.css';
import ConfirmDialog from './ConfirmDialog';
import ColorPicker from './ColorPicker';
import { sanitize } from '../utils/sanitize';

function Note({ note, onDelete, onUpdate, onTogglePin }) {
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [editedTitle, setEditedTitle] = useState(note.title);
  const [editedContent, setEditedContent] = useState(note.content);
  const [editedColor, setEditedColor] = useState(note.color || '#ffffff');
  const [editedTags, setEditedTags] = useState((note.tags || []).join(', '));

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
    setShowColorPicker(false);
  };

  const handleCancel = () => {
    setEditedTitle(note.title);
    setEditedContent(note.content);
    setEditedColor(note.color || '#ffffff');
    setEditedTags((note.tags || []).join(', '));
    setIsEditing(false);
    setShowColorPicker(false);
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
      style={{ backgroundColor: isEditing ? editedColor : note.color }}
    >
      {isEditing ? (
        <>
          <input
            type="text"
            value={editedTitle}
            onChange={(e) => setEditedTitle(e.target.value)}
            className="note-edit-title"
            placeholder="Titel"
          />
          <textarea
            value={editedContent}
            onChange={(e) => setEditedContent(e.target.value)}
            className="note-edit-content"
            rows="4"
            placeholder="Notiz..."
          />
          <input
            type="text"
            value={editedTags}
            onChange={(e) => setEditedTags(e.target.value)}
            className="note-edit-tags"
            placeholder="Tags (durch Komma getrennt)"
          />
          <div className="note-edit-footer">
            <div className="note-toolbar">
              <button
                type="button"
                onClick={() => setShowColorPicker(!showColorPicker)}
                className="toolbar-btn"
                title="Farbe ändern"
                aria-label="Farbe ändern"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 22C6.49 22 2 17.51 2 12S6.49 2 12 2s10 4.04 10 9c0 3.31-2.69 6-6 6h-1.77c-.28 0-.5.22-.5.5 0 .12.05.23.13.33.41.47.64 1.06.64 1.67A2.5 2.5 0 0 1 12 22zm0-18c-4.41 0-8 3.59-8 8s3.59 8 8 8c.28 0 .5-.22.5-.5a.54.54 0 0 0-.14-.35c-.41-.46-.63-1.05-.63-1.65a2.5 2.5 0 0 1 2.5-2.5H16c2.21 0 4-1.79 4-4 0-3.86-3.59-7-8-7z"/>
                  <circle cx="6.5" cy="11.5" r="1.5"/>
                  <circle cx="9.5" cy="7.5" r="1.5"/>
                  <circle cx="14.5" cy="7.5" r="1.5"/>
                  <circle cx="17.5" cy="11.5" r="1.5"/>
                </svg>
              </button>
            </div>
            {showColorPicker && (
              <div className="color-picker-popup">
                <ColorPicker
                  selectedColor={editedColor}
                  onColorSelect={(color) => {
                    setEditedColor(color);
                    setShowColorPicker(false);
                  }}
                />
              </div>
            )}
            <div className="note-edit-actions">
              <button onClick={handleCancel} className="btn-text">
                Schließen
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="note-content-wrapper" onClick={() => setIsEditing(true)}>
            {note.title && <h3 className="note-title">{sanitize(note.title)}</h3>}
            <div className="note-content">{sanitize(note.content)}</div>
            {note.tags && note.tags.length > 0 && (
              <div className="note-tags">
                {note.tags.map((tag, index) => (
                  <span key={index} className="note-tag">
                    #{sanitize(tag)}
                  </span>
                ))}
              </div>
            )}
          </div>
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
                <path d="M16 7l-5.2 5.2c-.9.9-2.1.9-3 0s-.9-2.1 0-3L13 4m3 3l2 2M7.2 12.2l-4.1 7.8 7.8-4.1"/>
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
                <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
              </svg>
            </button>
          </div>
        </>
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
