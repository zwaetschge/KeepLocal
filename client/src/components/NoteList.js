import React from 'react';
import Note from './Note';
import './NoteList.css';

function NoteList({ notes, onDeleteNote, onUpdateNote, onTogglePin, onOpenModal, operationLoading }) {
  return (
    <div className="note-list">
      {notes.map((note) => (
        <Note
          key={note._id}
          note={note}
          onDelete={onDeleteNote}
          onUpdate={onUpdateNote}
          onTogglePin={onTogglePin}
          onOpenModal={onOpenModal}
        />
      ))}
    </div>
  );
}

export default NoteList;
