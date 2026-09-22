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
import NoteHistory from './NoteHistory';
import { resolveApiErrorMessage } from '../utils/apiErrors.mjs';

// v1.12.0: Anhang-Groesse kompakt anzeigen (1024er-Einheiten, eine Nachkommastelle).
function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
import {
  readDraft,
  writeDraft,
  clearDraft,
  isDraftWorthRestoring,
  draftHasSubstance
} from '../utils/noteDraft.mjs';

/** Entwürfe werden entprellt geschrieben, aber beim Verstecken des Tabs sofort. */
const DRAFT_DEBOUNCE_MS = 400;

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

function NoteModal({ note, serverNote, onSave, onClose, onToggleArchive, onOpenCollaborate, onDelete, availableTags = [], wikiNotes = [], backlinks = [], onOpenNote, folders = [], defaultParentId = null, onRestored }) {
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
  // v1.10.0: Code-/Monospace-Notiz und Eltern-Ordner
  const [isCode, setIsCode] = useState(note?.isCode || false);
  const [parentId, setParentId] = useState(
    typeof note?.parentId === 'string' ? note.parentId : (defaultParentId || null)
  );
  const [images, setImages] = useState(note?.images || []);
  // v1.12.0: PDF-Anhänge — eigene Liste, eigener Upload-Pfad (/files).
  const [noteFiles, setNoteFiles] = useState(note?.files || []);
  const [newImageFiles, setNewImageFiles] = useState([]);
  const [uploadingImages, setUploadingImages] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [newPdfFiles, setNewPdfFiles] = useState([]);
  const [lightboxImage, setLightboxImage] = useState(null); // {index, url}
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  // Optimistic locking: server version that beat our edit (null = no conflict).
  const [conflict, setConflict] = useState(null);
  const [showConflictDiscardConfirm, setShowConflictDiscardConfirm] = useState(false);
  // Gefundener Entwurf (null = nichts anzubieten). Solange die Entscheidung
  // aussteht, wird kein neuer Entwurf geschrieben — sonst überschreibt der
  // Server-Stand den geretteten Inhalt.
  const [draftOffer, setDraftOffer] = useState(null);
  const draftTimerRef = useRef(null);
  const draftFirstRunRef = useRef(true);
  const draftUserId = user?._id || user?.id || null;
  // note.updatedAt at the time the modal was opened (or the server version was
  // loaded) — sent as baseUpdatedAt on every non-forced PUT.
  const baseUpdatedAtRef = useRef(note?.updatedAt || null);
  const contentTextareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const pdfInputRef = useRef(null);
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

  // v1.14.0 Nr. 7: Restore aus der Revisions-Historie. Der Server läuft über
  // updateNote und liefert die frische Note — lokalen State UND baseUpdatedAt
  // übernehmen, sonst 409-t der nächste manuelle Save gegen den alten Stand.
  const handleRevisionRestored = useCallback((updatedNote) => {
    if (!updatedNote || typeof updatedNote !== 'object') return;
    setTitle(updatedNote.title || '');
    setContent(updatedNote.content || '');
    setTags(Array.isArray(updatedNote.tags) ? updatedNote.tags : []);
    setIsTodoList(Boolean(updatedNote.isTodoList));
    if (Array.isArray(updatedNote.todoItems)) setTodoItems(updatedNote.todoItems);
    setIsPinned(Boolean(updatedNote.isPinned));
    setConflict(null);
    baseUpdatedAtRef.current = updatedNote.updatedAt || null;
    onRestored?.();
  }, [setTodoItems, onRestored]);

  // Beim Öffnen: gibt es einen neueren, ungespeicherten Entwurf?
  useEffect(() => {
    const draft = readDraft(note?._id || null, draftUserId);
    if (isDraftWorthRestoring(draft, note)) {
      setDraftOffer(draft);
    }
    // Absichtlich nur beim Mount: Der Editor wird pro Öffnen neu gemountet, und
    // ein späteres note-Update (Konflikt-Banner) darf nichts erneut anbieten.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistDraft = useCallback((immediate = false) => {
    if (draftOffer) return;
    const draft = {
      title,
      content,
      tags,
      todoItems: isTodoList ? todoItems : [],
      isTodoList,
      color,
      noteUpdatedAt: note?.updatedAt || null
    };
    // Substanzlose Entwürfe nie schreiben (leerer Editor nach dem Verwerfen,
    // nur angefasste Farbe): draftDiffers hält sie gegen eine neue Notiz für
    // „abweichend", sodass sie beim nächsten Öffnen als Banner zurückkämen —
    // auch dann, wenn dieser Aufruf nur durch die Identitätsänderung von
    // persistDraft nach dem Verwerfen getriggert wurde.
    if (!draftHasSubstance(draft)) {
      clearTimeout(draftTimerRef.current);
      return;
    }
    if (immediate) {
      writeDraft(note?._id || null, draftUserId, draft);
      return;
    }
    clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(
      () => writeDraft(note?._id || null, draftUserId, draft),
      DRAFT_DEBOUNCE_MS
    );
  }, [title, content, tags, todoItems, isTodoList, color, note?._id, note?.updatedAt, draftUserId, draftOffer]);

  // Nach jeder Änderung (entprellt). Der erste Lauf schreibt nichts: Ein
  // unveränderter Editor soll keinen Entwurf anlegen.
  useEffect(() => {
    if (draftFirstRunRef.current) {
      draftFirstRunRef.current = false;
      return undefined;
    }
    persistDraft();
    return () => clearTimeout(draftTimerRef.current);
  }, [persistDraft]);

  // Reload, Tab-Close und der ErrorBoundary-Reset (`window.location.reload()`)
  // kündigen sich nicht an — beim Verstecken des Tabs sofort flushen.
  useEffect(() => {
    const flush = () => persistDraft(true);
    const onVisibility = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') flush();
    };
    if (typeof window !== 'undefined') window.addEventListener('pagehide', flush);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(draftTimerRef.current);
      if (typeof window !== 'undefined') window.removeEventListener('pagehide', flush);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [persistDraft]);

  const restoreDraft = useCallback(() => {
    if (!draftOffer) return;
    if (draftOffer.title !== undefined) setTitle(draftOffer.title);
    if (draftOffer.content !== undefined) setContent(draftOffer.content);
    if (Array.isArray(draftOffer.tags)) setTags(draftOffer.tags);
    if (draftOffer.color !== undefined) setColor(draftOffer.color);
    if (draftOffer.isTodoList !== undefined) setIsTodoList(Boolean(draftOffer.isTodoList));
    if (Array.isArray(draftOffer.todoItems)) setTodoItems(draftOffer.todoItems);
    // baseUpdatedAtRef bleibt auf dem Server-Stand: Die 409-Mechanik muss auch
    // nach dem Wiederherstellen greifen, sonst überschreibt der Entwurf still
    // die Änderung eines anderen Geräts.
    setDraftOffer(null);
  }, [draftOffer, setTodoItems]);

  const discardDraft = useCallback(() => {
    // Ein noch laufender Debounce-Write würde den soeben verworfenen Entwurf
    // bis zu 400 ms nach dem Verwerfen zurückschreiben.
    clearTimeout(draftTimerRef.current);
    clearDraft(note?._id || null, draftUserId);
    setDraftOffer(null);
  }, [note?._id, draftUserId]);


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
    setIsCode(Boolean(source.isCode));
    setParentId(typeof source.parentId === 'string' ? source.parentId : null);
    setTodoItems(source.todoItems || []);
    setLinkPreviews(source.linkPreviews || []);
    setImages(source.images || []);
    setNoteFiles(source.files || []);
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
      isCode: isCode,
      todoItems: isTodoList ? getCleanedItems() : [],
      linkPreviews: isDemo ? [] : (linkPreviews || []),
    };
    // v1.10.0: Ordner — Verschieben bleibt beim Besitzer (wie Archiv/Löschen);
    // bei neuen Notizen setzt der Editor den aktuell gewählten Ordner-Scope.
    if (canManage) {
      noteData.parentId = parentId || null;
    }

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
        // Gespeichert — der Entwurf ist sonst beim nächsten Öffnen „neuer" als
        // die Notiz und wird fälschlich angeboten.
        clearDraft(note?._id || null, draftUserId);
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
  // v1.10.0: Enter/Komma übernehmen den markierten Vorschlag, falls einer
  // aktiv ist; Pfeiltasten wandern durch die Liste, Escape schließt sie (und
  // wird deshalb nicht an den Modal-Shortcut weitergereicht).
  const handleTagInputKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (tagSuggestionIndex >= 0 && tagSuggestions[tagSuggestionIndex]) {
        applyTagSuggestion(tagSuggestions[tagSuggestionIndex]);
      } else {
        addTagFromInput();
      }
    } else if (e.key === 'ArrowDown' && tagSuggestions.length > 0) {
      e.preventDefault();
      setTagSuggestionIndex((index) => (index + 1) % tagSuggestions.length);
    } else if (e.key === 'ArrowUp' && tagSuggestions.length > 0) {
      e.preventDefault();
      setTagSuggestionIndex((index) => (index - 1 + tagSuggestions.length) % tagSuggestions.length);
    } else if (e.key === 'Escape' && tagSuggestions.length > 0) {
      e.stopPropagation();
      setTagInput('');
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

  // v1.10.0 ---------------------------------------------------------------
  // Tag-Vervollständigung: Vorschläge aus allen bekannten Tags (geladenes
  // Fenster + Baum-Projektion), Prefix-Treffer zuerst, eigene Tags ausgespart.
  const [tagSuggestionIndex, setTagSuggestionIndex] = useState(-1);

  const tagSuggestions = useMemo(() => {
    const query = tagInput.trim().toLowerCase();
    if (!query) return [];
    const own = new Set(tags);
    const startsWith = [];
    const contains = [];
    for (const candidate of availableTags) {
      if (own.has(candidate)) continue;
      const lower = candidate.toLowerCase();
      if (lower.startsWith(query)) startsWith.push(candidate);
      else if (lower.includes(query)) contains.push(candidate);
    }
    return [...startsWith, ...contains].slice(0, 6);
  }, [tagInput, tags, availableTags]);

  useEffect(() => {
    setTagSuggestionIndex(-1);
  }, [tagInput]);

  const applyTagSuggestion = (tag) => {
    if (tag && !tags.includes(tag)) setTags([...tags, tag].slice(0, 50));
    setTagInput('');
  };

  // Wiki-Links `[[Titel]]`: Autovervollständigung über dem Caret während des
  // Tippens plus Chips der vollständigen Links unter dem Inhalt — Navigation
  // wie in Trilium, ohne dass der Server davon weiß (reine Client-Sache).
  const contentCaretRef = useRef(0);

  const wikiByTitle = useMemo(() => {
    const map = new Map();
    for (const entry of wikiNotes) {
      if (!map.has(entry.title)) map.set(entry.title, entry);
    }
    return map;
  }, [wikiNotes]);

  const wikiSuggestion = useMemo(() => {
    const fragment = content.slice(0, contentCaretRef.current);
    const match = /\[\[([^\][\n]{0,100})$/.exec(fragment);
    if (!match) return null;
    const query = match[1].toLowerCase();
    const candidates = wikiNotes
      .filter(entry => !query || entry.title.toLowerCase().includes(query))
      .slice(0, 6);
    return candidates.length > 0 ? { partialStart: fragment.length - match[0].length, candidates } : null;
  }, [content, wikiNotes]);

  const insertWikiLink = (noteTitle) => {
    const caret = contentCaretRef.current;
    const suggestion = wikiSuggestion;
    const start = suggestion ? suggestion.partialStart : caret;
    const next = `${content.slice(0, start)}[[${noteTitle}]]${content.slice(caret)}`;
    setContent(next);
    const pos = start + noteTitle.length + 4;
    requestAnimationFrame(() => {
      const textarea = contentTextareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(pos, pos);
      contentCaretRef.current = pos;
    });
  };

  const linkedNotes = useMemo(() => {
    if (isTodoList) return [];
    const seen = new Set();
    const result = [];
    for (const match of content.matchAll(/\[\[([^\][\n]{1,200})\]\]/g)) {
      const target = wikiByTitle.get(match[1]);
      if (target && !seen.has(target.id)) {
        seen.add(target.id);
        result.push(target);
      }
    }
    return result;
  }, [content, isTodoList, wikiByTitle]);
  // Ende v1.10.0 -----------------------------------------------------------

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

  // v1.12.0: PDF-Anhänge — Auswahl/Upload/Löschen gespiegelt zu Bildern.
  const handlePdfSelect = (e) => {
    const remainingSlots = Math.max(0, Math.min(5, 25 - noteFiles.length - newPdfFiles.length));
    const files = Array.from(e.target.files || [])
      .filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'))
      .slice(0, remainingSlots);
    if (files.length > 0) {
      setNewPdfFiles([...newPdfFiles, ...files]);
    }
  };

  const handlePdfUpload = async () => {
    if (!note || newPdfFiles.length === 0) return;

    setUploadingFiles(true);
    try {
      const updatedNote = await notesAPI.uploadFiles(note._id, newPdfFiles);
      setNoteFiles(updatedNote.files || []);
      if (updatedNote.updatedAt) {
        baseUpdatedAtRef.current = updatedNote.updatedAt;
      }
      setNewPdfFiles([]);
      if (pdfInputRef.current) {
        pdfInputRef.current.value = '';
      }
    } catch (error) {
      console.error('Fehler beim Hochladen der Anhänge:', error);
      toastBus.error(resolveApiErrorMessage(error, t, 'errorUploadingFiles'));
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleFileDelete = async (filename) => {
    if (!note) return;

    try {
      const updatedNote = await notesAPI.deleteFile(note._id, filename);
      setNoteFiles(updatedNote.files || []);
      if (updatedNote.updatedAt) {
        baseUpdatedAtRef.current = updatedNote.updatedAt;
      }
    } catch (error) {
      console.error('Fehler beim Löschen des Anhangs:', error);
      toastBus.error(resolveApiErrorMessage(error, t, 'errorDeletingFile'));
    }
  };

  const removeNewPdfFile = (index) => {
    setNewPdfFiles(newPdfFiles.filter((_, i) => i !== index));
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

  // Keyboard navigation for the lightbox (arrows only). Escape runs through
  // the lightbox's own useModalA11y registration below, so the dialog stack
  // decides which layer the key belongs to — closing the lightbox must not
  // also save-and-close the editor underneath.
  useEffect(() => {
    if (!lightboxImage) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight') {
        nextImage();
      } else if (e.key === 'ArrowLeft') {
        prevImage();
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

  // Nr. 28 (Top-30): die Lightbox ist ein eigener Dialog ÜBER dem Editor —
  // eigener Anfangsfokus (Schließen-Button), eigener Tab-Rahmen, und Escape
  // schließt nur sie. Der Dialog-Stack in useModalA11y hält den Editor
  // darunter bei Escape und Tab still.
  const lightboxCloseRef = useRef(null);
  const { containerRef: lightboxContainerRef } = useModalA11y({
    onClose: closeLightbox,
    active: Boolean(lightboxImage),
    initialFocusRef: lightboxCloseRef,
  });

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
          {draftOffer && !conflict && (
            <div className="note-modal-conflict note-modal-draft" role="alert">
              <div className="note-modal-conflict-body">
                <strong>{t('draftFoundTitle')}</strong>
                <span>{t('draftFoundMessage')}</span>
                <div className="note-modal-conflict-actions">
                  <button
                    type="button"
                    className="btn-conflict-load btn-draft-restore"
                    onClick={restoreDraft}
                    disabled={isSaving}
                  >
                    {t('draftRestore')}
                  </button>
                  <button
                    type="button"
                    className="btn-conflict-keep btn-draft-discard"
                    onClick={discardDraft}
                    disabled={isSaving}
                  >
                    {t('draftDiscard')}
                  </button>
                </div>
              </div>
            </div>
          )}
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
              className={`note-modal-content ${isCode ? 'code' : ''}`}
              placeholder={t('enterNote')}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                contentCaretRef.current = e.target.selectionStart ?? 0;
              }}
              onSelect={(e) => {
                contentCaretRef.current = e.target.selectionStart ?? 0;
              }}
              maxLength={10000}
            />
          )}

          {/* v1.10.0: Wiki-Link-Vervollständigung — erscheint, sobald über dem
              Caret ein angefangenes `[[` steht; Klick ersetzt das Fragment. */}
          {!isTodoList && wikiSuggestion && (
            <div className="note-modal-wiki-suggestions" role="listbox" aria-label={t('wikiSuggestionHint')}>
              {wikiSuggestion.candidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  role="option"
                  aria-selected="false"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertWikiLink(candidate.title);
                  }}
                >
                  [[{candidate.title}]]
                </button>
              ))}
            </div>
          )}

          {/* v1.14.0 Nr. 7: Revisions-Historie — der Server speichert seit
              v1.13.0 Fassungen, aber keine UI zeigte sie. Demo-Konten sind
              serverseitig vom Restore ausgesperrt (rejectDemoNoteCapabilities)
              — die Historie bleibt ihnen erspart. */}
          {!isDemo && note && (
            <NoteHistory noteId={note._id} onRestored={handleRevisionRestored} />
          )}

          {/* v1.10.0: Verlinkte Notizen (aus `[[Titel]]` im Inhalt) und
              Backlinks („Erwähnt in") — Klick springt direkt hinein. */}
          {!isTodoList && (linkedNotes.length > 0 || backlinks.length > 0) && (
            <div className="note-modal-links">
              {linkedNotes.length > 0 && (
                <div className="note-modal-links-group">
                  <span className="note-modal-links-title">{t('linkedNotes')}</span>
                  <div className="note-modal-links-chips">
                    {linkedNotes.map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        className="note-modal-wiki-chip"
                        onClick={() => onOpenNote?.(target.id)}
                        title={t('openNote')}
                      >
                        🔗 {target.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {backlinks.length > 0 && (
                <div className="note-modal-links-group">
                  <span className="note-modal-links-title">{t('mentionedIn')}</span>
                  <div className="note-modal-links-chips">
                    {backlinks.map((source) => (
                      <button
                        key={source.id}
                        type="button"
                        className="note-modal-wiki-chip"
                        onClick={() => onOpenNote?.(source.id)}
                        title={t('openNote')}
                      >
                        ↩︎ {source.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
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
                  // Nr. 28 (Top-30): die Kachel öffnet die Lightbox jetzt über
                  // einen echten Button — das alte div mit onClick war per
                  // Tastatur nicht erreichbar. Der Lösch-Button bleibt daneben
                  // statt darin (Button-in-Button wäre invalides HTML), deshalb
                  // fällt sein stopPropagation weg.
                  <div key={index} className="image-preview">
                    <button
                      type="button"
                      className="image-open-btn"
                      onClick={() => openLightbox(index)}
                      aria-label={t('imageAlt', { index: index + 1 })}
                    >
                      <img
                        src={image.thumbnailUrl || image.url}
                        alt={t('imageAlt', { index: index + 1 })}
                        loading="lazy"
                        decoding="async"
                      />
                    </button>
                    <button
                      type="button"
                      className="image-delete-btn"
                      onClick={() => handleImageDelete(image.filename)}
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

          {!isDemo && note && noteFiles.length > 0 && (
            <div className="note-modal-files">
              {noteFiles.map((file) => (
                <div key={file.filename} className="file-attachment">
                  <a
                    href={file.url}
                    download={file.originalName || 'anhang.pdf'}
                    className="file-attachment-link"
                    title={t('downloadFile')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span className="file-attachment-name">{file.originalName || file.filename}</span>
                    <span className="file-attachment-size">{formatFileSize(file.size)}</span>
                  </a>
                  <button
                    type="button"
                    className="image-delete-btn"
                    onClick={() => handleFileDelete(file.filename)}
                    title={t('deleteFile')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {!isDemo && note && newPdfFiles.length > 0 && (
            <div className="note-modal-files">
              {newPdfFiles.map((file, index) => (
                <div key={index} className="file-attachment new">
                  <span className="file-attachment-link">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <span className="file-attachment-name">{file.name}</span>
                    <span className="file-attachment-size">{formatFileSize(file.size)}</span>
                    <span className="new-badge">{t('newBadge')}</span>
                  </span>
                  <button
                    type="button"
                    className="image-delete-btn"
                    onClick={() => removeNewPdfFile(index)}
                    title={t('removeFile')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              ))}
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

          {/* Hidden file input for PDF attachments */}
          {!isDemo && note && (
            <input
              ref={pdfInputRef}
              type="file"
              accept="application/pdf,.pdf"
              multiple
              onChange={handlePdfSelect}
              style={{ display: 'none' }}
              id="pdf-upload-input"
            />
          )}

          <div className="note-modal-tags-container">
            {/* v1.10.0: Eltern-Ordner — entspricht dem Move-Picker der App und
                setzt bei neuen Notizen den aktiven Ordner-Scope vor. */}
            {canManage && (
              <div className="note-modal-folder-row">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                <select
                  className="note-modal-folder-select"
                  value={parentId || ''}
                  onChange={(e) => setParentId(e.target.value || null)}
                  aria-label={t('folderLabel')}
                >
                  <option value="">{t('topLevel')}</option>
                  {folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {' '.repeat(folder.depth * 2)}{folder.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
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
            <div className="note-modal-tags-input-wrap">
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
              {/* v1.10.0: Vervollständigung — onMouseDown (vor dem Blur), damit
                  der Klick nicht erst das halbe Wort als Tag übernimmt. */}
              {tagSuggestions.length > 0 && (
                <div className="note-modal-tag-suggestions" role="listbox" aria-label={t('addMoreTags')}>
                  {tagSuggestions.map((candidate, index) => (
                    <button
                      key={candidate}
                      type="button"
                      role="option"
                      aria-selected={index === tagSuggestionIndex}
                      className={index === tagSuggestionIndex ? 'active' : ''}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        applyTagSuggestion(candidate);
                      }}
                    >
                      {candidate}
                    </button>
                  ))}
                </div>
              )}
            </div>
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
            {/* v1.10.0: Code-/Monospace-Notiz — Inhalt in JetBrains Mono */}
            {!isTodoList && (
              <button
                type="button"
                className={`btn-modal-code ${isCode ? 'active' : ''}`}
                onClick={(e) => {
                  e.stopPropagation();
                  setIsCode(!isCode);
                }}
                title={t('codeMode')}
                aria-label={t('codeMode')}
                aria-pressed={isCode}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="16 18 22 12 16 6"/>
                  <polyline points="8 6 2 12 8 18"/>
                </svg>
              </button>
            )}
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
                <label
                  htmlFor="pdf-upload-input"
                  className="btn-modal-image-select"
                  title={t('selectFiles')}
                  style={{ cursor: 'pointer' }}
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                  </svg>
                </label>
                {newPdfFiles.length > 0 && (
                  <button
                    type="button"
                    className={`btn-modal-image-upload ${uploadingFiles ? 'uploading' : ''}`}
                    onClick={handlePdfUpload}
                    disabled={uploadingFiles}
                    title={uploadingFiles ? t('uploadingFiles') : t('uploadFilesCount', { count: newPdfFiles.length })}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="17 8 12 3 7 8"/>
                      <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    <span className="image-count-badge">{newPdfFiles.length}</span>
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

      {/* Lightbox for viewing images — Nr. 28 (Top-30): echter Dialog mit
          Fokus auf dem Schließen-Button, statt nur ein div mit onClick. */}
      {lightboxImage && (
        <div
          className="lightbox-overlay"
          ref={lightboxContainerRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('imageAlt', { index: lightboxImage.index + 1 })}
          onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
        >
          <button
            ref={lightboxCloseRef}
            className="lightbox-close"
            onClick={(e) => { e.stopPropagation(); closeLightbox(); }}
            aria-label={t('close')}
          >
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
