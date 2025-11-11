import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './ThemeToggle.css';

function ThemeToggle({ theme, onToggle }) {
  const { t } = useLanguage();

  // Get icon and title based on current theme
  const getThemeIcon = () => {
    if (theme === 'light') return '☀️'; // Currently light mode
    if (theme === 'dark') return '🌙'; // Currently dark mode
    return '⚫'; // Currently OLED mode
  };

  const getThemeTitle = () => {
    if (theme === 'light') return t('switchToDarkMode');
    if (theme === 'dark') return t('switchToOledMode');
    return t('switchToLightMode');
  };

  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      title={getThemeTitle()}
      aria-label="Toggle theme"
    >
      {getThemeIcon()}
    </button>
  );
}

export default ThemeToggle;
