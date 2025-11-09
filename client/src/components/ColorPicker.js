import React, { useState } from 'react';
import './ColorPicker.css';
import { getColorVar } from '../utils/colorMapper';

const colors = [
  { value: '#ffffff', name: 'Weiß' },
  { value: '#f28b82', name: 'Rot' },
  { value: '#fbbc04', name: 'Orange' },
  { value: '#fff475', name: 'Gelb' },
  { value: '#ccff90', name: 'Grün' },
  { value: '#a7ffeb', name: 'Türkis' },
  { value: '#cbf0f8', name: 'Hellblau' },
  { value: '#aecbfa', name: 'Blau' },
  { value: '#d7aefb', name: 'Lila' },
  { value: '#fdcfe8', name: 'Rosa' },
  { value: '#e6c9a8', name: 'Braun' },
  { value: '#e8eaed', name: 'Grau' }
];

function ColorPicker({ selectedColor, onColorSelect }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleColorSelect = (color) => {
    onColorSelect(color);
    setIsOpen(false);
  };

  return (
    <div className="color-picker-wrapper">
      <button
        type="button"
        className="color-picker-toggle"
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        title="Farbe ändern"
        aria-label="Farbauswahl öffnen"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z"/>
          <line x1="16" y1="8" x2="2" y2="22"/>
          <line x1="17.5" y1="15" x2="9" y2="15"/>
        </svg>
      </button>

      {isOpen && (
        <div className="color-picker-popup">
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
                title={color.name}
                aria-label={`Farbe ${color.name} auswählen`}
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
