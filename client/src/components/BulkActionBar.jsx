import React, { useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';

/**
 * Aktionsleiste für die Mehrfachauswahl (v1.10.0).
 *
 * Erscheint über der Notizliste, sobald Karten angehakt sind: Anheften,
 * Archivieren, Tag anhängen, in einen Ordner verschieben, Löschen — die
 * Aktionen selbst laufen im useNotesManager (sequenziell, mit einem
 * Sammel-Toast am Ende).
 */
function BulkActionBar({
  count,
  busy = false,
  folders = [],
  onPin,
  onUnpin,
  onArchive,
  onDelete,
  onAddTag,
  onMove,
  onCancel,
}) {
  const { t } = useLanguage();
  const [tagInput, setTagInput] = useState('');

  const submitTag = () => {
    const trimmed = tagInput.trim();
    if (!/^[a-zA-Z0-9äöüÄÖÜß\-_]{1,50}$/.test(trimmed)) return;
    onAddTag(trimmed);
    setTagInput('');
  };

  return (
    <div className="bulk-action-bar" role="toolbar" aria-label={t('bulkToolbarLabel')}>
      <span className="bulk-action-count">{t('bulkSelected', { count })}</span>
      <div className="bulk-action-buttons">
        <button type="button" onClick={onPin} disabled={busy} title={t('bulkPin')}>
          {t('bulkPin')}
        </button>
        <button type="button" onClick={onUnpin} disabled={busy} title={t('bulkUnpin')}>
          {t('bulkUnpin')}
        </button>
        <button type="button" onClick={onArchive} disabled={busy} title={t('bulkArchive')}>
          {t('bulkArchive')}
        </button>
        <button type="button" onClick={onDelete} disabled={busy} title={t('bulkDelete')} className="bulk-danger">
          {t('bulkDelete')}
        </button>
      </div>
      <div className="bulk-action-inputs">
        <input
          type="text"
          className="bulk-tag-input"
          placeholder={t('bulkTagPlaceholder')}
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              submitTag();
            }
          }}
          onBlur={submitTag}
          maxLength={50}
          disabled={busy}
          aria-label={t('bulkTagPlaceholder')}
        />
        <select
          className="bulk-folder-select"
          defaultValue=""
          onChange={(e) => {
            const value = e.target.value;
            e.target.value = '';
            if (value !== '') onMove(value === '__root__' ? null : value);
          }}
          disabled={busy}
          aria-label={t('bulkMove')}
        >
          <option value="" disabled>{t('bulkMove')}</option>
          <option value="__root__">{t('topLevel')}</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {' '.repeat(folder.depth * 2)}{folder.title}
            </option>
          ))}
        </select>
      </div>
      <button type="button" className="bulk-cancel" onClick={onCancel} disabled={busy}>
        {t('cancelSelection')}
      </button>
    </div>
  );
}

export default BulkActionBar;
