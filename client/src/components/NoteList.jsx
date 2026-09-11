import React from 'react';
import Note from './Note';
import './NoteList.css';

function NoteList({ notes, onDeleteNote, onUpdateNote, onTogglePin, onToggleArchive, onOpenCollaborate, onOpenModal, onDragStart, onDragEnd, onDragOver, onDrop, onRestoreNote, onPurgeNote, inTrash, operationLoading }) {
  return (
    <div className="note-list">
      {notes.map((note, index) => (
        <Note
          key={note._id}
          note={note}
          index={index}
          onDelete={onDeleteNote}
          onUpdate={onUpdateNote}
          onTogglePin={onTogglePin}
          onToggleArchive={onToggleArchive}
          onOpenCollaborate={onOpenCollaborate}
          onOpenModal={onOpenModal}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onRestore={onRestoreNote}
          onPurge={onPurgeNote}
          inTrash={Boolean(inTrash)}
          operation={operationLoading[note._id]}
        />
      ))}
    </div>
  );
}

export default NoteList;
