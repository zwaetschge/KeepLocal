/**
 * Settings Component
 * User preferences and feature toggles
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useLanguage } from '../contexts/LanguageContext';
import { getApiKeys, createApiKey, revokeApiKey } from '../services/api/apiKeysAPI';
import './Settings.css';

function Settings({ onClose, isAdmin, onAdminClick }) {
  const { settings, toggleAIFeature, setTranscriptionLanguage } = useSettings();
  const { t } = useLanguage();

  // API Keys state
  const [apiKeys, setApiKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('never');
  const [createdKey, setCreatedKey] = useState(null);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [apiKeyError, setApiKeyError] = useState('');
  const [keyCopied, setKeyCopied] = useState(false);

  const loadApiKeys = useCallback(async () => {
    try {
      setApiKeysLoading(true);
      const result = await getApiKeys();
      setApiKeys(result.data || []);
    } catch (err) {
      console.error('Failed to load API keys:', err);
    } finally {
      setApiKeysLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApiKeys();
  }, [loadApiKeys]);

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) {
      setApiKeyError('Name ist erforderlich');
      return;
    }
    try {
      setApiKeyError('');
      const result = await createApiKey(newKeyName.trim(), newKeyExpiry);
      setCreatedKey(result.data.key);
      setNewKeyName('');
      setNewKeyExpiry('never');
      loadApiKeys();
    } catch (err) {
      setApiKeyError(err.message);
    }
  };

  const handleRevokeKey = async (id) => {
    try {
      await revokeApiKey(id);
      loadApiKeys();
    } catch (err) {
      setApiKeyError(err.message);
    }
  };

  const handleCopyKey = async () => {
    if (createdKey) {
      await navigator.clipboard.writeText(createdKey);
      setKeyCopied(true);
      setTimeout(() => setKeyCopied(false), 2000);
    }
  };

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
          {/* API Keys Section */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ marginRight: '8px' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              API-Keys
            </h3>
            <p className="settings-section-description">
              Erstelle API-Keys für den externen Zugriff auf deine Notizen.
              Dokumentation unter <code className="settings-code-inline">/api/docs</code>
            </p>

            {/* Created key display */}
            {createdKey && (
              <div className="settings-warning-box" style={{ marginBottom: '1rem' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>Key kopieren - wird nur einmal angezeigt!</strong>
                  <div className="api-key-created-value">
                    <code className="settings-code-inline" style={{ wordBreak: 'break-all', display: 'block', marginTop: '0.5rem' }}>
                      {createdKey}
                    </code>
                    <button className="btn-copy-key" onClick={handleCopyKey}>
                      {keyCopied ? 'Kopiert!' : 'Kopieren'}
                    </button>
                  </div>
                  <button
                    className="btn-dismiss-key"
                    onClick={() => setCreatedKey(null)}
                  >
                    Verstanden, Key gespeichert
                  </button>
                </div>
              </div>
            )}

            {/* Create new key */}
            <div className="api-key-create-form">
              <div className="api-key-create-inputs">
                <input
                  type="text"
                  className="settings-input"
                  placeholder="Name (z.B. 'Mein Script')"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateKey()}
                  maxLength={100}
                />
                <select
                  className="settings-input api-key-expiry-select"
                  value={newKeyExpiry}
                  onChange={(e) => setNewKeyExpiry(e.target.value)}
                >
                  <option value="never">Kein Ablauf</option>
                  <option value="30">30 Tage</option>
                  <option value="90">90 Tage</option>
                  <option value="365">1 Jahr</option>
                </select>
                <button className="btn-create-key" onClick={handleCreateKey}>
                  Erstellen
                </button>
              </div>
              {apiKeyError && <p className="api-key-error">{apiKeyError}</p>}
            </div>

            {/* Key list */}
            {apiKeysLoading ? (
              <p className="settings-section-description" style={{ textAlign: 'center', padding: '1rem' }}>
                Lade API-Keys...
              </p>
            ) : apiKeys.length > 0 ? (
              <div className="api-key-list">
                {apiKeys.map((key) => (
                  <div key={key._id} className="api-key-item">
                    <div className="api-key-item-info">
                      <span className="api-key-item-name">{key.name}</span>
                      <span className="api-key-item-meta">
                        {key.prefix}... &middot; Erstellt {new Date(key.createdAt).toLocaleDateString('de-DE')}
                        {key.lastUsedAt && (
                          <> &middot; Zuletzt benutzt {new Date(key.lastUsedAt).toLocaleDateString('de-DE')}</>
                        )}
                        {key.expiresAt && (
                          <> &middot; Ablauf {new Date(key.expiresAt).toLocaleDateString('de-DE')}</>
                        )}
                      </span>
                    </div>
                    <button
                      className="btn-revoke-key"
                      onClick={() => handleRevokeKey(key._id)}
                      title="Key widerrufen"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="settings-info-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4M12 8h.01"/>
                </svg>
                <div>
                  Noch keine API-Keys erstellt. Erstelle einen Key, um extern auf deine Notizen zuzugreifen.
                </div>
              </div>
            )}
          </section>

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
                  Sprach-zu-Text Transkription
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

          {/* Admin Section */}
          {isAdmin && (
            <section className="settings-section">
              <h3 className="settings-section-title">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ marginRight: '8px' }}>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
                </svg>
                Administration
              </h3>
              <p className="settings-section-description">
                Erweiterte Verwaltungsfunktionen
              </p>

              <button
                className="btn-admin-console"
                onClick={() => {
                  onAdminClick();
                  onClose();
                }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15a3 3 0 100-6 3 3 0 000 6z"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
                </svg>
                <span>Admin-Konsole öffnen</span>
              </button>

              <div className="settings-info-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4M12 8h.01"/>
                </svg>
                <div>
                  <strong>Hinweis:</strong> Die Admin-Konsole ermöglicht die Verwaltung von Benutzern und System-Einstellungen.
                </div>
              </div>
            </section>
          )}
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
