/**
 * Settings Context
 * Manages user preferences and feature toggles
 * Stores settings in localStorage
 */

import React, { createContext, useContext, useState, useEffect } from 'react';
import { readLocalStorage, writeLocalStorage } from '../utils/localStorage.mjs';

const SettingsContext = createContext();

const DEFAULT_SETTINGS = {
  aiFeatures: {
    voiceTranscription: false,  // Opt-in for Whisper voice-to-text
  },
  transcriptionLanguage: 'auto',  // Language for transcription (auto = auto-detect)
};

export function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(() => {
    // Load from localStorage or use defaults
    const savedSettings = readLocalStorage('keeplocal_settings');
    if (savedSettings) {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) };
      } catch (error) {
        console.error('Error parsing settings from localStorage:', error);
        return DEFAULT_SETTINGS;
      }
    }
    return DEFAULT_SETTINGS;
  });

  // Save to localStorage whenever settings change
  useEffect(() => {
    writeLocalStorage('keeplocal_settings', JSON.stringify(settings));
  }, [settings]);

  const updateSettings = (newSettings) => {
    setSettings((prev) => ({
      ...prev,
      ...newSettings,
    }));
  };

  const toggleAIFeature = (feature) => {
    setSettings((prev) => ({
      ...prev,
      aiFeatures: {
        ...prev.aiFeatures,
        [feature]: !prev.aiFeatures[feature],
      },
    }));
  };

  const setTranscriptionLanguage = (language) => {
    setSettings((prev) => ({
      ...prev,
      transcriptionLanguage: language,
    }));
  };

  const value = {
    settings,
    updateSettings,
    toggleAIFeature,
    setTranscriptionLanguage,
  };

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within SettingsProvider');
  }
  return context;
}
