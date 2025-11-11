import React, { useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './ConfirmDialog.css';

function ConfirmDialog({ isOpen, title, message, onConfirm, onCancel }) {
  const { t } = useLanguage();
  const dialogRef = useRef(null);
  const cancelButtonRef = useRef(null);
  const confirmButtonRef = useRef(null);

  // Handle Esc key to close dialog
  useEffect(() => {
    if (!isOpen) return;

    const handleEsc = (e) => {
      if (e.key === 'Escape') {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen, onCancel]);

  // Auto-focus cancel button when dialog opens
  useEffect(() => {
    if (isOpen && cancelButtonRef.current) {
      cancelButtonRef.current.focus();
    }
  }, [isOpen]);

  // Focus trap: keep focus within dialog
  useEffect(() => {
    if (!isOpen) return;

    const handleTab = (e) => {
      if (e.key !== 'Tab') return;

      const focusableElements = [cancelButtonRef.current, confirmButtonRef.current];
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleTab);
    return () => document.removeEventListener('keydown', handleTab);
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="confirm-dialog-overlay"
      onClick={onCancel}
      role="dialog"
      aria-modal="true"
      aria-labelledby="dialog-title"
      aria-describedby="dialog-message"
    >
      <div
        ref={dialogRef}
        className="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="dialog-title" className="confirm-dialog-title">
          {title}
        </h3>
        <p id="dialog-message" className="confirm-dialog-message">
          {message}
        </p>
        <div className="confirm-dialog-actions">
          <button
            ref={cancelButtonRef}
            onClick={onCancel}
            className="btn-cancel-confirm"
            aria-label={t('cancel')}
          >
            {t('cancel')}
          </button>
          <button
            ref={confirmButtonRef}
            onClick={onConfirm}
            className="btn-confirm"
            aria-label={t('delete')}
          >
            {t('delete')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ConfirmDialog;
