import React from 'react';
import Note from './Note';
import './NoteList.css';

// v1.14.0 Nr. 1: selectedIds/onToggleSelect/tagColors MÜSSEN hier durchgereicht
// werden — die Liste destrukturierte vorher nur den festen Satz, obwohl App.jsx
// alle drei liefert und Note.jsx sie rendert. Die Auswahl-Checkbox erschien
// nie, selectedIds blieb leer, die Bulk-Bar war damit unerreichbar und die
// Tag-Farb-Punkte fehlten auf den Karten (Regression aus dem Nr.-26-Refactor).
function NoteList({ notes, onDeleteNote, onUpdateNote, onUpdateInline, onTogglePin, onToggleArchive, onOpenCollaborate, onOpenModal, onDragStart, onDragEnd, onDragOver, onDrop, onRestoreNote, onPurgeNote, inTrash, highlight, operationLoading, selectedIds, onToggleSelect, onTagSelect, tagColors }) {
  return (
    <div className="note-list">
      {notes.map((note, index) => (
        <Note
          key={note._id}
          note={note}
          index={index}
          onDelete={onDeleteNote}
          onUpdate={onUpdateNote}
          onUpdateInline={onUpdateInline}
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
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onTagSelect={onTagSelect}
          tagColors={tagColors}
        />
      ))}
    </div>
  );
}

// Nr. 26: gleiche Begründung wie Note — mit stabilen `actions` aus App.jsx
// überspringt die Liste den Re-Render, wenn der 60-s-Poll nichts ändert.
export default React.memo(NoteList);
