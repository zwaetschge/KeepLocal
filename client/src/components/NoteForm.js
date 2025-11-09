import React, { useRef, useImperativeHandle } from 'react';
import './NoteForm.css';

const NoteForm = React.forwardRef(({ onOpenModal }, ref) => {
  const buttonRef = useRef(null);

  // Expose focus method to parent
  useImperativeHandle(ref, () => ({
    focus: () => {
      buttonRef.current?.click();
    }
  }));

  return (
    <div className="note-form-container">
      <button
        ref={buttonRef}
        className="note-form-button"
        onClick={() => onOpenModal()}
        aria-label="Neue Notiz erstellen"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        <span>Notiz eingeben...</span>
      </button>
    </div>
  );
});

NoteForm.displayName = 'NoteForm';

export default NoteForm;
