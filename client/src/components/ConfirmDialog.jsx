import React, { useId, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useLanguage } from '../contexts/LanguageContext';
import { useModalA11y } from '../hooks/useModalA11y';
import './ConfirmDialog.css';

/**
 * Generic confirmation dialog. Focus trap, Escape handling, initial focus on
 * the cancel button and focus restore live in useModalA11y (shared with the
 * other modals).
 *
 * `confirmLabel`/`cancelLabel` override the button texts (default: delete /
 * cancel) so the dialog can also ask "discard local changes?" or
 * "remove friend?" without new dialog variants.
 */
function ConfirmDialog({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel,
  cancelLabel,
}) {
  const { t } = useLanguage();
  const cancelButtonRef = useRef(null);
  const confirmButtonRef = useRef(null);
  const messageId = useId();

  const { containerRef, titleId } = useModalA11y({
    onClose: onCancel,
    active: isOpen,
    initialFocusRef: cancelButtonRef,
  });

  if (!isOpen) return null;

  const resolvedConfirmLabel = confirmLabel || t('delete');
  const resolvedCancelLabel = cancelLabel || t('cancel');

  // Use Portal to render dialog at document.body level
  // This prevents stacking context issues from parent transforms
  return ReactDOM.createPortal(
    <div
      className="confirm-dialog-overlay"
      onClick={(event) => {
        event.stopPropagation();
        onCancel();
      }}
    >
      <div
        ref={containerRef}
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="confirm-dialog-title">
          {title}
        </h3>
        <p id={messageId} className="confirm-dialog-message">
          {message}
        </p>
        <div className="confirm-dialog-actions">
          <button
            ref={cancelButtonRef}
            onClick={onCancel}
            className="btn-cancel-confirm"
            aria-label={resolvedCancelLabel}
          >
            {resolvedCancelLabel}
          </button>
          <button
            ref={confirmButtonRef}
            onClick={onConfirm}
            className="btn-confirm"
            aria-label={resolvedConfirmLabel}
          >
            {resolvedConfirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default ConfirmDialog;
