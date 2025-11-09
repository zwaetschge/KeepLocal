import React from 'react';
import './ColorPicker.css';

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
  return (
    <div className="color-picker-container">
      <div className="color-picker-grid">
        {colors.map((color) => (
          <button
            key={color.value}
            type="button"
            className={`color-picker-option ${selectedColor === color.value ? 'selected' : ''}`}
            style={{ backgroundColor: color.value }}
            onClick={() => onColorSelect(color.value)}
            title={color.name}
            aria-label={`Farbe ${color.name} auswählen`}
          >
            {selectedColor === color.value && (
              <span className="color-picker-checkmark">✓</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

export default ColorPicker;
