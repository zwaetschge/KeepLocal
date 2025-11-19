/**
 * Settings Component
 * User preferences and feature toggles
 */

import React from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useLanguage } from '../contexts/LanguageContext';
import './Settings.css';

function Settings({ onClose }) {
  const { settings, toggleAIFeature, setTranscriptionLanguage } = useSettings();
  const { t } = useLanguage();

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>Einstellungen</h2>
          <button className="settings-close" onClick={onClose}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="settings-content">
          {/* AI Features Section */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ marginRight: '8px' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              AI-Features
            </h3>
            <p className="settings-section-description">
              Optionale KI-Funktionen für erweiterte Möglichkeiten
            </p>

            <div className="settings-item">
              <div className="settings-item-info">
                <label htmlFor="voice-transcription" className="settings-item-label">
                  🎙️ Sprach-zu-Text Transkription
                </label>
                <p className="settings-item-description">
                  Aktiviert die Möglichkeit, Sprachaufnahmen direkt in Text umzuwandeln.
                  Nutzt Whisper AI für hohe Genauigkeit.
                </p>
              </div>
              <div className="settings-item-control">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    id="voice-transcription"
                    checked={settings.aiFeatures.voiceTranscription}
                    onChange={() => toggleAIFeature('voiceTranscription')}
                  />
                  <span className="toggle-slider"></span>
                </label>
              </div>
            </div>

            {settings.aiFeatures.voiceTranscription && (
              <div className="settings-info-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4M12 8h.01"/>
                </svg>
                <div>
                  <strong>Hinweis:</strong> Die Transkription läuft lokal auf deinem Server.
                  Keine Daten werden an externe Dienste gesendet.
                </div>
              </div>
            )}
          </section>

          {/* AI Service Configuration Section */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ marginRight: '8px' }}>
                <circle cx="12" cy="12" r="3"/>
                <path d="M12 1v6m0 6v6M5.64 5.64l4.24 4.24m4.24 4.24l4.24 4.24M1 12h6m6 0h6M5.64 18.36l4.24-4.24m4.24-4.24l4.24-4.24"/>
              </svg>
              Transkriptions-Konfiguration
            </h3>
            <p className="settings-section-description">
              Whisper AI Service Einstellungen
            </p>

            <div className="settings-input-group">
              <label htmlFor="transcription-language" className="settings-input-label">
                Eingabesprache
              </label>
              <select
                id="transcription-language"
                className="settings-input"
                value={settings.transcriptionLanguage}
                onChange={(e) => setTranscriptionLanguage(e.target.value)}
              >
                <option value="auto">Automatisch erkennen</option>
                <option value="de">Deutsch</option>
                <option value="en">Englisch</option>
                <option value="es">Spanisch</option>
                <option value="fr">Französisch</option>
                <option value="it">Italienisch</option>
                <option value="pt">Portugiesisch</option>
                <option value="nl">Niederländisch</option>
                <option value="pl">Polnisch</option>
                <option value="ru">Russisch</option>
                <option value="zh">Chinesisch</option>
                <option value="ja">Japanisch</option>
                <option value="ko">Koreanisch</option>
                <option value="ar">Arabisch</option>
                <option value="tr">Türkisch</option>
              </select>
              <p className="settings-input-hint">
                Wählen Sie die Sprache Ihrer Aufnahmen für bessere Genauigkeit.
              </p>
            </div>

            <div className="settings-info-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4M12 8h.01"/>
              </svg>
              <div>
                <strong>Server-Konfiguration:</strong> Die Transkriptionsserver-URL wird in
                <code className="settings-code-inline">docker-compose.yml</code> unter
                <code className="settings-code-inline">AI_SERVICE_URL</code> konfiguriert (Standard: <code className="settings-code-inline">http://ai:5000</code>).
                Für externe Setups, ändern Sie diese Umgebungsvariable.
              </div>
            </div>
          </section>

          {/* Future sections can go here */}
        </div>

        <div className="settings-footer">
          <button className="btn-settings-close" onClick={onClose}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
}

export default Settings;
