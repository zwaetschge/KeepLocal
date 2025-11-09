import React, { useState, useRef, useImperativeHandle } from 'react';
import ColorPicker from './ColorPicker';
import './NoteForm.css';
import { getColorVar } from '../utils/colorMapper';

const NoteForm = React.forwardRef(({ onCreateNote, loading }, ref) => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [color, setColor] = useState('#ffffff');
  const [tags, setTags] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);
  const contentRef = useRef(null);

  // Expose focus method to parent
  useImperativeHandle(ref, () => ({
    focus: () => {
      contentRef.current?.focus();
      setIsExpanded(true);
    }
  }));


  const handleSubmit = (e) => {
    e.preventDefault();

    if (content.trim() === '') {
      return;
    }

    // Tags in Array umwandeln (durch Komma getrennt)
    const tagArray = tags
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag !== '');

    onCreateNote({
      title: title.trim(),
      content: content.trim(),
      color: color,
      tags: tagArray
    });

    // Formular zurücksetzen
    setTitle('');
    setContent('');
    setColor('#ffffff');
    setTags('');
    setIsExpanded(false);
  };

  return (
    <div className="note-form-container">
      <form
        className="note-form"
        onSubmit={handleSubmit}
        style={{ backgroundColor: getColorVar(color) }}
      >
        {isExpanded && (
          <input
            type="text"
            placeholder="Titel"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="note-form-title"
            disabled={loading}
            aria-label="Notiztitel"
          />
        )}

        <textarea
          ref={contentRef}
          placeholder={isExpanded ? "Notiz erstellen..." : "Notiz eingeben..."}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onFocus={() => setIsExpanded(true)}
          className="note-form-content"
          rows={isExpanded ? 4 : 1}
          disabled={loading}
          aria-label="Notizinhalt"
          aria-required="true"
        />

        {isExpanded && (
          <input
            type="text"
            placeholder="Tags (durch Komma getrennt, z.B. arbeit, privat)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="note-form-tags"
            disabled={loading}
            aria-label="Tags"
          />
        )}

        {isExpanded && (
          <div className="note-form-actions">
            <ColorPicker
              selectedColor={color}
              onColorSelect={setColor}
            />

            <div className="form-buttons">
              <button
                type="button"
                onClick={() => {
                  setIsExpanded(false);
                  setTitle('');
                  setContent('');
                  setColor('#ffffff');
                  setTags('');
                }}
                className="btn-secondary"
                disabled={loading}
                aria-label="Formular schließen"
              >
                Schließen
              </button>
              <button
                type="submit"
                className="btn-primary"
                disabled={loading}
                aria-label="Notiz speichern"
              >
                {loading ? 'Speichert...' : 'Speichern'}
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
});

NoteForm.displayName = 'NoteForm';

export default NoteForm;
