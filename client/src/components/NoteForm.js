import React, { useState } from 'react';
import './NoteForm.css';

function NoteForm({ onCreateNote }) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [color, setColor] = useState('#ffffff');
  const [tags, setTags] = useState('');
  const [isExpanded, setIsExpanded] = useState(false);

  const colors = [
    '#ffffff', // Weiß
    '#f28b82', // Rot
    '#fbbc04', // Gelb
    '#fff475', // Hellgelb
    '#ccff90', // Grün
    '#a7ffeb', // Türkis
    '#cbf0f8', // Hellblau
    '#aecbfa', // Blau
    '#d7aefb', // Lila
    '#fdcfe8', // Rosa
  ];

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
        style={{ backgroundColor: color }}
      >
        {isExpanded && (
          <input
            type="text"
            placeholder="Titel"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="note-form-title"
          />
        )}

        <textarea
          placeholder={isExpanded ? "Notiz erstellen..." : "Notiz eingeben..."}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onFocus={() => setIsExpanded(true)}
          className="note-form-content"
          rows={isExpanded ? 4 : 1}
        />

        {isExpanded && (
          <input
            type="text"
            placeholder="Tags (durch Komma getrennt, z.B. arbeit, privat)"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            className="note-form-tags"
          />
        )}

        {isExpanded && (
          <div className="note-form-actions">
            <div className="color-picker">
              {colors.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-option ${c === color ? 'active' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                  title="Farbe ändern"
                />
              ))}
            </div>

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
              >
                Schließen
              </button>
              <button type="submit" className="btn-primary">
                Speichern
              </button>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}

export default NoteForm;
