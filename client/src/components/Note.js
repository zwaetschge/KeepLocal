import React, { useState, useEffect, useRef } from 'react';
import './Note.css';
import ConfirmDialog from './ConfirmDialog';
import ColorPicker from './ColorPicker';
import { sanitize, sanitizeAndLinkify } from '../utils/sanitize';
import { getColorVar } from '../utils/colorMapper';

function Note({ note, onDelete, onUpdate, onTogglePin, onOpenModal, onDragStart, onDragEnd, onDragOver, onDrop }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const contentRef = useRef(null);

  // Set up image preview on image links
  useEffect(() => {
    if (contentRef.current) {
      const imageLinks = contentRef.current.querySelectorAll('.note-link-image');
      imageLinks.forEach(link => {
        const imageUrl = link.getAttribute('data-image');
        if (imageUrl) {
          link.style.setProperty('--preview-image', `url(${imageUrl})`);
        }
      });
    }
  }, [note.content]);

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    onDelete(note._id);
    setShowDeleteConfirm(false);
  };

  const handleCancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  const handleDragStart = (e) => {
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', e.currentTarget);
    if (onDragStart) onDragStart(note._id, e);
  };

  const handleDragEnd = (e) => {
    setIsDragging(false);
    if (onDragEnd) onDragEnd(e);
  };

  const handleDragOver = (e) => {
    if (e.preventDefault) {
      e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';
    if (onDragOver) onDragOver(note._id, e);
    return false;
  };

  const handleDrop = (e) => {
    if (e.stopPropagation) {
      e.stopPropagation();
    }
    if (onDrop) onDrop(note._id, e);
    return false;
  };

  const handleCheckboxClick = (e) => {
    e.stopPropagation(); // Prevent note from opening

    // Get the checkbox element
    const checkbox = e.target;
    const isChecked = checkbox.checked;

    // Update note content by toggling the checkbox state
    const updatedContent = note.content.replace(/\[[ xX]\]/, (match) => {
      // Find the checkbox that was clicked and toggle it
      return isChecked ? '[x]' : '[ ]';
    });

    // Save the updated content
    if (onUpdate && updatedContent !== note.content) {
      onUpdate(note._id, { content: updatedContent });
    }
  };

  return (
    <div
      className={`note ${isDragging ? 'dragging' : ''}`}
      style={{ backgroundColor: getColorVar(note.color) }}
      onClick={() => onOpenModal(note)}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <div className="note-content-wrapper">
        {note.title && <h3 className="note-title">{sanitize(note.title)}</h3>}
        <p
          ref={contentRef}
          className="note-content"
          dangerouslySetInnerHTML={{ __html: sanitizeAndLinkify(note.content) }}
          onClick={(e) => {
            // Allow links to be clicked
            if (e.target.tagName === 'A') {
              e.stopPropagation();
            }
            // Handle checkbox clicks
            if (e.target.type === 'checkbox' && e.target.classList.contains('todo-checkbox')) {
              handleCheckboxClick(e);
            }
          }}
        />
        {note.tags && note.tags.length > 0 && (
          <div className="note-tags">
            {note.tags.map((tag, index) => (
              <span key={index} className="note-tag">
                {sanitize(tag)}
              </span>
            ))}
          </div>
        )}
        <div className="note-hover-actions">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onTogglePin(note._id);
            }}
            className={`action-btn pin-btn ${note.isPinned ? 'pinned' : ''}`}
            title={note.isPinned ? "Abheften" : "Anheften"}
            aria-label={note.isPinned ? "Abheften" : "Anheften"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 17v5m-5-9H5a2 2 0 0 1 0-4h14a2 2 0 0 1 0 4h-2m-5-9V2"/>
            </svg>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleDeleteClick();
            }}
            className="action-btn delete-btn"
            title="Löschen"
            aria-label="Löschen"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/>
            </svg>
          </button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title="Notiz löschen?"
        message="Möchten Sie diese Notiz wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden."
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
    </div>
  );
}

export default Note;
