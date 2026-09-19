/**
 * Settings Component
 * User preferences and feature toggles
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { getApiKeys, createApiKey, revokeApiKey } from '../services/api/apiKeysAPI';
import { authAPI, notesAPI } from '../services/api';
import './Settings.css';
import { useBackdropClose } from '../hooks/useBackdropClose';
import { useModalA11y } from '../hooks/useModalA11y';
import LanguageSelector from './LanguageSelector';
import { useLanguage } from '../contexts/LanguageContext';
import { copyToClipboard } from '../utils/clipboard.mjs';
import { toastBus } from './ToastStack';
import { resolveApiErrorMessage } from '../utils/apiErrors.mjs';

function Settings({ onClose, isAdmin, onAdminClick, folders = [], onDataImported }) {
  const { t, language } = useLanguage();
  const { settings, toggleAIFeature, setTranscriptionLanguage, setJournalFolderId } = useSettings();

  // v1.10.0: Markdown-Export (ZIP vom Server) und Trilium/Markdown-Import
  // (Ordner mit .md/.txt — Unterordner werden zu Ordner-Notizen im Baum).
  const [mdBusy, setMdBusy] = useState(null); // 'export' | 'import' | null
  const mdImportInputRef = useRef(null);
  // API Keys state
  const [apiKeys, setApiKeys] = useState([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyExpiry, setNewKeyExpiry] = useState('never');
  const [createdKey, setCreatedKey] = useState(null);
  const [apiKeysLoading, setApiKeysLoading] = useState(false);
  const [apiKeyError, setApiKeyError] = useState('');
  const [keyCopied, setKeyCopied] = useState(false);

  // Passwort ändern: der Server erhöht sessionVersion, meldet also alle anderen
  // Geräte ab und stellt für diese Sitzung ein neues Cookie aus.
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');

  const validateNewPassword = (value) => {
    if (value.length < 8) return t('passwordMinLength');
    if (value.length > 128) return t('passwordMaxLength');
    if (!/[a-z]/.test(value)) return t('passwordNeedsLower');
    if (!/[A-Z]/.test(value)) return t('passwordNeedsUpper');
    if (!/[0-9]/.test(value)) return t('passwordNeedsNumber');
    return null;
  };

  const handleChangePassword = async (event) => {
    event.preventDefault();
    setPwError('');

    if (!pwCurrent || !pwNew || !pwConfirm) {
      setPwError(t('fillAllFields'));
      return;
    }
    if (pwNew !== pwConfirm) {
      setPwError(t('passwordsDontMatch'));
      return;
    }
    const strengthError = validateNewPassword(pwNew);
    if (strengthError) {
      setPwError(strengthError);
      return;
    }

    setPwBusy(true);
    try {
      await authAPI.changePassword(pwCurrent, pwNew);
      setPwCurrent('');
      setPwNew('');
      setPwConfirm('');
      toastBus.success(t('passwordChanged'));
    } catch (err) {
      setPwError(resolveApiErrorMessage(err, t, 'passwordChangeFailed'));
    } finally {
      setPwBusy(false);
    }
  };

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
      setApiKeyError(t('apiKeyNameRequired'));
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
      setApiKeyError(resolveApiErrorMessage(err, t));
    }
  };

  const handleRevokeKey = async (id) => {
    try {
      await revokeApiKey(id);
      loadApiKeys();
    } catch (err) {
      setApiKeyError(resolveApiErrorMessage(err, t));
    }
  };

  const handleCopyKey = async () => {
    if (!createdKey) return;
    // Die asynchrone Clipboard-API gibt es nur in sicheren Kontexten (HTTPS);
    // der Helper fällt auf eine versteckte Textarea + execCommand zurück, damit
    // Kopieren auch auf HTTP-Deployments funktioniert.
    const copied = await copyToClipboard(createdKey);
    if (copied) {
      setKeyCopied(true);
      toastBus.success(t('copied'));
      setTimeout(() => setKeyCopied(false), 2000);
    } else {
      toastBus.error(t('copyToClipboardFailed'));
    }
  };

  const backdropClose = useBackdropClose(onClose);

  // v1.10.0: Ganzen Baum als Markdown-ZIP exportieren (der Server baut das
  // ZIP inkl. _index.md pro Ordner, hier bleibt nur der Download).
  const handleExportMarkdown = async () => {
    setMdBusy('export');
    try {
      const blob = await notesAPI.exportMarkdown();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'keeplocal-export.zip';
      link.click();
      // ObjectURL erst nach dem Download-Fenster abbauen, nicht sofort.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toastBus.success(t('exportMarkdownDone'));
    } catch (err) {
      toastBus.error(resolveApiErrorMessage(err, t, 'exportMarkdownFailed'));
    } finally {
      setMdBusy(null);
    }
  };

  // Trilium/Markdown-Import: Der Browser liefert mit webkitdirectory das
  // ganze Verzeichnis; jedes Verzeichnis-Segment wird zu einer Ordner-Notiz
  // (angelegt bei Bedarf, bottom-up), jede .md/.txt zu einer Notiz darin.
  // Nur Text — Bilder und Binärdateien überspringt der Import bewusst.
  const handleImportMarkdown = async (event) => {
    const files = Array.from(event.target.files || []);
    if (mdImportInputRef.current) mdImportInputRef.current.value = '';
    if (files.length === 0) return;
    setMdBusy('import');
    let created = 0;
    try {
      const folderIdsByPath = new Map();
      const ensureFolder = async (dirPath) => {
        if (!dirPath) return null;
        if (folderIdsByPath.has(dirPath)) return folderIdsByPath.get(dirPath);
        const segments = dirPath.split('/');
        const parentId = await ensureFolder(segments.slice(0, -1).join('/'));
        const folder = await notesAPI.create({
          title: segments[segments.length - 1].slice(0, 200),
          content: '',
          parentId: parentId ?? undefined
        });
        folderIdsByPath.set(dirPath, folder._id);
        created += 1;
        return folder._id;
      };

      // Dateien nach Pfad sortieren, damit Eltern vor Kindern drankommen —
      // die ensureFolder-Rekursion legt zwar selbst an, aber so stimmt die
      // Reihenfolge im Baum schon beim Anlegen.
      files.sort((a, b) => (a.webkitRelativePath || a.name).localeCompare(b.webkitRelativePath || b.name));

      for (const file of files) {
        if (!/\.(md|markdown|txt)$/i.test(file.name) || file.size > 500_000) continue;
        const segments = (file.webkitRelativePath || file.name).split('/');
        const fileName = segments.pop();
        const parentId = await ensureFolder(segments.join('/'));
        const text = await file.text();
        let noteTitle = fileName.replace(/\.(md|markdown|txt)$/i, '').slice(0, 200);
        // index.md/_index.md (Trilium-Export-Konvention) trägt oft nur einen
        // Titel in der ersten Überschrift — dann den nehmen.
        if (noteTitle === 'index' || noteTitle === '_index') {
          const heading = /^#\s+(.+)$/m.exec(text);
          noteTitle = (heading ? heading[1] : segments[segments.length - 1] || 'Notiz').trim().slice(0, 200);
        }
        await notesAPI.create({
          title: noteTitle || 'Notiz',
          content: text.slice(0, 10_000),
          parentId: parentId ?? undefined
        });
        created += 1;
      }
      toastBus.success(t('importMarkdownDone', { count: created }));
      onDataImported?.();
    } catch (err) {
      console.error('Markdown-Import fehlgeschlagen:', err);
      toastBus.error(resolveApiErrorMessage(err, t, 'importMarkdownFailed'));
    } finally {
      setMdBusy(null);
    }
  };

  // Settings renders as a full-screen overlay, so it gets the same dialog
  // semantics (focus trap, initial focus, focus restore, Escape) as the modals.
  const { containerRef, titleId } = useModalA11y({ onClose });

  return (
    <div className="settings-overlay" {...backdropClose}>
      <div
        className="settings-modal"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-header">
          <h2 id={titleId}>{t('settings')}</h2>
          <button className="settings-close" onClick={onClose} aria-label={t('close')}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="settings-content">
          {/* Language Section — the UI language must be reachable while logged in,
              not only on the login/register screens. */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ marginRight: '8px' }}>
                <circle cx="12" cy="12" r="10"/>
                <path d="M2 12h20M12 2a15.3 15.3 0 010 20M12 2a15.3 15.3 0 000 20"/>
              </svg>
              {t('languageSection')}
            </h3>
            <p className="settings-section-description">
              {t('languageSectionDescription')}
            </p>
            <div className="settings-language">
              <LanguageSelector />
            </div>
          </section>

          {/* Password Section */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ marginRight: '8px' }}>
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0110 0v4"/>
              </svg>
              {t('changePasswordSection')}
            </h3>
            <p className="settings-section-description">
              {t('changePasswordDescription')}
            </p>

            <form className="settings-password-form" onSubmit={handleChangePassword} noValidate>
              <div className="settings-input-group">
                <label htmlFor="current-password" className="settings-input-label">
                  {t('currentPassword')}
                </label>
                <input
                  id="current-password"
                  type="password"
                  className="settings-input"
                  value={pwCurrent}
                  onChange={(e) => setPwCurrent(e.target.value)}
                  autoComplete="current-password"
                  disabled={pwBusy}
                  maxLength={128}
                  required
                />
              </div>
              <div className="settings-input-group">
                <label htmlFor="new-password" className="settings-input-label">
                  {t('newPassword')}
                </label>
                <input
                  id="new-password"
                  type="password"
                  className="settings-input"
                  value={pwNew}
                  onChange={(e) => setPwNew(e.target.value)}
                  autoComplete="new-password"
                  disabled={pwBusy}
                  minLength={8}
                  maxLength={128}
                  required
                />
              </div>
              <div className="settings-input-group">
                <label htmlFor="confirm-new-password" className="settings-input-label">
                  {t('confirmPasswordLabel')}
                </label>
                <input
                  id="confirm-new-password"
                  type="password"
                  className="settings-input"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  autoComplete="new-password"
                  disabled={pwBusy}
                  minLength={8}
                  maxLength={128}
                  required
                />
              </div>

              {pwError && (
                <p className="settings-error" role="alert">{pwError}</p>
              )}

              <button type="submit" className="btn-change-password" disabled={pwBusy}>
                {pwBusy ? t('saving') : t('changePassword')}
              </button>
              <p className="settings-input-hint">{t('passwordChangeSessionsHint')}</p>
            </form>
          </section>

          {/* API Keys Section */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ marginRight: '8px' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
              {t('apiKeysSection')}
            </h3>
            <p className="settings-section-description">
              {t('apiKeysDescription')} <code className="settings-code-inline">/api/docs</code>
            </p>

            {/* Created key display */}
            {createdKey && (
              <div className="settings-warning-box" style={{ marginBottom: '1rem' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{t('apiKeyCopyWarning')}</strong>
                  <div className="api-key-created-value">
                    <code className="settings-code-inline" style={{ wordBreak: 'break-all', display: 'block', marginTop: '0.5rem' }}>
                      {createdKey}
                    </code>
                    <button className="btn-copy-key" onClick={handleCopyKey}>
                      {keyCopied ? t('copied') : t('copy')}
                    </button>
                  </div>
                  <button
                    className="btn-dismiss-key"
                    onClick={() => setCreatedKey(null)}
                  >
                    {t('apiKeyDismissSaved')}
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
                  placeholder={t('apiKeyNamePlaceholder')}
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateKey()}
                  maxLength={100}
                />
                <select
                  className="settings-input api-key-expiry-select"
                  value={newKeyExpiry}
                  onChange={(e) => setNewKeyExpiry(e.target.value)}
                  aria-label={t('apiKeyExpiryLabel')}
                >
                  <option value="never">{t('apiKeyExpiryNever')}</option>
                  <option value="30">{t('apiKeyExpiry30')}</option>
                  <option value="90">{t('apiKeyExpiry90')}</option>
                  <option value="365">{t('apiKeyExpiryYear')}</option>
                </select>
                <button className="btn-create-key" onClick={handleCreateKey}>
                  {t('create')}
                </button>
              </div>
              {apiKeyError && <p className="api-key-error">{apiKeyError}</p>}
            </div>

            {/* Key list */}
            {apiKeysLoading ? (
              <p className="settings-section-description" style={{ textAlign: 'center', padding: '1rem' }}>
                {t('loadingApiKeys')}
              </p>
            ) : apiKeys.length > 0 ? (
              <div className="api-key-list">
                {apiKeys.map((key) => (
                  <div key={key._id} className="api-key-item">
                    <div className="api-key-item-info">
                      <span className="api-key-item-name">{key.name}</span>
                      <span className="api-key-item-meta">
                        {key.prefix}... &middot; {t('apiKeyCreatedMeta')} {new Date(key.createdAt).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB')}
                        {key.lastUsedAt && (
                          <> &middot; {t('apiKeyLastUsedMeta')} {new Date(key.lastUsedAt).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB')}</>
                        )}
                        {key.expiresAt && (
                          <> &middot; {t('apiKeyExpiresMeta')} {new Date(key.expiresAt).toLocaleDateString(language === 'de' ? 'de-DE' : 'en-GB')}</>
                        )}
                      </span>
                    </div>
                    <button
                      className="btn-revoke-key"
                      onClick={() => handleRevokeKey(key._id)}
                      title={t('apiKeyRevokeTitle')}
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
                  {t('apiKeyEmptyHint')}
                </div>
              </div>
            )}
          </section>

          {/* Data Section (v1.10.0): Markdown round-trip + Journal-Ordner */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ marginRight: '8px' }}>
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
              </svg>
              {t('dataSection')}
            </h3>
            <p className="settings-section-description">{t('dataSectionDescription')}</p>

            <div className="settings-item">
              <div className="settings-item-info">
                <label className="settings-item-label">{t('exportMarkdownTitle')}</label>
                <p className="settings-item-description">{t('exportMarkdownHint')}</p>
              </div>
              <div className="settings-item-control">
                <button
                  type="button"
                  className="btn-change-password"
                  onClick={handleExportMarkdown}
                  disabled={mdBusy !== null}
                >
                  {mdBusy === 'export' ? t('saving') : t('exportAction')}
                </button>
              </div>
            </div>

            <div className="settings-item">
              <div className="settings-item-info">
                <label className="settings-item-label">{t('importMarkdownTitle')}</label>
                <p className="settings-item-description">{t('importMarkdownHint')}</p>
              </div>
              <div className="settings-item-control">
                <input
                  ref={mdImportInputRef}
                  type="file"
                  multiple
                  onChange={handleImportMarkdown}
                  style={{ display: 'none' }}
                  id="markdown-import-input"
                  aria-hidden="true"
                  tabIndex={-1}
                />
                <button
                  type="button"
                  className="btn-change-password"
                  // webkitdirectory/directory sind keine React-Props — als
                  // DOM-Attribute gesetzt, bevor der Picker aufgeht.
                  onClick={() => {
                    const input = mdImportInputRef.current;
                    if (!input) return;
                    input.setAttribute('webkitdirectory', '');
                    input.setAttribute('directory', '');
                    input.click();
                  }}
                  disabled={mdBusy !== null}
                >
                  {mdBusy === 'import' ? t('saving') : t('importAction')}
                </button>
              </div>
            </div>

            <div className="settings-input-group" style={{ marginTop: '1rem' }}>
              <label htmlFor="journal-folder" className="settings-input-label">
                {t('journalFolderLabel')}
              </label>
              <select
                id="journal-folder"
                className="settings-input"
                value={settings.journalFolderId || ''}
                onChange={(e) => setJournalFolderId(e.target.value || null)}
              >
                <option value="">{t('topLevel')}</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {' '.repeat(folder.depth * 2)}{folder.title}
                  </option>
                ))}
              </select>
              <p className="settings-input-hint">{t('journalFolderHint')}</p>
            </div>
          </section>

          {/* AI Features Section */}
          <section className="settings-section">
            <h3 className="settings-section-title">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ marginRight: '8px' }}>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              {t('aiFeaturesSection')}
            </h3>
            <p className="settings-section-description">
              {t('aiFeaturesDescription')}
            </p>

            <div className="settings-item">
              <div className="settings-item-info">
                <label htmlFor="voice-transcription" className="settings-item-label">
                  {t('voiceTranscription')}
                </label>
                <p className="settings-item-description">
                  {t('voiceTranscriptionDescription')}
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
                  <strong>{t('noteLabel')}:</strong> {t('transcriptionLocalNote')}
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
              {t('transcriptionConfigSection')}
            </h3>
            <p className="settings-section-description">
              {t('transcriptionConfigDescription')}
            </p>

            <div className="settings-input-group">
              <label htmlFor="transcription-language" className="settings-input-label">
                {t('inputLanguage')}
              </label>
              <select
                id="transcription-language"
                className="settings-input"
                value={settings.transcriptionLanguage}
                onChange={(e) => setTranscriptionLanguage(e.target.value)}
              >
                <option value="auto">{t('langAuto')}</option>
                <option value="de">{t('langDe')}</option>
                <option value="en">{t('langEn')}</option>
                <option value="es">{t('langEs')}</option>
                <option value="fr">{t('langFr')}</option>
                <option value="it">{t('langIt')}</option>
                <option value="pt">{t('langPt')}</option>
                <option value="nl">{t('langNl')}</option>
                <option value="pl">{t('langPl')}</option>
                <option value="ru">{t('langRu')}</option>
                <option value="zh">{t('langZh')}</option>
                <option value="ja">{t('langJa')}</option>
                <option value="ko">{t('langKo')}</option>
                <option value="ar">{t('langAr')}</option>
                <option value="tr">{t('langTr')}</option>
              </select>
              <p className="settings-input-hint">
                {t('transcriptionLanguageHint')}
              </p>
            </div>

            <div className="settings-info-box">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <circle cx="12" cy="12" r="10"/>
                <path d="M12 16v-4M12 8h.01"/>
              </svg>
              <div>
                <strong>{t('serverConfigLabel')}</strong> {t('serverConfigIntro')}{' '}
                <code className="settings-code-inline">docker-compose.yml</code> {t('serverConfigVia')}{' '}
                <code className="settings-code-inline">AI_SERVICE_URL</code> {t('serverConfigDefault')}{' '}
                <code className="settings-code-inline">http://ai:5000</code>).
                {t('serverConfigExternal')}
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
                {t('administrationSection')}
              </h3>
              <p className="settings-section-description">
                {t('administrationDescription')}
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
                <span>{t('openAdminConsole')}</span>
              </button>

              <div className="settings-info-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4M12 8h.01"/>
                </svg>
                <div>
                  <strong>{t('noteLabel')}:</strong> {t('adminConsoleHint')}
                </div>
              </div>
            </section>
          )}
        </div>

        <div className="settings-footer">
          <button className="btn-settings-close" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Settings;
