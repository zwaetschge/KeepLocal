import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, defaultLanguage } from '../translations';

const LanguageContext = createContext();

function getBrowserLanguage() {
  const browserLang = navigator.language.split('-')[0];
  if (translations[browserLang]) {
    return browserLang;
  }
  return defaultLanguage;
}

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(getBrowserLanguage);

  // Listen for browser language changes
  useEffect(() => {
    function handleLanguageChange() {
      setLanguage(getBrowserLanguage());
    }

    window.addEventListener('languagechange', handleLanguageChange);
    return () => window.removeEventListener('languagechange', handleLanguageChange);
  }, []);

  const t = (key) => {
    return translations[language]?.[key] || translations[defaultLanguage]?.[key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
