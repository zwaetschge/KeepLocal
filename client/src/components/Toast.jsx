import React, { useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './Toast.css';

function Toast({ message, type = 'info', duration = 3000, onClose }) {
  const { t } = useLanguage();
  // Keep onClose in a ref so a new inline-arrow identity from the parent does
  // not re-run this effect (and restart the dismiss timer) on every render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const timer = setTimeout(() => {
      onCloseRef.current();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration]);

  const getIcon = () => {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      case 'warning':
        return '⚠';
      default:
        return 'ℹ';
    }
  };

  // Screen-reader announcement: errors are assertive (role="alert"), everything
  // else is polite so it does not interrupt the current announcement.
  const isAssertive = type === 'error';

  return (
    <div
      className={`toast toast-${type}`}
      role={isAssertive ? 'alert' : 'status'}
      aria-live={isAssertive ? 'assertive' : 'polite'}
    >
      <span className="toast-icon" aria-hidden="true">{getIcon()}</span>
      <span className="toast-message">{message}</span>
      <button className="toast-close" onClick={onClose} aria-label={t('close')}>
        ✕
      </button>
    </div>
  );
}

export default Toast;
