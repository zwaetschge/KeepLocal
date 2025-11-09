import React from 'react';
import './ColorPicker.css';

const COLORS = [
  { name: 'White', value: '#ffffff' },
  { name: 'Red', value: '#f28b82' },
  { name: 'Orange', value: '#fbbc04' },
  { name: 'Yellow', value: '#fff475' },
  { name: 'Green', value: '#ccff90' },
  { name: 'Teal', value: '#a7ffeb' },
  { name: 'Blue', value: '#cbf0f8' },
  { name: 'Dark Blue', value: '#aecbfa' },
  { name: 'Purple', value: '#d7aefb' },
  { name: 'Pink', value: '#fdcfe8' },
  { name: 'Brown', value: '#e6c9a8' },
  { name: 'Gray', value: '#e8eaed' }
];

function ColorPicker({ selectedColor, onColorSelect, className = '' }) {
  return (
    <div className={`color-picker ${className}`} role="group" aria-label="Farbauswahl">
      {COLORS.map((color) => (
        <button
          key={color.value}
          type="button"
          className={`color-option ${selectedColor === color.value ? 'selected' : ''}`}
          style={{ backgroundColor: color.value }}
          onClick={() => onColorSelect(color.value)}
          aria-label={`Farbe ${color.name}`}
          title={color.name}
        >
          {selectedColor === color.value && (
            <svg
              className="check-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          )}
        </button>
      ))}
    </div>
  );
}

export default ColorPicker;
