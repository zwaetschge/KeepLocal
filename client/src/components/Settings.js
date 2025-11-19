/**
 * Settings Component
 * User preferences and feature toggles
 */

import React from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useLanguage } from '../contexts/LanguageContext';
import './Settings.css';

function Settings({ onClose }) {
  const { settings, toggleAIFeature } = useSettings();
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
              AI-Service Konfiguration
            </h3>
            <p className="settings-section-description">
              Konfiguration des Transkriptionsservers (Whisper AI)
            </p>

            <div className="settings-config-box">
              <h4 style={{ marginBottom: '8px', fontSize: '0.9rem' }}>Transkriptionsserver-URL</h4>
              <p style={{ marginBottom: '8px' }}>Der Backend-Server verwendet die folgende Umgebungsvariable:</p>
              <code className="settings-code">AI_SERVICE_URL</code>

              <p style={{ marginTop: '12px', marginBottom: '8px' }}>Standard: <code className="settings-code-inline">http://ai:5000</code> (Docker-Netzwerk)</p>

              <div className="settings-instructions">
                <strong>So ändern Sie die URL:</strong>
                <ol>
                  <li>Öffnen Sie <code className="settings-code-inline">docker-compose.yml</code></li>
                  <li>Unter <code className="settings-code-inline">server</code> → <code className="settings-code-inline">environment</code> finden Sie:
                    <pre className="settings-code-block">- AI_SERVICE_URL=http://ai:5000</pre>
                  </li>
                  <li>Ändern Sie die URL nach Bedarf (z.B. <code className="settings-code-inline">http://localhost:9000</code> wenn lokal)</li>
                  <li>Starten Sie die Container neu: <code className="settings-code-inline">docker-compose restart server</code></li>
                </ol>
              </div>

              <div className="settings-warning-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                <div>
                  <strong>Wichtig:</strong> Stellen Sie sicher, dass der AI-Service läuft und erreichbar ist.
                  Bei Problemen prüfen Sie die Logs: <code className="settings-code-inline">docker-compose logs ai</code>
                </div>
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
