import React from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import './ThemeToggle.css';

function ThemeToggle({ theme, onToggle }) {
  const { t } = useLanguage();

  // Get icon and title based on current theme
  const getThemeIcon = () => {
    if (theme === 'light') return '☀️'; // Currently light mode
    if (theme === 'dark') return '🌙'; // Currently dark mode
    if (theme === 'oled') return '⚫'; // Currently OLED mode
    return '📰'; // Currently E-Ink mode
  };

  const getThemeTitle = () => {
    if (theme === 'light') return t('switchToDarkMode');
    if (theme === 'dark') return t('switchToOledMode');
    if (theme === 'oled') return t('switchToEinkMode');
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
