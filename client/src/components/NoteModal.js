import React, { useState, useEffect } from 'react';
import './NoteModal.css';
import ColorPicker from './ColorPicker';
import { sanitize } from '../utils/sanitize';
import { getColorVar } from '../utils/colorMapper';

function NoteModal({ note, onSave, onClose }) {
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(note?.content || '');
  const [tags, setTags] = useState(note?.tags?.join(', ') || '');
  const [color, setColor] = useState(note?.color || '#ffffff');

  // Update state when note changes
  useEffect(() => {
    if (note) {
      setTitle(note.title || '');
      setContent(note.content || '');
      setTags(note.tags?.join(', ') || '');
      setColor(note.color || '#ffffff');
    }
  }, [note]);

  const handleSave = () => {
    if (!content.trim()) {
      return;
    }

    const tagArray = tags
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag !== '');

    const noteData = {
      title: title.trim(),
      content: content.trim(),
      tags: tagArray,
      color: color,
    };

    onSave(noteData);
    onClose();
  };

  const handleKeyDown = (e) => {
    // ESC to close
    if (e.key === 'Escape') {
      onClose();
    }
    // Ctrl/Cmd + Enter to save
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      handleSave();
    }
  };

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [title, content, tags, color]);

  return (
    <div className="note-modal-overlay" onClick={onClose}>
      <div
        className="note-modal"
        style={{ backgroundColor: getColorVar(color) }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="note-modal-header">
          <h2>{note ? 'Notiz bearbeiten' : 'Neue Notiz'}</h2>
          <button
            className="note-modal-close"
            onClick={onClose}
            aria-label="Schließen"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div className="note-modal-body">
          <input
            type="text"
            className="note-modal-title"
            placeholder="Titel"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
          <textarea
            className="note-modal-content"
            placeholder="Notiz eingeben..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={12}
          />
          <input
            type="text"
            className="note-modal-tags"
            placeholder="Tags (durch Komma getrennt)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
        </div>

        <div className="note-modal-footer">
          <ColorPicker
            selectedColor={color}
            onColorSelect={setColor}
          />
          <div className="note-modal-actions">
            <button
              className="btn-modal-cancel"
              onClick={onClose}
            >
              Abbrechen
            </button>
            <button
              className="btn-modal-save"
              onClick={handleSave}
              disabled={!content.trim()}
            >
              Speichern
            </button>
          </div>
        </div>

        <div className="note-modal-hint">
          <span>💡 Tipps: <kbd>ESC</kbd> zum Schließen, <kbd>Ctrl+Enter</kbd> zum Speichern</span>
        </div>
      </div>
    </div>
  );
}

export default NoteModal;
