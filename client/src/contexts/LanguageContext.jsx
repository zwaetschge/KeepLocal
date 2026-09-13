import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { translations, defaultLanguage } from '../translations';
import { getBrowserLanguage } from '../utils/browserLanguage.mjs';
import { subscribeToWindowEvent } from '../utils/browserEnvironment.mjs';
import { readLocalStorage, writeLocalStorage, removeLocalStorage } from '../utils/localStorage.mjs';
import { interpolate } from '../utils/i18n.mjs';
import { toastBus } from '../utils/toastBus.mjs';
import { useAuth } from './AuthContext';
import { authAPI } from '../services/api';

const LanguageContext = createContext();

const LANGUAGE_STORAGE_KEY = 'keeplocal_language';

const resolveLanguage = () => getBrowserLanguage(translations, defaultLanguage);

export function LanguageProvider({ children }) {
  const { user, isLoggedIn } = useAuth();
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

  // The account preference wins after login, so the UI language follows the
  // user instead of the device (a German account on an English browser used to
  // flip to English on every new device).
  const accountLanguage = user?.preferences?.language;
  useEffect(() => {
    if (!isLoggedIn) return;
    if (!accountLanguage || !translations[accountLanguage]) return;
    setLanguage(accountLanguage);
    writeLocalStorage(LANGUAGE_STORAGE_KEY, accountLanguage);
  }, [isLoggedIn, accountLanguage]);

  // Logout clears the explicit choice (Nr. 17): the key used to survive logout
  // and account switches, so on a shared machine the next user inherited the
  // previous one's language — exactly what the account-bound preferences were
  // meant to prevent. Only on the logged-in -> logged-out transition, never on
  // first render (that would strip a visitor's own choice on every page load).
  const wasLoggedInRef = useRef(false);
  const clearLanguagePreference = useCallback(() => {
    removeLocalStorage(LANGUAGE_STORAGE_KEY);
    setLanguage(resolveLanguage());
  }, []);
  useEffect(() => {
    if (isLoggedIn) {
      wasLoggedInRef.current = true;
      return;
    }
    if (!wasLoggedInRef.current) return;
    wasLoggedInRef.current = false;
    clearLanguagePreference();
  }, [isLoggedIn, clearLanguagePreference]);

  const changeLanguage = useCallback((langCode) => {
    if (!translations[langCode]) {
      return;
    }
    writeLocalStorage(LANGUAGE_STORAGE_KEY, langCode);
    setLanguage(langCode);
    // Persist on the account as well; localStorage alone is per device. Same
    // honesty as the settings push (Nr. 17): a failed PUT gets a warning, not
    // just a console line — otherwise the choice silently reverts on the next
    // login and the user blames the app.
    authAPI.updatePreferences({ language: langCode }).catch((error) => {
      console.error('Could not store the language on the account:', error.message);
      toastBus.warning(
        translations[langCode]?.errPreferencesNotSaved
        || translations[defaultLanguage].errPreferencesNotSaved
      );
    });
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
    <LanguageContext.Provider value={{ language, changeLanguage, clearLanguagePreference, t }}>
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
