import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { normalizeNote, normalizeNotesPayload } from '../utils/notesPayload.mjs';
import { resolveApiErrorMessage } from '../utils/apiErrors.mjs';

/**
 * useNotesManager (Core-Refactoring P13/P15/P17)
 *
 * Zentraler Hook für den Notiz-Zustand der App:
 * - CRUD/Pin/Archive/Drag&Drop inkl. fetchNotes
 * - lokale Mutationen statt Full-Refetch (P15, Pattern aus togglePinNote)
 * - `loading` nur für den initialen Ladevorgang (Skeletons),
 *   `refreshing` für Hintergrund-Refetch ohne Spinner (stale-while-revalidate)
 * - Live-Refresh geteilter Notizen über Focus/Visibility (15s-Throttle)
 *   und 60s-Interval-Poll, nur wenn der Tab sichtbar ist (P17)
 *
 * Reine, testbare Logik ist als eigenständige Exporte hinterlegt:
 * applyMutationLocally, mergeIfChanged, createThrottledAction.
 */

export const NOTES_PAGE_LIMIT = 50;
export const FOCUS_REFRESH_THROTTLE_MS = 15_000;
export const POLL_INTERVAL_MS = 60_000;

// Nr. 26: Ein Hintergrund-Refresh dimmt die Liste erst, wenn er spürbar dauert.
// Der Idle-Poll auf einem schnellen Self-Host antwortet in wenigen Millisekunden
// und ließ die Liste trotzdem zweimal pro Minute auf 60 % pulsieren — der Timer
// hält schnelle Antworten komplett unterhalb der Schwelle.
export const REFRESH_DIM_DELAY_MS = 250;

/**
 * Die Dimm-Regel als reine Funktion (Nr. 26): gedimmt wird nur ein Refresh,
 * der (a) länger als `delayMs` läuft und (b) tatsächlich etwas geändert hat —
 * ein Langläufer ohne Ergebnis hat die Liste auch nicht verdunkelt, sobald die
 * Antwort da ist. Bewusst simpel und exportiert, damit die Semantik in
 * tests/notesManagerLogic.test.js ausführbar bleibt.
 */
export function shouldDimRefresh(elapsedMs, changed, delayMs = REFRESH_DIM_DELAY_MS) {
  return Boolean(changed) && elapsedMs >= delayMs;
}

const DEFAULT_PAGINATION = { page: 1, limit: NOTES_PAGE_LIMIT, total: 0, pages: 0 };
const DEFAULT_COUNTS = { active: 0, archived: 0, trash: 0 };

// ---------------------------------------------------------------------------
// Reine Logik (exportiert für node --test, siehe tests/notesManagerLogic.test.js)
// ---------------------------------------------------------------------------

/**
 * Wendet eine Notiz-Mutation lokal auf eine Notizliste an (optimistisches Update
 * ohne Full-Refetch, P15). Das zurückgegebene Array ist nur bei Änderung neu.
 *
 * @param {Array} notes - aktuelle Notizliste
 * @param {Object} action - { type: 'create'|'update'|'delete'|'reorder', ... }
 * @returns {Array} die (ggf. unveränderte) Notizliste
 */
export function applyMutationLocally(notes, action) {
  if (!Array.isArray(notes) || !action || typeof action !== 'object') {
    return Array.isArray(notes) ? notes : [];
  }

  switch (action.type) {
    case 'create': {
      const note = action.note;
      if (!note || !note._id) return notes;
      if (notes.some(existing => existing._id === note._id)) {
        return notes.map(existing => (existing._id === note._id ? note : existing));
      }
      // Neu erstellte Notiz gehört nicht in die aktuelle Ansicht (z.B. Archiv-Ansicht)
      if (action.visible === false) return notes;
      return [note, ...notes];
    }

    case 'update': {
      const note = action.note;
      if (!note || !note._id) return notes;
      let found = false;
      const next = notes.map(existing => {
        if (existing._id !== note._id) return existing;
        found = true;
        return note;
      });
      return found ? next : notes;
    }

    case 'delete':
      if (!action.id) return notes;
      return notes.filter(existing => existing._id !== action.id);

    case 'reorder': {
      const { sourceId, targetId } = action;
      if (!sourceId || !targetId || sourceId === targetId) return notes;
      const sourceIndex = notes.findIndex(note => note._id === sourceId);
      const targetIndex = notes.findIndex(note => note._id === targetId);
      if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return notes;
      const next = [...notes];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    }

    default:
      return notes;
  }
}

function notesListsEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right || left._id !== right._id) return false;
    const leftStamp = String(left.updatedAt ?? left.createdAt ?? '');
    const rightStamp = String(right.updatedAt ?? right.createdAt ?? '');
    if (leftStamp !== rightStamp) return false;
    if (Boolean(left.isPinned) !== Boolean(right.isPinned)) return false;
    if (Boolean(left.isArchived) !== Boolean(right.isArchived)) return false;
  }
  return true;
}

function plainObjectsEqual(a, b, keys) {
  return keys.every(key => a?.[key] === b?.[key]);
}

// Tags tragen kein _id, sondern name/count
function tagsEqual(a, b) {
  if (a === b) return true;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((tag, index) => tag?.name === b[index]?.name && tag?.count === b[index]?.count);
}

/**
 * Stale-while-revalidate-Merge (P15/P17): liefert das bisherige Objekt
 * (identische Referenz) zurück, wenn sich nichts Relevantes geändert hat,
 * sonst das neue. Nur bei referentieller Änderung wird setState aktiv.
 *
 * @param {Object} current - { notes, pagination, counts, tags }
 * @param {Object} incoming - { notes, pagination, counts, tags }
 * @returns {Object} current oder incoming
 */
export function mergeIfChanged(current, incoming) {
  const safeCurrent = current || {};
  const safeIncoming = incoming || {};

  if (
    notesListsEqual(safeCurrent.notes, safeIncoming.notes)
    && plainObjectsEqual(safeCurrent.pagination, safeIncoming.pagination, ['page', 'limit', 'total', 'pages'])
    // `trash` gehört dazu: Ändert sich nur der Papierkorb (anderes Gerät löscht,
    // TTL räumt auf), verwarf der Vergleich die komplette Antwort und das
    // Sidebar-Badge blieb falsch.
    && plainObjectsEqual(safeCurrent.counts, safeIncoming.counts, ['active', 'archived', 'trash'])
    && tagsEqual(safeCurrent.tags, safeIncoming.tags)
  ) {
    return safeCurrent;
  }
  return safeIncoming;
}

/**
 * Throttle-Logik als injizierbare Uhr (P17: Focus-Refetch alle 15s höchstens).
 *
 * @param {Function} action - auszuführende Funktion
 * @param {Object} options - { windowMs, now }
 * @returns {Function} gedrosselte Funktion; true = ausgeführt, false = gedrosselt
 */
export function createThrottledAction(action, { windowMs = FOCUS_REFRESH_THROTTLE_MS, now = () => Date.now() } = {}) {
  let lastRunAt = -Infinity;
  return (...args) => {
    const timestamp = now();
    if (timestamp - lastRunAt < windowMs) return false;
    lastRunAt = timestamp;
    action(...args);
    return true;
  };
}

/**
 * Grund für einen leeren Notiz-Screen (pure, für Tests exportiert).
 * Reihenfolge wie im ursprünglichen App.jsx: Ohne-Notizen > Tag-filter > Suche.
 *
 * @returns {'noNotes'|'noTagResults'|'noSearchResults'|null}
 */
export function getEmptyStateReason({ hasNotes, selectedTag, searchTerm } = {}) {
  if (hasNotes) return null;
  if (selectedTag) return 'noTagResults';
  if (searchTerm) return 'noSearchResults';
  return 'noNotes';
}

/**
 * Entfernt eine beendete Operation aus dem operationLoading-Objekt (Nr. 26).
 * Rein: identische Referenz, wenn der Schlüssel nicht existiert — ein no-op
 * setState, das die memoisierten Karten nicht invalidiert. Vorher wurden
 * Einträge auf false gesetzt und blieben für den Rest der Session liegen.
 */
