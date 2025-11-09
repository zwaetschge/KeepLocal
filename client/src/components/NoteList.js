import React from 'react';
import Note from './Note';
import './NoteList.css';

function NoteList({ notes, onDeleteNote, onUpdateNote, onTogglePin, onOpenModal, onDragStart, onDragEnd, onDragOver, onDrop, operationLoading }) {
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
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDrop={onDrop}
        />
      ))}
    </div>
  );
}

export default NoteList;
