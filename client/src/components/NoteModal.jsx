import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useLanguage } from '../contexts/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import './NoteModal.css';
import ColorPicker from './ColorPicker';
import LinkPreview from './LinkPreview';
import ConfirmDialog from './ConfirmDialog';
import { toastBus } from './ToastStack';
import { getColorVar } from '../utils/colorMapper';
import { isNoteOwner, noteOwnerName, lastEditorName } from '../utils/noteAccess.mjs';
import { useLinkPreview, useTodoList, useModalShortcuts } from '../hooks';
import { useModalA11y } from '../hooks/useModalA11y';
import { useBackdropClose } from '../hooks/useBackdropClose';
import notesAPI from '../services/api/notesAPI';
import { resolveApiErrorMessage } from '../utils/apiErrors.mjs';

/**
 * Detect optimistic-locking conflicts (PUT /api/notes/:id with baseUpdatedAt
 * answers 409). apiUtils throws plain Errors, so every known representation
 * of the status is checked; anything else is treated as a generic error.
 */
function isNoteConflictError(error) {
  return Boolean(
    error &&
      (error.status === 409 ||
        error.statusCode === 409 ||
        error.isNoteConflict === true ||
        error.conflict === true)
  );
}

function NoteModal({ note, serverNote, onSave, onClose, onToggleArchive, onOpenCollaborate, onDelete }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { settings } = useSettings();
  const isDemo = Boolean(user?.isDemo);
  // Geteilte Notiz: Inhalt/Titel/Tags/Farbe/Pin dürfen Mitbearbeiter ändern,
  // Archivieren/Teilen/Löschen/Bilder/Aufnahme bleiben beim Besitzer (der
  // Server antwortet sonst mit 404 „Notiz nicht gefunden“).
  const canManage = !note || isNoteOwner(note, user);
  const editorName = lastEditorName(serverNote || note);
  const [title, setTitle] = useState(note?.title || '');
  const [content, setContent] = useState(note?.content || '');
  const [tags, setTags] = useState(note?.tags || []);
  const [tagInput, setTagInput] = useState('');
  const [color, setColor] = useState(note?.color || '#ffffff');
  const [isTodoList, setIsTodoList] = useState(note?.isTodoList || false);
  const [isPinned, setIsPinned] = useState(note?.isPinned || false);
  const [images, setImages] = useState(note?.images || []);
  const [newImageFiles, setNewImageFiles] = useState([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [lightboxImage, setLightboxImage] = useState(null); // {index, url}
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Optimistic locking: server version that beat our edit (null = no conflict).
  const [conflict, setConflict] = useState(null);
  const [showConflictDiscardConfirm, setShowConflictDiscardConfirm] = useState(false);
  // note.updatedAt at the time the modal was opened (or the server version was
  // loaded) — sent as baseUpdatedAt on every non-forced PUT.
  const baseUpdatedAtRef = useRef(note?.updatedAt || null);
  const contentTextareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  // Die letzte Aufnahme bleibt hier liegen, damit ein 429 (Transkriptionsdienst
  // ausgelastet) nicht die gesprochene Minute kostet: Der Toast bietet
  // „Erneut versuchen" mit demselben Blob an.
  const lastAudioBlobRef = useRef(null);

  useEffect(() => () => {
    // Without an explicit null check this cleanup throws on EVERY unmount:
    // `null?.state !== 'inactive'` is true, and the next line dereferences the
    // empty ref — the ErrorBoundary then replaces the whole app as soon as the
    // editor closes (or immediately on open in StrictMode/dev).
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null;
      recorder.stop();
    }
    mediaStreamRef.current?.getTracks().forEach(track => track.stop());
    lastAudioBlobRef.current = null;
  }, []);

  // Custom hooks for link preview and todo list management
  const { linkPreviews, setLinkPreviews, removeLinkPreview } = useLinkPreview(content, !isTodoList && !isDemo);
  const {
    todoItems,
    setTodoItems,
    updateItemText: handleTodoItemChange,
    toggleItem: handleTodoItemToggle,
    deleteItem: handleTodoItemDelete,
    handleItemKeyDown: handleTodoItemKeyDown,
    getCleanedItems,
  } = useTodoList(note?.todoItems || []);

  // Reset the form to a note object. Used when the note prop changes (modal
  // re-opened) and when the server version is loaded after a conflict.
  const applyNoteToForm = useCallback((source) => {
    if (!source) return;
    setTitle(source.title || '');
    setContent(source.content || '');
    setTags(source.tags || []);
    setTagInput('');
    setColor(source.color || '#ffffff');
    setIsTodoList(source.isTodoList || false);
    setIsPinned(source.isPinned || false);
    setTodoItems(source.todoItems || []);
    setLinkPreviews(source.linkPreviews || []);
    setImages(source.images || []);
  }, [setTodoItems, setLinkPreviews]);

  // Update state when note changes
  useEffect(() => {
    if (note) {
      applyNoteToForm(note);
      baseUpdatedAtRef.current = note.updatedAt || null;
      setConflict(null);
      setShowConflictDiscardConfirm(false);
    }
  }, [note, applyNoteToForm]);

  // Live-Konflikt: Der 60-s-Poll (bzw. der Focus-Refresh) liefert die Notiz aus
  // der Liste. Ändert sie sich, während der Editor offen ist, zeigen wir das
  // Konfliktbanner statt den Inhalt still zu überschreiben oder den Nutzer
  // ahnungslos speichern zu lassen.
  const serverUpdatedAt = serverNote?.updatedAt;
  useEffect(() => {
    if (!note || !serverUpdatedAt || !baseUpdatedAtRef.current) return;
    if (serverUpdatedAt === baseUpdatedAtRef.current) return;
    setConflict(previous => (previous ? previous : { currentNote: serverNote }));
  }, [note, serverNote, serverUpdatedAt]);

  // Auto-resize textarea to fit content
  useEffect(() => {
    if (contentTextareaRef.current && !isTodoList) {
      const textarea = contentTextareaRef.current;
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set height to scrollHeight to fit all content
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  }, [content, isTodoList]);

  // Initial resize when note is loaded (handles case where content is set before textarea is rendered)
  useEffect(() => {
    if (note && contentTextareaRef.current && !isTodoList) {
      // Small delay to ensure textarea is fully rendered
      setTimeout(() => {
        if (contentTextareaRef.current) {
          const textarea = contentTextareaRef.current;
          textarea.style.height = 'auto';
          textarea.style.height = `${textarea.scrollHeight}px`;
        }
      }, 0);
    }
  }, [note, isTodoList]);

  // Fetch the current server version of the note (used on 409 conflicts —
  // apiUtils discards the 409 body, so the note is re-fetched via getById).
  const fetchCurrentNote = useCallback(async () => {
    if (!note) return null;
    try {
      return await notesAPI.getById(note._id);
    } catch {
      return null;
    }
  }, [note]);

  // Show the inline conflict banner. Fetches the server note so
  // "Server-Version laden" works without another round-trip.
  const showConflictBanner = useCallback(async () => {
    const currentNote = await fetchCurrentNote();
    setConflict({ currentNote });
    if (!currentNote) {
      toastBus.error(t('conflictLoadFailed'));
    }
  }, [fetchCurrentNote, t]);

  // The current App.jsx wiring catches save errors itself (toast) and returns
  // null instead of rethrowing, so a failed save probes the server version:
  // a changed updatedAt means the failure was an optimistic-locking conflict.
  const detectConflictAfterFailedSave = useCallback(async () => {
    if (!note || !baseUpdatedAtRef.current) return;
    const currentNote = await fetchCurrentNote();
    if (currentNote?.updatedAt && currentNote.updatedAt !== baseUpdatedAtRef.current) {
      setConflict({ currentNote });
    }
  }, [note, fetchCurrentNote]);

  /**
   * Persist the note.
   * @param {{force?: boolean}} [options] force=true sends no baseUpdatedAt
   *   (last-write-wins) — used by the conflict banner's overwrite button.
   */
  const saveNote = async (options = {}) => {
    const forceOverwrite = Boolean(options.force);
    if (isSaving) return;
    // Validate based on mode
    if (isTodoList) {
      if (todoItems.length === 0 || todoItems.every((item) => !item.text.trim())) {
        return;
      }
    } else {
      if (!content.trim()) {
        return;
      }
    }

    // Add any pending tag from input
    let finalTags = [...tags];
    if (tagInput.trim()) {
      const newTags = tagInput
        .split(',')
        .map((tag) => tag.trim())
        .filter((tag) => /^[a-zA-Z0-9äöüÄÖÜß\-_]{1,50}$/.test(tag) && !finalTags.includes(tag));
      finalTags = [...finalTags, ...newTags].slice(0, 50);
    }

    const noteData = {
      title: title.trim(),
      content: isTodoList ? '' : content.trim(),
      tags: finalTags,
      color: color,
      isPinned: isPinned,
      isTodoList: isTodoList,
      todoItems: isTodoList ? getCleanedItems() : [],
      linkPreviews: isDemo ? [] : (linkPreviews || []),
    };

    // Optimistic locking (edits only — creates have no server version yet).
    const payload = { ...noteData };
    if (note && !forceOverwrite && baseUpdatedAtRef.current) {
      payload.baseUpdatedAt = baseUpdatedAtRef.current;
    }

    setIsSaving(true);
    try {
      const savedNote = await onSave(payload);
      if (savedNote) {
        if (forceOverwrite) {
          toastBus.success(t('conflictOverwritten'));
        }
        onClose();
        return;
      }
      // onSave swallowed the error (already toasted by App) — check whether a
      // conflict caused it before giving up silently.
      await detectConflictAfterFailedSave();
    } catch (error) {
      if (note && isNoteConflictError(error)) {
        await showConflictBanner();
      } else {
        toastBus.error(resolveApiErrorMessage(error, t, 'errorUpdating'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSave = () => saveNote();

  // Conflict banner: load the server version into the form. Local changes are
  // discarded after an explicit confirmation (see ConfirmDialog below).
  const handleLoadServerVersion = async () => {
    const currentNote = conflict?.currentNote || (await fetchCurrentNote());
    if (!currentNote) {
      setConflict({ currentNote: null });
      toastBus.error(t('conflictLoadFailed'));
      return;
    }
    applyNoteToForm(currentNote);
    if (currentNote.updatedAt) {
      baseUpdatedAtRef.current = currentNote.updatedAt;
    }
    setConflict(null);
    toastBus.info(t('conflictServerVersionLoaded'));
  };

  // Handle tag input
  const handleTagInputKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTagFromInput();
    } else if (e.key === 'Backspace' && tagInput === '' && tags.length > 0) {
      // Remove last tag if backspace is pressed on empty input
      removeTag(tags.length - 1);
    }
  };

  const addTagFromInput = () => {
    const newTags = tagInput
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => /^[a-zA-Z0-9äöüÄÖÜß\-_]{1,50}$/.test(tag) && !tags.includes(tag));

    if (newTags.length > 0) {
      setTags([...tags, ...newTags].slice(0, 50));
      setTagInput('');
    }
  };

  const removeTag = (index) => {
    setTags(tags.filter((_, i) => i !== index));
  };

  const handleToggleTodoMode = () => {
    const newMode = !isTodoList;
    setIsTodoList(newMode);

    // When switching to todo mode, convert content to todo items
    if (newMode) {
      if (content.trim()) {
        const lines = content.split('\n').filter((line) => line.trim());
        const items = lines.map((line, index) => ({
          text: line.trim(),
          completed: false,
          order: index,
        }));
        setTodoItems(items);
        setContent('');
      } else {
        // Start with one empty item
        setTodoItems([{ text: '', completed: false, order: 0 }]);
      }
    }
    // When switching to regular mode, convert todo items to content
    else if (!newMode && todoItems.length > 0) {
      const contentText = todoItems.map((item) => item.text).join('\n');
      setContent(contentText);
      setTodoItems([]);
    }
  };

  // Add todo item handler (using the hook's internal logic via setTodoItems)
  const handleAddTodoItem = () => {
    if (todoItems.length >= 200) return;
    setTodoItems([...todoItems, { text: '', completed: false, order: todoItems.length }]);
  };

  // Image upload handlers
  const handleImageSelect = (e) => {
    const remainingSlots = Math.max(0, Math.min(5, 25 - images.length - newImageFiles.length));
    const files = Array.from(e.target.files || []).slice(0, remainingSlots);
    if (files.length > 0) {
      setNewImageFiles([...newImageFiles, ...files]);
    }
  };

  const handleImageUpload = async () => {
    if (!note || newImageFiles.length === 0) return;

    setUploadingImages(true);
    try {
      const updatedNote = await notesAPI.uploadImages(note._id, newImageFiles);
      setImages(updatedNote.images || []);
      // The upload bumped the stored note; without this the next save compares
      // against the pre-upload version and the server answers a false 409.
      if (updatedNote.updatedAt) {
        baseUpdatedAtRef.current = updatedNote.updatedAt;
      }
      setNewImageFiles([]);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Fehler beim Hochladen der Bilder:', error);
      toastBus.error(resolveApiErrorMessage(error, t, 'errorUploadingImages'));
    } finally {
      setUploadingImages(false);
    }
  };

  const handleImageDelete = async (filename) => {
    if (!note) return;

    try {
      const updatedNote = await notesAPI.deleteImage(note._id, filename);
      setImages(updatedNote.images || []);
      if (updatedNote.updatedAt) {
        baseUpdatedAtRef.current = updatedNote.updatedAt;
      }
    } catch (error) {
      console.error('Fehler beim Löschen des Bildes:', error);
      toastBus.error(resolveApiErrorMessage(error, t, 'errorDeletingImage'));
    }
  };

  const removeNewImageFile = (index) => {
    setNewImageFiles(newImageFiles.filter((_, i) => i !== index));
  };

  // Lightbox handlers
  const openLightbox = (index) => {
    setLightboxImage({ index, url: images[index].url });
  };

  const closeLightbox = () => {
    setLightboxImage(null);
  };

  const nextImage = useCallback(() => {
    if (lightboxImage && images.length > 0) {
      const nextIndex = (lightboxImage.index + 1) % images.length;
      setLightboxImage({ index: nextIndex, url: images[nextIndex].url });
    }
  }, [lightboxImage, images]);

  const prevImage = useCallback(() => {
    if (lightboxImage && images.length > 0) {
      const prevIndex = (lightboxImage.index - 1 + images.length) % images.length;
      setLightboxImage({ index: prevIndex, url: images[prevIndex].url });
    }
  }, [lightboxImage, images]);

  // Voice recording handlers
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
        lastAudioBlobRef.current = audioBlob;

        // Automatically transcribe after recording stops
        await handleTranscribe(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (error) {
      console.error('Fehler beim Starten der Aufnahme:', error);
      toastBus.error(resolveApiErrorMessage(error, t, 'errorMicrophoneAccess'));
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleTranscribe = async (audioBlob) => {
    if (!note) {
      toastBus.info(t('saveBeforeTranscribing'));
      return;
    }

    setIsTranscribing(true);
    try {
      // Use language setting from Settings
      const transcriptionOptions = {
        language: settings.transcriptionLanguage || 'auto'
      };

      const transcription = await notesAPI.transcribeAudio(note._id, audioBlob, transcriptionOptions);

      // Append transcribed text to content using functional setState to ensure latest state
      if (transcription && transcription.text) {
        setContent(prevContent => {
          const separator = prevContent.trim() ? '\n\n' : '';
          return (prevContent + separator + transcription.text).slice(0, 10000);
        });

        // Force textarea to resize after content update
        setTimeout(() => {
          if (contentTextareaRef.current) {
            const textarea = contentTextareaRef.current;
            textarea.style.height = 'auto';
            textarea.style.height = `${textarea.scrollHeight}px`;
            // Scroll to bottom to show new content
            textarea.scrollTop = textarea.scrollHeight;
          }
        }, 0);
      }
    } catch (error) {
      console.error('Fehler bei der Transkription:', error);
      // TRANSCRIPTION_BUSY ist kein Endzustand, sondern eine Warteschlange von
      // einem Platz: Blob behalten, Sekunden aus Retry-After zeigen und den
      // Retry als Toast-Aktion anbieten (Muster wie beim Undo im Papierkorb).
      const seconds = Number.isFinite(error?.retryAfter) ? error.retryAfter : 30;
      if (error?.code === 'TRANSCRIPTION_BUSY' && lastAudioBlobRef.current) {
        const blob = lastAudioBlobRef.current;
        toastBus.publish(t('transcriptionBusyRetry', { seconds }), 'error', Math.max(10000, seconds * 1000), {
          action: { label: t('retryTranscription'), onClick: () => handleTranscribe(blob) }
        });
      } else {
        toastBus.error(resolveApiErrorMessage(error, t, 'errorTranscribing'));
      }
    } finally {
      setIsTranscribing(false);
    }
  };

  // Create stable object URLs for new image file previews and revoke them on cleanup
  const newImagePreviewUrls = useMemo(
    () => newImageFiles.map(file => URL.createObjectURL(file)),
    [newImageFiles]
  );

  useEffect(() => {
    return () => {
      newImagePreviewUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [newImagePreviewUrls]);

  // Keyboard shortcuts for lightbox
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (lightboxImage) {
        if (e.key === 'Escape') {
          closeLightbox();
        } else if (e.key === 'ArrowRight') {
          nextImage();
        } else if (e.key === 'ArrowLeft') {
          prevImage();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxImage, nextImage, prevImage]);

  // Auto-save when clicking outside the modal
  const handleOverlayClick = () => {
    const hasContent = isTodoList
      ? (todoItems.length > 0 && todoItems.some(item => item.text.trim()))
      : content.trim();

    if (hasContent) {
      handleSave();
    } else {
      onClose();
    }
  };

  // Only react to a backdrop click that both started AND ended on the backdrop:
  // selecting text in the editor and releasing over the overlay must not
  // save-and-close (and silently drop a title-only note).
  const backdropClose = useBackdropClose(handleOverlayClick);

  // Keyboard shortcuts for modal
  useModalShortcuts(
    () => {
      if (showDeleteConfirm || showConflictDiscardConfirm) {
        setShowDeleteConfirm(false);
        setShowConflictDiscardConfirm(false);
        return;
      }
      // The lightbox has its own Escape handler; closing it must not also
      // save-and-close the whole editor.
      if (lightboxImage) {
        return;
      }
      handleOverlayClick();
    },
    () => {
      if (!showDeleteConfirm && !showConflictDiscardConfirm) handleSave();
    }
  );

  // Shared modal a11y (focus trap, initial focus, focus restore). Escape is
  // owned by useModalShortcuts above (save-and-close), so it is disabled here.
  const { containerRef, titleId } = useModalA11y({ onClose, closeOnEscape: false });

  return (
    <div className="note-modal-overlay" {...backdropClose}>
      <div
        className="note-modal"
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ backgroundColor: getColorVar(color) }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId} className="sr-only">
          {note ? t('editNote') : t('newNote')}
        </h2>
        <button
          className="note-modal-close"
          onClick={handleOverlayClick}
          aria-label={t('close')}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>

        <div className="note-modal-body">
          {conflict && (
            <div className="note-modal-conflict" role="alert">
              <svg className="note-modal-conflict-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
              </svg>
              <div className="note-modal-conflict-body">
                <strong>{t('conflictMessage')}</strong>
                <div className="note-modal-conflict-actions">
                  <button
                    type="button"
                    className="btn-conflict-load"
                    onClick={() => setShowConflictDiscardConfirm(true)}
                    disabled={!conflict.currentNote || isSaving}
                  >
                    {t('conflictLoadServerVersion')}
                  </button>
                  <button
                    type="button"
                    className="btn-conflict-overwrite"
                    onClick={() => saveNote({ force: true })}
                    disabled={isSaving}
                  >
                    {t('conflictOverwriteMine')}
                  </button>
                </div>
              </div>
            </div>
          )}
          <input
            type="text"
            className="note-modal-title"
            placeholder={t('title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            autoFocus={!isTodoList}
          />

          {note && !canManage && (
            <p className="note-modal-shared-hint">
              {t('sharedNoteOwnerHint', { owner: noteOwnerName(note) || t('unknownUser') })}
            </p>
          )}

          {editorName && (
            <p className="note-modal-edited-hint">
              {t('lastEditedBy', { name: editorName })}
            </p>
          )}

          {isTodoList ? (
            <div className="todo-list-container">
              {todoItems.map((item, index) => (
                <div key={index} className="todo-item">
                  <input
                    type="checkbox"
                    className="todo-item-checkbox"
                    checked={item.completed}
                    onChange={() => handleTodoItemToggle(index)}
                  />
                  <input
                    type="text"
                    className={`todo-item-input ${item.completed ? 'completed' : ''}`}
                    placeholder={t('todoItem')}
                    value={item.text}
                    onChange={(e) => handleTodoItemChange(index, e.target.value)}
                    onKeyDown={(e) => handleTodoItemKeyDown(e, index)}
                    maxLength={500}
                    autoFocus={index === todoItems.length - 1}
                  />
                  <button
                    type="button"
                    className="todo-item-delete"
                    onClick={() => handleTodoItemDelete(index)}
                    aria-label={t('deleteItem')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="todo-add-item"
                onClick={handleAddTodoItem}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                {t('todoItem')}
              </button>
            </div>
          ) : (
            <textarea
              ref={contentTextareaRef}
              className="note-modal-content"
              placeholder={t('enterNote')}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={10000}
            />
          )}

          {!isDemo && !isTodoList && linkPreviews && linkPreviews.length > 0 && (
            <div className="note-modal-link-previews">
              {linkPreviews.map((preview) => (
                <LinkPreview
                  key={preview.url}
                  preview={preview}
                  onRemove={() => {
                    removeLinkPreview(preview.url);
                  }}
                />
              ))}
            </div>
          )}

          {!isDemo && note && images && images.length > 0 && (
            <div className="note-modal-images">
              <div className="uploaded-images">
                {images.map((image, index) => (
                  <div key={index} className="image-preview" onClick={() => openLightbox(index)}>
                    <img
                      src={image.thumbnailUrl || image.url}
                      alt={image.filename}
                      loading="lazy"
                      decoding="async"
                    />
                    <button
                      type="button"
                      className="image-delete-btn"
                      onClick={(e) => { e.stopPropagation(); handleImageDelete(image.filename); }}
                      title={t('deleteImage')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!isDemo && note && newImageFiles.length > 0 && (
            <div className="new-images-preview">
              {newImageFiles.map((file, index) => (
                <div key={index} className="image-preview new">
                  <img
                    src={newImagePreviewUrls[index]}
                    alt={file.name}
                    loading="lazy"
                    decoding="async"
                  />
                  <button
                    type="button"
                    className="image-delete-btn"
                    onClick={() => removeNewImageFile(index)}
                    title={t('removeImage')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                  <span className="new-badge">{t('newBadge')}</span>
                </div>
              ))}
            </div>
          )}

          {/* Hidden file input for image selection */}
          {!isDemo && note && (
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
              style={{ display: 'none' }}
              id="image-upload-input"
            />
          )}

          <div className="note-modal-tags-container">
            {tags.length > 0 && (
              <div className="note-modal-tags-pills">
                {tags.map((tag, index) => (
                  <button
                    key={index}
                    type="button"
                    className="tag-pill"
                    onClick={() => removeTag(index)}
                    title={t('removeTagTitle', { tag })}
                  >
                    <span className="tag-pill-text">{tag}</span>
                    <svg className="tag-pill-remove" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                ))}
              </div>
            )}
            <input
              type="text"
              className="note-modal-tags-input"
              placeholder={tags.length > 0 ? t('addMoreTags') : t('tagsPlaceholder')}
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={handleTagInputKeyDown}
              onBlur={addTagFromInput}
              maxLength={50}
            />
          </div>
        </div>

        <div className="note-modal-footer">
          <div className="note-modal-toolbar">
            <ColorPicker
              selectedColor={color}
              onColorSelect={setColor}
            />
            <button
              type="button"
              className={`btn-modal-checkbox ${isTodoList ? 'active' : ''}`}
              onClick={handleToggleTodoMode}
              title={isTodoList ? t('switchToNote') : t('switchToList')}
              aria-label={isTodoList ? t('switchToNote') : t('switchToList')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <path d="M9 11l3 3 6-6"/>
              </svg>
            </button>
            {note && canManage && onToggleArchive && (
              <button
                type="button"
                className={`btn-modal-archive ${note.isArchived ? 'archived' : ''}`}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (isSaving) return;
                  setIsSaving(true);
                  try {
                    const updated = await onToggleArchive(note._id);
                    if (updated) onClose();
                  } finally {
                    setIsSaving(false);
                  }
                }}
                disabled={isSaving}
                title={note.isArchived ? t('unarchive') : t('archive')}
                aria-label={note.isArchived ? t('unarchive') : t('archive')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4"/>
                </svg>
              </button>
            )}
            {note && canManage && onOpenCollaborate && (
              <button
                type="button"
                className="btn-modal-collaborate"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenCollaborate(note);
                  onClose();
                }}
                title={t('share')}
                aria-label={t('share')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
              </button>
            )}
            <button
              type="button"
              className={`btn-modal-pin ${isPinned ? 'pinned' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                setIsPinned(!isPinned);
              }}
              title={isPinned ? t('unpin') : t('pin')}
              aria-label={isPinned ? t('unpin') : t('pin')}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 17v5m-5-9H5a2 2 0 0 1 0-4h14a2 2 0 0 1 0 4h-2m-5-9V2"/>
              </svg>
            </button>
            {!isDemo && note && (
              <>
                <label
                  htmlFor="image-upload-input"
                  className="btn-modal-image-select"
                  title={t('selectImages')}
                  style={{ cursor: 'pointer' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                </label>
                {newImageFiles.length > 0 && (
                  <button
                    type="button"
                    className={`btn-modal-image-upload ${uploadingImages ? 'uploading' : ''}`}
                    onClick={handleImageUpload}
                    disabled={uploadingImages}
                    title={uploadingImages ? t('uploadingImages') : t('uploadImagesCount', { count: newImageFiles.length })}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    {newImageFiles.length > 0 && (
                      <span className="image-count-badge">{newImageFiles.length}</span>
                    )}
                  </button>
                )}
              </>
            )}
            {!isDemo && note && settings.aiFeatures.voiceTranscription && !isTodoList && (
              <button
                type="button"
                className={`btn-modal-voice ${isRecording ? 'recording' : ''} ${isTranscribing ? 'transcribing' : ''}`}
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isTranscribing}
                title={isRecording ? t('stopRecording') : isTranscribing ? t('transcribing') : t('startRecording')}
                aria-label={isRecording ? t('stopRecording') : t('startRecording')}
              >
                {isTranscribing ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 6v6l4 2"/>
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                  </svg>
                )}
              </button>
            )}
            {note && canManage && onDelete && (
              <button
                type="button"
                className="btn-modal-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowDeleteConfirm(true);
                }}
                disabled={isSaving}
                title={t('delete')}
                aria-label={t('delete')}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z"/>
                </svg>
              </button>
            )}
          </div>
          <div className="note-modal-actions">
            <button
              className="btn-modal-cancel"
              onClick={onClose}
              disabled={isSaving}
            >
              {t('cancel')}
            </button>
            <button
              className="btn-modal-save"
              onClick={handleSave}
              disabled={isSaving || (isTodoList ? (todoItems.length === 0 || todoItems.every(item => !item.text.trim())) : !content.trim())}
            >
              {t('save')}
            </button>
          </div>
        </div>
      </div>

      {/* Lightbox for viewing images */}
      {lightboxImage && (
        <div className="lightbox-overlay" onClick={(e) => { e.stopPropagation(); closeLightbox(); }}>
          <button className="lightbox-close" onClick={(e) => { e.stopPropagation(); closeLightbox(); }} aria-label={t('close')}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>

          {images.length > 1 && (
            <>
              <button className="lightbox-prev" onClick={(e) => { e.stopPropagation(); prevImage(); }} aria-label={t('previousImage')}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
              <button className="lightbox-next" onClick={(e) => { e.stopPropagation(); nextImage(); }} aria-label={t('nextImage')}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="9 18 15 12 9 6"/>
                </svg>
              </button>
            </>
          )}

          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <img src={lightboxImage.url} alt={t('imageAlt', { index: lightboxImage.index + 1 })} />
            {images.length > 1 && (
              <div className="lightbox-counter">
                {lightboxImage.index + 1} / {images.length}
              </div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={showDeleteConfirm}
        title={t('confirmDeleteNoteTitle')}
        message={t('confirmDeleteMessage')}
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={async () => {
          if (isSaving) return;
          setIsSaving(true);
          try {
            const deleted = await onDelete(note._id);
            if (deleted) onClose();
          } finally {
            setIsSaving(false);
            setShowDeleteConfirm(false);
          }
        }}
      />

      <ConfirmDialog
        isOpen={showConflictDiscardConfirm}
        title={t('conflictDiscardTitle')}
        message={t('conflictDiscardMessage')}
        confirmLabel={t('conflictDiscardConfirm')}
        onCancel={() => setShowConflictDiscardConfirm(false)}
        onConfirm={() => {
          setShowConflictDiscardConfirm(false);
          handleLoadServerVersion();
        }}
      />
    </div>
  );
}

export default NoteModal;
