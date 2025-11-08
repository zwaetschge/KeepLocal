import React from 'react';
import './ThemeToggle.css';

function ThemeToggle({ isDarkMode, onToggle }) {
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      title={isDarkMode ? "Zum hellen Modus wechseln" : "Zum dunklen Modus wechseln"}
      aria-label="Toggle theme"
    >
      {isDarkMode ? '☀️' : '🌙'}
    </button>
  );
}

export default ThemeToggle;
