import React, { useCallback, useState } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import notesAPI from '../services/api/notesAPI';
import { resolveApiErrorMessage } from '../utils/apiErrors.mjs';

/**
 * Revisions-Historie einer Notiz (v1.14.0 Nr. 7): Der Server speichert bei
 * jedem Speichern eine Revision (v1.13.0), aber keine UI zeigte sie — die
 * Daten waren nur über curl erreichbar. Die Liste wird lazy beim ersten
 * Öffnen geholt (nur Metadaten), der Volltext einer Fassung erst auf Klick
 * (?at=), Restore läuft als normales updateNote (409 inklusive).
 *
 * Selbstständige Komponente statt NoteModal-Erweiterung: Das Modal hat schon
 * 1600+ Zeilen State; die Historie hat ihren eigenen Lade-/Fehler-Zustand.
 */
function NoteHistory({ noteId, onRestored }) {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState(null);
  const [listError, setListError] = useState(null);
  // Vorschau: { savedAt, title, content, isTodoList, todoItems }
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [busy, setBusy] = useState(false); // lädt Liste oder Vorschau
  const [restoring, setRestoring] = useState(false);
  const [restoredSavedAt, setRestoredSavedAt] = useState(null);

  const formatSavedAt = useCallback((savedAt) => {
    const date = new Date(savedAt);
    return Number.isNaN(date.getTime())
      ? String(savedAt)
      : date.toLocaleString(language === 'de' ? 'de-DE' : 'en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
  }, [language]);

  const loadRevisions = useCallback(async () => {
    setBusy(true);
    setListError(null);
    try {
      const list = await notesAPI.getRevisions(noteId);
      setRevisions(Array.isArray(list) ? list : []);
    } catch (error) {
      setListError(resolveApiErrorMessage(error, t, 'noteHistoryLoadFailed'));
    } finally {
      setBusy(false);
    }
  }, [noteId, t]);

  const handleToggle = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen && revisions === null && !listError) {
        loadRevisions();
      }
      return !wasOpen;
    });
  }, [revisions, listError, loadRevisions]);

  const handleSelect = useCallback(async (savedAt) => {
    if (preview?.savedAt && String(preview.savedAt) === String(savedAt)) {
      // Dieselbe Fassung erneut angetippt: Das „wiederhergestellt"-Banner
      // blockiert den Restore-Button sonst bis zum Schließen der Modal —
      // ein zweiter Restore derselben Fassung war so unmöglich.
      setRestoredSavedAt(null);
      return;
    }
    setPreview(null);
    setPreviewError(null);
    setBusy(true);
    try {
      const revision = await notesAPI.getRevision(noteId, savedAt);
      // Ein Restore-Status gehört zur VORHERIGEN Vorschau — beim Wechsel auf
      // eine andere Fassung wäre ein stehen bleibendes Banner gelogen.
      setRestoredSavedAt(null);
      setPreview(revision);
    } catch (error) {
      setPreviewError(resolveApiErrorMessage(error, t, 'noteHistoryPreviewFailed'));
    } finally {
      setBusy(false);
    }
  }, [noteId, preview, t]);

  const handleRestore = useCallback(async () => {
    if (!preview) return;
    setRestoring(true);
    setPreviewError(null);
    try {
      const updatedNote = await notesAPI.restoreRevision(noteId, preview.savedAt);
      setRestoredSavedAt(preview.savedAt);
      onRestored?.(updatedNote, preview);
      // Der aktuelle Stand ist jetzt selbst die jüngste Revision — Liste
      // neu lesen, damit die Historie stimmt.
      loadRevisions();
    } catch (error) {
      setPreviewError(resolveApiErrorMessage(error, t, 'noteHistoryRestoreFailed'));
    } finally {
      setRestoring(false);
    }
  }, [noteId, preview, onRestored, loadRevisions, t]);

  if (!noteId) return null;

  return (
    <div className="note-history">
      <button
        type="button"
        className="note-history-toggle"
        onClick={handleToggle}
        aria-expanded={open}
      >
        <span className="note-history-toggle-icon">{open ? '▾' : '▸'}</span>
        {t('noteHistory')}
        {revisions !== null && <span className="note-history-count">{revisions.length}</span>}
      </button>

      {open && (
        <div className="note-history-body">
          {busy && revisions === null && (
            <p className="note-history-hint">{t('noteHistoryLoading')}</p>
          )}
          {listError && (
            <p className="note-history-error" role="alert">{listError}</p>
          )}
          {revisions !== null && revisions.length === 0 && !listError && (
            <p className="note-history-hint">{t('noteHistoryEmpty')}</p>
          )}
          {revisions !== null && revisions.length > 0 && (
            <ul className="note-history-list">
              {revisions.map((revision) => (
                <li key={String(revision.savedAt)}>
                  <button
                    type="button"
                    className={
                      preview && String(preview.savedAt) === String(revision.savedAt)
                        ? 'note-history-entry is-selected'
                        : 'note-history-entry'
                    }
                    onClick={() => handleSelect(revision.savedAt)}
                  >
                    <span className="note-history-entry-title">
                      {revision.title || t('noteHistoryUntitled')}
                    </span>
                    <span className="note-history-entry-meta">
                      {formatSavedAt(revision.savedAt)}
                      {revision.isTodoList && ` · ${t('noteHistoryTodo')}`}
                      {` · ${revision.contentLength} ${t('noteHistoryChars')}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {preview && (
            <div className="note-history-preview">
              <p className="note-history-preview-title">
                {preview.title || t('noteHistoryUntitled')}
                <span className="note-history-entry-meta">
                  {' '}{formatSavedAt(preview.savedAt)}
                </span>
              </p>
              {preview.isTodoList && Array.isArray(preview.todoItems) && preview.todoItems.length > 0 ? (
                <ul className="note-history-preview-todos">
                  {preview.todoItems.map((item, index) => (
                    <li key={index} className={item.completed ? 'is-done' : ''}>
                      {item.completed ? '☑' : '☐'} {item.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <pre className="note-history-preview-content">{preview.content}</pre>
              )}
              {restoredSavedAt && String(restoredSavedAt) === String(preview.savedAt) ? (
                <p className="note-history-restored" role="status">{t('noteHistoryRestored')}</p>
              ) : (
                <button
                  type="button"
                  className="note-history-restore"
                  onClick={handleRestore}
                  disabled={restoring}
                >
                  {restoring ? t('noteHistoryRestoring') : t('noteHistoryRestore')}
                </button>
              )}
            </div>
          )}
          {previewError && (
            <p className="note-history-error" role="alert">{previewError}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default NoteHistory;
