import React, { createContext, useContext, useState, useEffect } from 'react';
import { translations, defaultLanguage } from '../translations';
import { getBrowserLanguage } from '../utils/browserLanguage.mjs';

const LanguageContext = createContext();

const resolveLanguage = () => getBrowserLanguage(translations, defaultLanguage);

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(resolveLanguage);

  // Listen for browser language changes
  useEffect(() => {
    function handleLanguageChange() {
      setLanguage(resolveLanguage());
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
