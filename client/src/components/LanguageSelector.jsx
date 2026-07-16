import React, { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { languages } from '../translations';
import './LanguageSelector.css';

function LanguageSelector() {
  const { language, changeLanguage, t } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const selectorRef = useRef(null);

  // Close popup when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (selectorRef.current && !selectorRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  const handleLanguageChange = (langCode) => {
    changeLanguage(langCode);
    setIsOpen(false);
  };

  const currentLanguage = languages.find(lang => lang.code === language);

  return (
    <div className="language-selector" ref={selectorRef}>
      <button
        className="language-toggle"
        onClick={() => setIsOpen(!isOpen)}
        title={t('language')}
        aria-label={t('language')}
        aria-expanded={isOpen}
      >
        <span className="language-emoji">{currentLanguage?.emoji || '🌍'}</span>
      </button>

      {isOpen && (
        <div className="language-popup" role="dialog" aria-label={t('language')}>
          <div className="language-options">
            {languages.map((lang) => (
              <button
                key={lang.code}
                className={`language-option ${language === lang.code ? 'active' : ''}`}
                onClick={() => handleLanguageChange(lang.code)}
                title={lang.name}
                aria-label={lang.name}
                aria-pressed={language === lang.code}
              >
                <span className="language-emoji-large">{lang.emoji}</span>
                <span className="language-name">{lang.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default LanguageSelector;