export function withoutOperation(loading, key) {
  if (!Object.prototype.hasOwnProperty.call(loading, key)) return loading;
  const next = { ...loading };
  delete next[key];
  return next;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * @param {Object} params
 * @param {Object} params.api - notesAPI (injiziert, damit der Hook in node --test importierbar bleibt)
 * @param {boolean} params.isLoggedIn
 * @param {boolean} params.authLoading
 * @param {Function} params.showToast
 * @param {Function} params.t
 * @param {boolean} params.showArchived
 * @param {boolean} params.showTrash
 * @param {string|null} params.selectedTag
 * @param {string} params.searchTerm
 */
export function useNotesManager({
  api,
  isLoggedIn = false,
  authLoading = true,
  showToast,
  t,
  showArchived = false,
  showTrash = false,
  selectedTag = null,
  searchTerm = '',
}) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pagination, setPagination] = useState(DEFAULT_PAGINATION);
  const [noteCounts, setNoteCounts] = useState(DEFAULT_COUNTS);
  const [allTags, setAllTags] = useState([]);
  const [operationLoading, setOperationLoading] = useState({});
  const [draggedNoteId, setDraggedNoteId] = useState(null);


  const fetchSequenceRef = useRef(0);
  const fetchAbortRef = useRef(null);
  const hasLoadedRef = useRef(false);
  // Verzögertes Dimmen (Nr. 26): der Timer setzt `refreshing` erst, wenn der
  // Hintergrund-Fetch länger als REFRESH_DIM_DELAY_MS läuft.
  const dimTimerRef = useRef(null);

  // Spiegel des aktuellen Zustands für Handler ohne Stale-Closures
  const stateRef = useRef({});
  stateRef.current = { notes, pagination, noteCounts, allTags, showArchived, showTrash, selectedTag, searchTerm };

  // Läuft ein Fetch mit älterer Sequenz ein, wird sein Ergebnis verworfen.
  const invalidateInFlightFetches = useCallback(() => {
    fetchSequenceRef.current += 1;
    // Der Dimm-Timer des abgewürgten Requests stirbt mit ihm — sonst dimmt er
    // die Liste 250 ms später ohne laufenden Refresh.
    clearTimeout(dimTimerRef.current);
    dimTimerRef.current = null;
    // Nicht nur das Ergebnis verwerfen, sondern den Request beenden: Sonst
    // blockieren die Leichen hinter einem HTTP/1.1-Pfad die sechs Verbindungen
    // pro Origin, und die neueste — einzig relevante — Antwort kommt zuletzt.
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort('ABORTED');
      fetchAbortRef.current = null;
    }
  }, []);

  /**
   * Server-Antwort in den Zustand übernehmen. Bei `merge` (Hintergrund-Refresh)
   * wird nur bei inhaltlicher Abweichung neuer Zustand gesetzt.
   */
  const applyServerState = useCallback((normalized, { merge = false } = {}) => {
    if (merge) {
      const merged = mergeIfChanged(
        {
          notes: stateRef.current.notes,
          pagination: stateRef.current.pagination,
          counts: stateRef.current.noteCounts,
          tags: stateRef.current.allTags,
        },
        {
          notes: normalized.notes,
          pagination: normalized.pagination,
          counts: normalized.counts,
          tags: normalized.tags,
        }
      );
      // Referenzvergleich gegen das ursprüngliche Current-Objekt:
      // mergeIfChanged liefert bei keiner Änderung das Current-Objekt zurück.
      const unchanged =
        merged.notes === stateRef.current.notes
        && merged.pagination === stateRef.current.pagination
        && merged.counts === stateRef.current.noteCounts
        && merged.tags === stateRef.current.allTags;
      if (unchanged) return false;
      setNotes(merged.notes);
      setPagination(merged.pagination);
      setNoteCounts(merged.counts);
      setAllTags(merged.tags);
      return true;
    }
    setNotes(normalized.notes);
    setPagination(normalized.pagination);
    setNoteCounts(normalized.counts);
    setAllTags(normalized.tags);
    return true;
  }, []);

  /**
   * Notizen laden. Vordergrund (default) setzt `loading` (Skeleton beim ersten
   * Laden), Hintergrund (`background: true`) setzt `refreshing` ohne Spinner.
   * `silent` unterdrückt Fehler-Toasts (Interval-Poll/Focus, P17).
   */
  const fetchNotes = useCallback(async (search = '', page = 1, { background = false, silent = false } = {}) => {
    if (!isLoggedIn) return;
    const requestSequence = ++fetchSequenceRef.current;
    // Der vorherige Request wird ersetzt, nicht nur ignoriert.
    if (fetchAbortRef.current) fetchAbortRef.current.abort('ABORTED');
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    // Ein neuer Fetch ersetzt den Vorgänger komplett — auch dessen
    // gegebenenfalls laufenden Dimm-Timer, sonst dimmt ein abgelöster
    // Hintergrund-Refresh den Vordergrund-Load.
    clearTimeout(dimTimerRef.current);
    dimTimerRef.current = null;
    if (background) {
      // Nr. 26: nicht sofort dimmen. Schnelle Antworten (Idle-Poll auf dem
      // eigenen Server) bleiben komplett unterhalb der Schwelle; die Regel
      // selbst ist shouldDimRefresh.
      dimTimerRef.current = setTimeout(() => setRefreshing(true), REFRESH_DIM_DELAY_MS);
    } else {
      setLoading(true);
    }

    try {
      const trashView = stateRef.current.showTrash;
      const params = {
        page,
        limit: NOTES_PAGE_LIMIT,
        archived: trashView ? 'false' : (stateRef.current.showArchived ? 'true' : 'false'),
        deleted: trashView ? 'true' : 'false'
      };
      if (search) params.search = search;
      // Im Papierkorb gibt es keine Tag-Filter (der Server liefert dort keine
      // Tag-Counts), die Suche bleibt verfügbar.
      if (!trashView && stateRef.current.selectedTag) params.tag = stateRef.current.selectedTag;

      const response = await api.getAll(params, { signal: controller.signal });
      if (requestSequence !== fetchSequenceRef.current) return;
      applyServerState(normalizeNotesPayload(response), { merge: background });
    } catch (error) {
      if (requestSequence !== fetchSequenceRef.current) return;
      // Bewusst ersetzter Request (Filterwechsel, Mutation, Unmount): kein
      // Fehler. Ein Timeout dagegen ist einer — ohne diese Unterscheidung bliebe
      // die Liste still im `refreshing`-Zustand stehen.
      if (error?.code === 'ABORTED') return;
      console.error('Fehler beim Laden der Notizen:', error);
      if (!silent) {
        showToast(resolveApiErrorMessage(error, t, 'errorLoadingNotes'), 'error');
      }
    } finally {
      if (fetchAbortRef.current === controller) fetchAbortRef.current = null;
      if (requestSequence === fetchSequenceRef.current) {
        // Nur der aktuellste Fetch darf den Timer anfassen: der finally-Lauf
        // eines supersedeten Requests würde sonst den Timer seines Nachfolgers
        // wegwerfen.
        clearTimeout(dimTimerRef.current);
        dimTimerRef.current = null;
        hasLoadedRef.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [isLoggedIn, api, applyServerState, showToast, t]);

  /**
   * Hintergrund-Refetch (stale-while-revalidate) ohne Spinner.
   */
  const refreshInBackground = useCallback((search = stateRef.current.searchTerm, page = stateRef.current.pagination.page, { silent = false } = {}) => {
    fetchNotes(search, page, { background: true, silent });
  }, [fetchNotes]);

  // Notizen laden wenn eingeloggt bzw. wenn Ansicht/Filter sich ändert.
  // Nur der allererste Load (leere Liste) läuft mit `loading`/Skeletons,
  // alle weiteren Filterwechsel laufen als dimmed Hintergrund-Refresh.
  useEffect(() => {
    if (isLoggedIn && !authLoading) {
      const background = hasLoadedRef.current && stateRef.current.notes.length > 0;
      fetchNotes(searchTerm, 1, { background });
    }
  }, [isLoggedIn, authLoading, showArchived, showTrash, selectedTag, searchTerm, fetchNotes]);

  // Beim Logout: Zustand zurücksetzen und laufende Fetches entwerten.
  useEffect(() => {
    if (!isLoggedIn) {
      hasLoadedRef.current = false;
      invalidateInFlightFetches();
      setNotes([]);
      setPagination(DEFAULT_PAGINATION);
      setNoteCounts(DEFAULT_COUNTS);
      setAllTags([]);
    }
  }, [isLoggedIn, invalidateInFlightFetches]);

  /**
   * Lokale Mutation anwenden und anschließend im Hintergrund revalidieren.
   * Die Sequenz wird erhöht, damit ältere in-flight Fetches die lokale
   * Änderung nicht mit veralteten Serverdaten überschreiben.
   */
  const applyLocallyAndRevalidate = useCallback((action, { page } = {}) => {
    invalidateInFlightFetches();
    if (action) {
      setNotes(prev => applyMutationLocally(prev, action));
    }
    const targetPage = page ?? stateRef.current.pagination.page;
    refreshInBackground(stateRef.current.searchTerm, targetPage);
  }, [invalidateInFlightFetches, refreshInBackground]);

  // Neue Notiz erstellen
  const createNote = useCallback(async (noteData) => {
    setOperationLoading(prev => ({ ...prev, create: true }));
    try {
      const response = normalizeNote(await api.create(noteData));
      if (!response) throw new Error('Ungültige Serverantwort');
      const visibleNow = response.isArchived === Boolean(stateRef.current.showArchived);
      applyLocallyAndRevalidate({ type: 'create', note: response, visible: visibleNow }, { page: 1 });
      showToast(t('noteCreated'), 'success');
      return response;
    } catch (error) {
      console.error('Fehler beim Erstellen der Notiz:', error);
      showToast(resolveApiErrorMessage(error, t, 'errorCreatingNote'), 'error');
      return null;
    } finally {
      setOperationLoading(prev => withoutOperation(prev, 'create'));
    }
  }, [api, applyLocallyAndRevalidate, showToast, t]);

  // Notiz aus dem Papierkorb wiederherstellen (auch als "Rückgängig" nach dem
  // Löschen verwendet, bevor die 30-Tage-Frist abläuft).
  const restoreNote = useCallback(async (id) => {
    setOperationLoading(prev => ({ ...prev, [id]: 'restore' }));
    try {
      const response = normalizeNote(await api.restore(id));
      if (!response) throw new Error('Ungültige Serverantwort');
      const inTrashView = stateRef.current.showTrash;
      applyLocallyAndRevalidate(
        inTrashView
          ? { type: 'delete', id }
          : { type: 'create', note: response, visible: response.isArchived === Boolean(stateRef.current.showArchived) }
      );
      setNoteCounts(prev => ({
        ...prev,
        trash: Math.max(0, (prev.trash || 0) - 1),
        ...(inTrashView
          ? {}
          : response.isArchived
            ? { archived: (prev.archived || 0) + 1 }
            : { active: (prev.active || 0) + 1 })
      }));
      showToast(t('noteRestored'), 'success');
      return response;
    } catch (error) {
      console.error('Fehler beim Wiederherstellen der Notiz:', error);
      showToast(resolveApiErrorMessage(error, t, 'errorUpdating'), 'error');
      return null;
    } finally {
      setOperationLoading(prev => withoutOperation(prev, id));
    }
  }, [api, applyLocallyAndRevalidate, showToast, t]);

  // Notiz löschen -> Papierkorb (30 Tage). "Rückgängig" stellt sie wieder her.
  const deleteNote = useCallback(async (id) => {
    setOperationLoading(prev => ({ ...prev, [id]: 'delete' }));
    try {
      const { notes: currentNotes, pagination: currentPagination } = stateRef.current;
      await api.delete(id);
      applyLocallyAndRevalidate({ type: 'delete', id }, {
        page: currentNotes.length === 1 && currentPagination.page > 1
          ? currentPagination.page - 1
          : currentPagination.page
      });
      // Zähler lokal anpassen (der Hintergrund-Refetch korrigiert serverseitig)
      const countKey = stateRef.current.showArchived ? 'archived' : 'active';
      setNoteCounts(prev => ({
        ...prev,
        [countKey]: Math.max(0, prev[countKey] - 1),
        trash: (prev.trash || 0) + 1
      }));
      setPagination(prev => ({ ...prev, total: Math.max(0, prev.total - 1) }));
      showToast(t('noteMovedToTrash'), 'success', {
        duration: 8000,
        action: { label: t('undo'), onClick: () => restoreNote(id) }
      });
      return true;
    } catch (error) {
      console.error('Fehler beim Löschen der Notiz:', error);
      showToast(resolveApiErrorMessage(error, t, 'errorDeletingNote'), 'error');
      return false;
    } finally {
      setOperationLoading(prev => withoutOperation(prev, id));
    }
  }, [api, applyLocallyAndRevalidate, restoreNote, showToast, t]);

  // Notiz endgültig löschen (nur aus dem Papierkorb, inkl. Bilddateien)
  const purgeNote = useCallback(async (id) => {
    setOperationLoading(prev => ({ ...prev, [id]: 'purge' }));
    try {
      await api.purge(id);
      applyLocallyAndRevalidate({ type: 'delete', id });
      setNoteCounts(prev => ({ ...prev, trash: Math.max(0, (prev.trash || 0) - 1) }));
      setPagination(prev => ({ ...prev, total: Math.max(0, prev.total - 1) }));
      showToast(t('noteDeletedPermanently'), 'success');
      return true;
    } catch (error) {
      console.error('Fehler beim endgültigen Löschen:', error);
      showToast(resolveApiErrorMessage(error, t, 'errorDeletingNote'), 'error');
      return false;
    } finally {
      setOperationLoading(prev => withoutOperation(prev, id));
    }
  }, [api, applyLocallyAndRevalidate, showToast, t]);

  // Papierkorb komplett leeren
  const emptyTrash = useCallback(async () => {
    setOperationLoading(prev => ({ ...prev, trash: true }));
    try {
      const response = await api.emptyTrash();
      invalidateInFlightFetches();
      setNotes([]);
      setPagination(DEFAULT_PAGINATION);
      setNoteCounts(prev => ({ ...prev, trash: 0 }));
      refreshInBackground(stateRef.current.searchTerm, 1);
      showToast(t('trashEmptied', { count: response?.removed ?? 0 }), 'success');
      return true;
    } catch (error) {
      console.error('Fehler beim Leeren des Papierkorbs:', error);
      showToast(resolveApiErrorMessage(error, t, 'errorDeletingNote'), 'error');
      return false;
    } finally {
      setOperationLoading(prev => withoutOperation(prev, 'trash'));
    }
  }, [api, invalidateInFlightFetches, refreshInBackground, showToast, t]);

  // Notiz aktualisieren.
  // 409 (Konflikt durch baseUpdatedAt/optimistic Locking) wird bewusst NICHT
  // generisch behandelt, sondern mit error.status/error.data durchgereicht —
  // NoteModal (B2) fängt ihn ab und bietet die Server-Notiz an.
  const updateNote = useCallback(async (id, updatedData) => {
    setOperationLoading(prev => ({ ...prev, [id]: 'update' }));
    try {
      const response = normalizeNote(await api.update(id, updatedData));
      if (!response) throw new Error('Ungültige Serverantwort');
      applyLocallyAndRevalidate({ type: 'update', note: response });
      showToast(t('noteUpdated'), 'success');
      return response;
    } catch (error) {
      if (error && error.status === 409) {
        console.error('Notiz wurde zwischenzeitlich geändert (409):', error);
        throw error;
      }
      console.error('Fehler beim Aktualisieren der Notiz:', error);
      showToast(resolveApiErrorMessage(error, t, 'errorUpdating'), 'error');
      return null;
    } finally {
      setOperationLoading(prev => withoutOperation(prev, id));
    }
  }, [api, applyLocallyAndRevalidate, showToast, t]);

  // Notiz anheften/abheften (bereits lokales Muster, plus Hintergrund-Revalidation)
  const togglePinNote = useCallback(async (id) => {
    setOperationLoading(prev => ({ ...prev, [id]: 'pin' }));
    try {
      const response = normalizeNote(await api.togglePin(id));
      if (!response) throw new Error('Ungültige Serverantwort');
      applyLocallyAndRevalidate({ type: 'update', note: response });
      const message = response.isPinned ? t('notePinned') : t('noteUnpinned');
      showToast(message, 'success');
      return response;
    } catch (error) {
      console.error('Fehler beim Anheften der Notiz:', error);
      showToast(resolveApiErrorMessage(error, t, 'errorPinningNote'), 'error');
      return null;
    } finally {
      setOperationLoading(prev => withoutOperation(prev, id));
    }
  }, [api, applyLocallyAndRevalidate, showToast, t]);

  // Notiz archivieren/dearchivieren
  const toggleArchiveNote = useCallback(async (id) => {
    setOperationLoading(prev => ({ ...prev, [id]: 'archive' }));
    try {
      const response = normalizeNote(await api.toggleArchive(id));
      if (!response) throw new Error('Ungültige Serverantwort');
      const matchesCurrentView = Boolean(response.isArchived) === Boolean(stateRef.current.showArchived);
      const { notes: currentNotes, pagination: currentPagination } = stateRef.current;
      const leavesView = !matchesCurrentView;
      applyLocallyAndRevalidate(
        matchesCurrentView
          ? { type: 'update', note: response }
          : { type: 'delete', id },
        {
          page: leavesView && currentNotes.length === 1 && currentPagination.page > 1
            ? currentPagination.page - 1
            : currentPagination.page
        }
      );
      if (leavesView) {
        setNoteCounts(prev => response.isArchived
          ? { active: Math.max(0, prev.active - 1), archived: prev.archived + 1 }
          : { active: prev.active + 1, archived: Math.max(0, prev.archived - 1) });
        setPagination(prev => ({ ...prev, total: Math.max(0, prev.total - 1) }));
      }
      const message = response.isArchived ? t('noteArchived') : t('noteUnarchived');
      showToast(message, 'success');
      return response;
    } catch (error) {
      console.error('Fehler beim Archivieren der Notiz:', error);
      showToast(resolveApiErrorMessage(error, t, 'errorUpdating'), 'error');
      return null;
    } finally {
      setOperationLoading(prev => withoutOperation(prev, id));
    }
  }, [api, applyLocallyAndRevalidate, showToast, t]);

  // Wenn eine Notiz geteilt wurde, aktualisieren (ohne Toast/Refetch-Spinner)
  const handleNoteShared = useCallback((updatedNote) => {
    const normalized = normalizeNote(updatedNote);
    if (!normalized) return;
    invalidateInFlightFetches();
    setNotes(prev => applyMutationLocally(prev, { type: 'update', note: normalized }));
  }, [invalidateInFlightFetches]);

  // Drag & Drop Handlers
  const handleDragStart = useCallback((noteId, _event) => {
    setDraggedNoteId(noteId);
  }, []);

  const handleDragEnd = useCallback((_event) => {
    setDraggedNoteId(null);
  }, []);

  const handleDragOver = useCallback((_noteId, _event) => {
    // Allow drop
  }, []);

  const handleDrop = useCallback(async (targetNoteId, _event) => {
    const sourceId = draggedNoteId;
    if (!sourceId || sourceId === targetNoteId) {
      return;
    }

    const draggedNote = stateRef.current.notes.find(n => n._id === sourceId);
    const targetNote = stateRef.current.notes.find(n => n._id === targetNoteId);

    if (!draggedNote || !targetNote) {
      return;
    }

    // In anderer Sektion gedroppt -> Pin-Status togglen
    if (draggedNote.isPinned !== targetNote.isPinned) {
      // togglePinNote toastet selbst (notePinned/noteUnpinned) — ein zweiter
      // Toast würde den ersten sofort verdrängen.
      await togglePinNote(sourceId);
      return;
    }

    // Innerhalb derselben Sektion umsortieren: sofort lokal, dann persistieren.
    // Ohne den Server-Call war der Drop ein No-Op, weil die Liste gleich wieder
    // nach updatedAt sortiert wurde.
    const reordered = applyMutationLocally(stateRef.current.notes, { type: 'reorder', sourceId, targetId: targetNoteId });
    setNotes(reordered);
    setDraggedNoteId(null);

    const sectionIsPinned = Boolean(draggedNote.isPinned);
    const orderedIds = reordered
      .filter(item => Boolean(item.isPinned) === sectionIsPinned)
      .map(item => item._id);

    try {
      // Vor dem Server-Call entwerten: Landet in diesem Fenster die Antwort eines
      // vorher gestarteten Polls, überschreibt sie die frische Ordnung und die
      // Notiz springt sichtbar zurück (bekannt aus BUG_REPORT_2026-09-10 Nr. 16).
      invalidateInFlightFetches();
      await api.reorder(orderedIds);
      // Der Refetch bestätigt die persistierte Ordnung; silent, weil der Drop selbst
      // schon Rückmeldung gibt.
      invalidateInFlightFetches();
      refreshInBackground(stateRef.current.searchTerm, stateRef.current.pagination.page, { silent: true });
    } catch (error) {
      console.error('Fehler beim Speichern der Reihenfolge:', error);
      showToast(resolveApiErrorMessage(error, t, 'errorUpdating'), 'error');
      // Lokale Ordnung zurücknehmen, damit UI und Server nicht auseinanderlaufen.
      refreshInBackground(stateRef.current.searchTerm, stateRef.current.pagination.page);
    }
  }, [api, draggedNoteId, invalidateInFlightFetches, refreshInBackground, showToast, t, togglePinNote]);

  // Live-Refresh geteilter Notizen (P17): Focus/visibilitychange (15s-Throttle)
  // und 60s-Interval-Poll, beides nur bei sichtbarem Tab und im Hintergrund.
  useEffect(() => {
    if (!isLoggedIn) return undefined;

    const throttledFocusRefresh = createThrottledAction(() => {
      refreshInBackground(undefined, undefined, { silent: true });
    }, { windowMs: FOCUS_REFRESH_THROTTLE_MS });

    const onWake = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      throttledFocusRefresh();
    };

    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);

    const pollInterval = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        refreshInBackground(undefined, undefined, { silent: true });
      }
    }, POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
      clearInterval(pollInterval);
      clearTimeout(dimTimerRef.current);
    };
  }, [isLoggedIn, refreshInBackground]);

  // Notizen nach Tag filtern und in angeheftete/sonstige Sektionen trennen
  const { pinnedNotes, otherNotes } = useMemo(() => {
    const filtered = selectedTag
      ? notes.filter(item => item.tags && item.tags.includes(selectedTag))
      : notes;
    const byRecency = (a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
    // Manuelle Reihenfolge (order > 0) schlägt Recency; solange niemand
    // sortiert hat, bleibt die gewohnte „zuletzt bearbeitet zuerst"-Ordnung.
    const hasManualOrder = filtered.some(item => Number(item.order) > 0);
    // Bei aktiver Suche sortiert der Server nach gewichtetem textScore —
    // erneutes Sortieren hier würde die Relevanz wieder zerstören.
    const isSearching = searchTerm.trim() !== '';
    const comparator = isSearching
      ? null
      : hasManualOrder
        ? (a, b) => ((Number(b.order) || 0) - (Number(a.order) || 0)) || byRecency(a, b)
        : byRecency;
    const order = (items) => (comparator ? items.sort(comparator) : items);
    return {
      pinnedNotes: order(filtered.filter(item => item.isPinned)),
      otherNotes: order(filtered.filter(item => !item.isPinned)),
    };
  }, [notes, selectedTag, searchTerm]);

  const emptyStateReason = useMemo(() => getEmptyStateReason({
    hasNotes: pinnedNotes.length > 0 || otherNotes.length > 0,
    selectedTag,
    searchTerm,
  }), [pinnedNotes.length, otherNotes.length, selectedTag, searchTerm]);

  return {
    notes,
    loading,
    refreshing,
    pagination,
    noteCounts,
    allTags,
    operationLoading,
    pinnedNotes,
    otherNotes,
    emptyStateReason,
    fetchNotes,
    refreshInBackground,
    createNote,
    updateNote,
    deleteNote,
    restoreNote,
    purgeNote,
    emptyTrash,
    togglePinNote,
    toggleArchiveNote,
    handleNoteShared,
    draggedNoteId,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDrop,
  };
}

export default useNotesManager;
