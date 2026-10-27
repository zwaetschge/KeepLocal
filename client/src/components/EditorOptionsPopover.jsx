import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './EditorOptionsPopover.css';

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
  useLayoutEffect(() => {
    const panel=panelRef.current;
    if(panel && panel.getBoundingClientRect().right>window.innerWidth-8){panel.style.left='auto';panel.style.right='0';}
  },[title]);
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
