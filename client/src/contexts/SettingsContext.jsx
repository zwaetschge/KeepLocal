/**
 * Settings Context
 *
 * Account-scoped preferences (theme, AI features, transcription language).
 * localStorage is only a fast cache for the first paint and for logged-out
 * visitors — the source of truth is the user document on the server, loaded
 * with /api/auth/me and written back debounced. Before this, preferences lived
 * in the browser alone: a new device started at the defaults (voice
 * transcription off, light theme) and a shared machine kept the previous user's
 * settings after logout.
 */

import React, { createContext, useContext, useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useAuth } from './AuthContext';
import { authAPI } from '../services/api';
import { readLocalStorage, writeLocalStorage, removeLocalStorage } from '../utils/localStorage.mjs';
import {
  DEFAULT_SETTINGS,
  THEMES,
  normalizeSettings,
  preferencesFromSettings,
  settingsEqual
} from '../utils/settingsPayload.mjs';

const SettingsContext = createContext();
const STORAGE_KEY = 'keeplocal_settings';
const LEGACY_THEME_KEY = 'theme';
const PUSH_DEBOUNCE_MS = 600;

/** Cached copy, including the pre-account theme key from older versions. */
function initialSettings() {
  const stored = readLocalStorage(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = normalizeSettings(JSON.parse(stored));
      // Migration: the theme used to live in its own localStorage key.
      if (parsed.theme === DEFAULT_SETTINGS.theme) {
        const legacyTheme = readLocalStorage(LEGACY_THEME_KEY);
        if (THEMES.includes(legacyTheme)) {
          return { ...parsed, theme: legacyTheme };
        }
      }
      return parsed;
    } catch (error) {
      console.error('Error parsing settings from localStorage:', error);
    }
  }

  const legacyTheme = readLocalStorage(LEGACY_THEME_KEY);
  return THEMES.includes(legacyTheme)
    ? { ...normalizeSettings(DEFAULT_SETTINGS), theme: legacyTheme }
    : normalizeSettings(DEFAULT_SETTINGS);
}

export function SettingsProvider({ children }) {
  const { user, isLoggedIn } = useAuth();
  const [settings, setSettings] = useState(initialSettings);

  // Last state known to be in sync with the server, so an echo of our own write
  // (or a repeated /me) does not trigger another request.
  const syncedRef = useRef(JSON.stringify(normalizeSettings(settings)));
  const wasLoggedInRef = useRef(false);

  // Save to localStorage whenever settings change (first-paint cache).
  useEffect(() => {
    writeLocalStorage(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  // Adopt the account preferences after login / session check.
  const serverPreferences = user?.preferences;
  useEffect(() => {
    if (!isLoggedIn) return;
    const fromServer = normalizeSettings(serverPreferences);
    syncedRef.current = JSON.stringify(fromServer);
    setSettings(previous => (settingsEqual(previous, fromServer) ? previous : fromServer));
  }, [isLoggedIn, serverPreferences]);

  // Push local changes (debounced). Runs only while logged in and only when the
  // state actually differs from what the server has.
  useEffect(() => {
    if (!isLoggedIn) return undefined;
    const payload = JSON.stringify(normalizeSettings(settings));
    if (payload === syncedRef.current) return undefined;

    const timer = setTimeout(() => {
      syncedRef.current = payload;
      authAPI.updatePreferences(preferencesFromSettings(settings)).catch((error) => {
        console.error('Could not store preferences on the account:', error.message);
      });
    }, PUSH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [settings, isLoggedIn]);

  // Logout: drop the cached copy so the next person on this browser does not
  // inherit the previous account's theme or AI settings. Only on the transition
  // from logged in to logged out — never on the first render, which would wipe
  // the preferences of a logged-out visitor on every page load.
  useEffect(() => {
    if (isLoggedIn) {
      wasLoggedInRef.current = true;
      return;
    }
    if (!wasLoggedInRef.current) return;
    wasLoggedInRef.current = false;
    syncedRef.current = JSON.stringify(normalizeSettings(DEFAULT_SETTINGS));
    removeLocalStorage(STORAGE_KEY);
    setSettings(normalizeSettings(DEFAULT_SETTINGS));
  }, [isLoggedIn]);

  const updateSettings = useCallback((newSettings) => {
    setSettings((prev) => normalizeSettings({ ...prev, ...newSettings }));
  }, []);

  const toggleAIFeature = useCallback((feature) => {
    setSettings((prev) => normalizeSettings({
      ...prev,
      aiFeatures: {
        ...prev.aiFeatures,
        [feature]: !(prev.aiFeatures?.[feature] === true)
      }
    }));
  }, []);

  const setTranscriptionLanguage = useCallback((language) => {
    setSettings((prev) => normalizeSettings({ ...prev, transcriptionLanguage: language }));
  }, []);

  const setTheme = useCallback((theme) => {
    setSettings((prev) => (THEMES.includes(theme) ? normalizeSettings({ ...prev, theme }) : prev));
  }, []);

  const value = useMemo(() => ({
    settings,
    updateSettings,
    toggleAIFeature,
    setTranscriptionLanguage,
    setTheme,
  }), [settings, updateSettings, toggleAIFeature, setTranscriptionLanguage, setTheme]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
}
