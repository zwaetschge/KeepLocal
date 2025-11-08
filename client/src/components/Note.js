import React, { useState } from 'react';
import './Note.css';

function Note({ note, onDelete, onUpdate }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedTitle, setEditedTitle] = useState(note.title);
  const [editedContent, setEditedContent] = useState(note.content);

  const handleSave = () => {
    if (editedContent.trim() === '') {
      return;
    }

    onUpdate(note.id, {
      title: editedTitle.trim(),
      content: editedContent.trim(),
      color: note.color
    });

    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditedTitle(note.title);
    setEditedContent(note.content);
    setIsEditing(false);
  };

  return (
    <div
      className="note"
      style={{ backgroundColor: note.color }}
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
          {note.title && <h3 className="note-title">{note.title}</h3>}
          <p className="note-content">{note.content}</p>
          <div className="note-actions">
            <button
              onClick={() => setIsEditing(true)}
              className="btn-edit"
              title="Bearbeiten"
            >
              ✏️
            </button>
            <button
              onClick={() => onDelete(note.id)}
              className="btn-delete"
              title="Löschen"
            >
              🗑️
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default Note;
