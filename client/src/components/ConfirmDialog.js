import React from 'react';
import './ConfirmDialog.css';

function ConfirmDialog({ isOpen, title, message, onConfirm, onCancel }) {
  if (!isOpen) return null;

  return (
    <div className="confirm-dialog-overlay" onClick={onCancel}>
      <div className="confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 className="confirm-dialog-title">{title}</h3>
        <p className="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <button onClick={onCancel} className="btn-cancel-confirm">
            Abbrechen
          </button>
          <button onClick={onConfirm} className="btn-confirm">
            Löschen
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
