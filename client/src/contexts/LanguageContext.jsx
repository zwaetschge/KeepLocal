import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { translations, defaultLanguage } from '../translations';
import { getBrowserLanguage } from '../utils/browserLanguage.mjs';
import { subscribeToWindowEvent } from '../utils/browserEnvironment.mjs';
import { readLocalStorage, writeLocalStorage } from '../utils/localStorage.mjs';
import { interpolate } from '../utils/i18n.mjs';

const LanguageContext = createContext();

const LANGUAGE_STORAGE_KEY = 'keeplocal_language';

const resolveLanguage = () => getBrowserLanguage(translations, defaultLanguage);

export function LanguageProvider({ children }) {
  // An explicit choice persists; without one, follow the browser language.
  const [language, setLanguage] = useState(() => {
    const stored = readLocalStorage(LANGUAGE_STORAGE_KEY);
    return translations[stored] ? stored : resolveLanguage();
  });

  // Listen for browser language changes (only while the user has not picked one)
  useEffect(() => {
    function handleLanguageChange() {
      if (!readLocalStorage(LANGUAGE_STORAGE_KEY)) {
        setLanguage(resolveLanguage());
      }
    }

    return subscribeToWindowEvent('languagechange', handleLanguageChange);
  }, []);

  // Keep <html lang> and the document title in sync with the active language.
  // index.html ships lang="de", which makes screen readers pronounce an
  // English UI with German rules.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = language;
    const title = translations[language]?.appTitle || translations[defaultLanguage]?.appTitle;
    if (title) document.title = title;
  }, [language]);

  const changeLanguage = useCallback((langCode) => {
    if (!translations[langCode]) {
      return;
    }
    writeLocalStorage(LANGUAGE_STORAGE_KEY, langCode);
    setLanguage(langCode);
  }, []);

  // Stabil über Renders (nur Sprachwechsel erzeugt eine neue Identität) —
  // Callbacks/Effects dürfen t daher in ihre Deps aufnehmen.
  // t(key, params) ersetzt `{token}`-Platzhalter im Text, z.B.
  //   t('sharedWithCount', { count: 3 }). params ist optional; Aufrufe ohne
  // params verhalten sich exakt wie vorher (keine Pluralisierung).
  const t = useCallback((key, params) => {
    const template =
      translations[language]?.[key] || translations[defaultLanguage]?.[key] || key;
    return interpolate(template, params);
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, changeLanguage, t }}>
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
