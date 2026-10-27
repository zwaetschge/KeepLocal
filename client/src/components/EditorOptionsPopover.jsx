import React, { useEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

export default function EditorOptionsPopover({ title, onClose, onOutside, children }) {
  const { t } = useLanguage();
  const panelRef = useRef(null);
  const outsideRef = useRef(onOutside);
  outsideRef.current = onOutside;
  useEffect(() => {
    const dismiss = event => {
      if (!panelRef.current?.contains(event.target) && !event.target.closest('[data-editor-options-trigger]')) outsideRef.current();
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, []);
  useEffect(() => {
    const panel = panelRef.current;
    (panel?.querySelector('.editor-options-fields input, .editor-options-fields select, .editor-more-actions > button') || panel?.querySelector('button'))?.focus();
  }, [title]);
  return <div ref={panelRef} className="editor-options-popover" role="dialog" aria-label={title}
    onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); onClose(); }
    }}>
    <div className="editor-options-heading"><strong>{title}</strong><button type="button" onClick={onClose} aria-label={t('close')}>×</button></div>
    {children}
  </div>;
}
