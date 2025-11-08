import React from 'react';
import Note from './Note';
import './NoteList.css';

function NoteList({ notes, onDeleteNote, onUpdateNote, onTogglePin }) {
  if (notes.length === 0) {
    return (
      <div className="empty-state">
        <p>📝 Noch keine Notizen vorhanden.</p>
        <p>Erstellen Sie Ihre erste Notiz!</p>
      </div>
    );
  }

  return (
    <div className="note-list">
      {notes.map((note) => (
        <Note
          key={note._id}
          note={note}
          onDelete={onDeleteNote}
          onUpdate={onUpdateNote}
          onTogglePin={onTogglePin}
        />
      ))}
    </div>
  );
}

export default NoteList;
