import React, { useState } from 'react';
import './Note.css';
import ConfirmDialog from './ConfirmDialog';
import ColorPicker from './ColorPicker';
import { sanitize } from '../utils/sanitize';

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
    setEditedTitle(note.title);
    setEditedContent(note.content);
    setEditedTags((note.tags || []).join(', '));
    setEditedColor(note.color);
    setIsEditing(false);
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
      className="note"
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
          />
          <input
            type="text"
            value={editedTags}
            onChange={(e) => setEditedTags(e.target.value)}
            className="note-edit-tags"
            placeholder="Tags (durch Komma getrennt)"
          />
          <ColorPicker
            selectedColor={editedColor}
            onColorSelect={setEditedColor}
          />
          <div className="note-actions">
            <button onClick={handleCancel} className="btn-cancel">
              Abbrechen
            </button>
            <button onClick={handleSave} className="btn-save">
              Speichern
            </button>
          </div>
        </>
      ) : (
        <>
          {note.isPinned && <div className="pin-indicator">📌</div>}
          {note.title && <h3 className="note-title">{sanitize(note.title)}</h3>}
          <p className="note-content">{sanitize(note.content)}</p>
          {note.tags && note.tags.length > 0 && (
            <div className="note-tags">
              {note.tags.map((tag, index) => (
                <span key={index} className="note-tag">
                  {sanitize(tag)}
                </span>
              ))}
            </div>
          )}
          <div className="note-actions">
            <button
              onClick={() => onTogglePin(note._id)}
              className="btn-pin"
              title={note.isPinned ? "Abheften" : "Anheften"}
            >
              {note.isPinned ? '📌' : '📍'}
            </button>
            <button
              onClick={() => setIsEditing(true)}
              className="btn-edit"
              title="Bearbeiten"
            >
              ✏️
            </button>
            <button
              onClick={handleDeleteClick}
              className="btn-delete"
              title="Löschen"
            >
              🗑️
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
