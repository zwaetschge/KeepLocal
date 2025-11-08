import React from 'react';
import Note from './Note';
import './NoteList.css';

function NoteList({ notes, onDeleteNote, onUpdateNote }) {
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
          key={note.id}
          note={note}
          onDelete={onDeleteNote}
          onUpdate={onUpdateNote}
        />
      ))}
    </div>
  );
}

export default NoteList;
