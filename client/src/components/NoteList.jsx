import React from 'react';
import Note from './Note';
import './NoteList.css';

function NoteList({ notes, onDeleteNote, onUpdateNote, onTogglePin, onToggleArchive, onOpenCollaborate, onOpenModal, onDragStart, onDragEnd, onDragOver, onDrop, onRestoreNote, onPurgeNote, inTrash, highlight, operationLoading }) {
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
          highlight={highlight}
          operation={operationLoading[note._id]}
        />
      ))}
    </div>
  );
}

// Nr. 26: gleiche Begründung wie Note — mit stabilen `actions` aus App.jsx
// überspringt die Liste den Re-Render, wenn der 60-s-Poll nichts ändert.
export default React.memo(NoteList);
