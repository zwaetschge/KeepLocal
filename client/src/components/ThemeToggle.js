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
    if (theme === 'eink') return '📰'; // Currently E-Ink mode
    if (theme === 'doodle') return '✏️'; // Currently Doodle mode
    return '☀️';
  };

  const getThemeTitle = () => {
    if (theme === 'light') return t('switchToDarkMode');
    if (theme === 'dark') return t('switchToOledMode');
    if (theme === 'oled') return t('switchToEinkMode');
    if (theme === 'eink') return t('switchToDoodleMode');
    if (theme === 'doodle') return t('switchToLightMode');
    return t('switchToLightMode');
  };

  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      title={getThemeTitle()}
      aria-label={getThemeTitle()}
    >
      {getThemeIcon()}
    </button>
  );
}

export default ThemeToggle;
