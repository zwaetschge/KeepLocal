import React, { useState, useEffect, useRef } from 'react';
import './NoteModal.css';
import ColorPicker from './ColorPicker';
import { sanitize } from '../utils/sanitize';
import { getColorVar } from '../utils/colorMapper';

function NoteModal({ note, onSave, onClose }) {
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(note?.content || '');
  const [tags, setTags] = useState(note?.tags?.join(', ') || '');
  const [color, setColor] = useState(note?.color || '#ffffff');
  const contentTextareaRef = useRef(null);

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

  const handleInsertCheckbox = () => {
    if (!contentTextareaRef.current) return;

    const textarea = contentTextareaRef.current;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;

    // Insert [ ] at cursor position
    const before = text.substring(0, start);
    const after = text.substring(end);
    const newText = before + '[ ] ' + after;

    setContent(newText);

    // Set cursor after the inserted checkbox
    setTimeout(() => {
      textarea.focus();
      const newCursorPos = start + 4; // After "[ ] "
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    }, 0);
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
            ref={contentTextareaRef}
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
          <div className="note-modal-toolbar">
            <ColorPicker
              selectedColor={color}
              onColorSelect={setColor}
            />
            <button
              type="button"
              className="btn-modal-checkbox"
              onClick={handleInsertCheckbox}
              title="Checkbox einfügen"
              aria-label="Todo-Checkbox einfügen"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <path d="M9 11l3 3 6-6"/>
              </svg>
            </button>
          </div>
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
      </div>
    </div>
  );
}

export default NoteModal;
