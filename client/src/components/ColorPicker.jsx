import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './ColorPicker.css';
import { getColorVar } from '../utils/colorMapper';

const colors = [
  { value: '#ffffff', nameKey: 'colorWhite' },
  { value: '#f28b82', nameKey: 'colorRed' },
  { value: '#fbbc04', nameKey: 'colorOrange' },
  { value: '#fff475', nameKey: 'colorYellow' },
  { value: '#ccff90', nameKey: 'colorGreen' },
  { value: '#a7ffeb', nameKey: 'colorTeal' },
  { value: '#cbf0f8', nameKey: 'colorLightBlue' },
  { value: '#aecbfa', nameKey: 'colorBlue' },
  { value: '#d7aefb', nameKey: 'colorPurple' },
  { value: '#fdcfe8', nameKey: 'colorPink' },
  { value: '#e6c9a8', nameKey: 'colorBrown' },
  { value: '#e8eaed', nameKey: 'colorGray' }
];

function ColorPicker({ selectedColor, onColorSelect }) {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const popup=useRef(null), trigger=useRef(null);
  useLayoutEffect(()=>{
    if(isOpen && popup.current?.getBoundingClientRect().right>window.innerWidth-8){popup.current.style.left='auto';popup.current.style.right='0';}
  },[isOpen]);
  useEffect(()=>{
    if(!isOpen)return undefined;
    const close=event=>{
      if(event.key==='Escape'){event.stopPropagation();setIsOpen(false);trigger.current?.focus();}
      else if(event.type==='pointerdown'&&!popup.current?.contains(event.target)&&!trigger.current?.contains(event.target))setIsOpen(false);
    };
    document.addEventListener('pointerdown',close);document.addEventListener('keydown',close,true);
    return ()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',close,true);};
  },[isOpen]);

  const handleColorSelect = (color) => {
    onColorSelect(color);
    setIsOpen(false);
  };

  return (
    <div className="color-picker-wrapper">
      <button
        type="button"
        className="color-picker-toggle"
        ref={trigger}
        aria-expanded={isOpen}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        title={t('changeColor')}
        aria-label={t('openColorPicker')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H13a1.5 1.5 0 0 1 0-3h3a5 5 0 0 0 5-5c0-3-4-5-9-5z"/>
          <circle cx="7" cy="10" r=".8"/><circle cx="10" cy="7" r=".8"/><circle cx="15" cy="7" r=".8"/>
        </svg>
      </button>

      {isOpen && (
        <div className="color-picker-popup" ref={popup}>
          <div className="color-picker-grid">
            {colors.map((color) => (
              <button
                key={color.value}
                type="button"
                className={`color-picker-option ${selectedColor === color.value ? 'selected' : ''}`}
                style={{ backgroundColor: getColorVar(color.value) }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleColorSelect(color.value);
                }}
                title={t(color.nameKey)}
                aria-label={`${t('selectColor')} ${t(color.nameKey)}`}
              >
                {selectedColor === color.value && (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default ColorPicker;
