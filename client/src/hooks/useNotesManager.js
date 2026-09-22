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

/**
 * Signatur der Meta-Sonde (v1.13.0 Nr. 9): Zählungen + max(updatedAt) als
 * vergleichbarer String. Reine Funktion, damit die Gate-Semantik in
 * tests/notesManagerLogic.test.js ausführbar bleibt.
 */
export function notesMetaSignature(meta) {
  if (!meta || typeof meta !== 'object') return 'none';
  return `${meta.active ?? 0}/${meta.archived ?? 0}/${meta.trash ?? 0}/${meta.maxUpdatedAt || ''}`;
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
 * Verschachtelt die flache /api/notes/tree-Projektion (v1.10.0, pure).
 * Waisen (Eltern gelöscht, Kinder noch nicht hochgezogen) rücken wie Wurzel-
 * Knoten nach oben; ein Zykklus (sollte der Server nie liefern) endet am
 * Tiefen-Cap, statt den Stack zu sprengen.
 *
 * @param {Array} flatNodes - {id, parentId, title, isArchived, ...}
 * @returns {Array} Wurzelknoten {node, children: []}
 */
export function buildNoteTree(flatNodes, { maxDepth = 50 } = {}) {
  if (!Array.isArray(flatNodes)) return [];
  const byId = new Map();
  for (const node of flatNodes) {
    if (node && typeof node.id === 'string') byId.set(node.id, { node, children: [] });
  }
  // Effektive Wurzel-Probe: läuft die Elternkette hoch; ein Zyklus (sollte der
  // Server nie liefern) oder eine Kette jenseits des Caps macht den Knoten
  // selbst zur Wurzel — so bleibt der entstehende Wald garantiert azyklisch
  // und endlich tief, egal was reinkommt.
  const isCyclicOrTooDeep = (entry) => {
    const seen = new Set([entry]);
    let current = entry;
    let depth = 0;
    while (depth <= maxDepth) {
      const parentId = current.node.parentId;
      const parent = parentId ? byId.get(parentId) : null;
      if (!parent) return false;
      if (seen.has(parent)) return true;
      seen.add(parent);
      current = parent;
      depth += 1;
    }
    return true;
  };
  const detached = new Set();
  for (const entry of byId.values()) {
    if (isCyclicOrTooDeep(entry)) detached.add(entry);
  }
  const roots = [];
  for (const entry of byId.values()) {
    if (detached.has(entry)) {
      roots.push(entry);
      continue;
    }
    const parentId = entry.node.parentId;
    const parent = parentId ? byId.get(parentId) : null;
    if (parent && parent !== entry) parent.children.push(entry);
    else roots.push(entry);
  }
  return roots;
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

// v1.10.1: Bulk-Aktionen mit begrenzter Parallelität statt strikt sequenziell —
// 50 angewählte Notizen waren 50 Requests à je ein RTT, mit einem 4er-Pool sind
// es rund 13 Wellen. Ein fehlgeschlagenes Item reißt die anderen nicht mit.
export const BULK_CONCURRENCY = 4;

export async function runPool(items, { limit = BULK_CONCURRENCY, worker } = {}) {
  const results = { done: 0, failed: 0 };
  if (!Array.isArray(items) || items.length === 0 || typeof worker !== 'function') {
    return results;
  }
  const concurrency = Math.max(1, Math.min(Number(limit) || 1, items.length));
  let cursor = 0;
  const lanes = Array.from({ length: concurrency }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      try {
        await worker(item);
        results.done += 1;
      } catch (error) {
        results.failed += 1;
        console.error('Pool-Item fehlgeschlagen:', error);
      }
    }
  });
  await Promise.all(lanes);
  return results;
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
  // v1.10.0: Ordner-Baum + Ansichts-Scope + Mehrfachauswahl
  const [noteTree, setNoteTree] = useState([]);
  const [treeNodes, setTreeNodes] = useState({});
  // v1.10.1: Signatur des letzten Baum-Stands — Poll-Ticks ohne Änderung
  // dürfen keine neuen Identitäten (Sidebar-Rerender) erzeugen.
  const treeSignatureRef = useRef(null);
  // v1.13.0 Nr. 9: Signatur der letzten Meta-Sonde — 60s-Poll-Ticks ohne
  // serverseitige Änderung überspringen Liste+Baum komplett.
  const metaSignatureRef = useRef(null);
  const [folderScope, setFolderScope] = useState(null);
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const fetchSequenceRef = useRef(0);
  const fetchAbortRef = useRef(null);
  const hasLoadedRef = useRef(false);
  // Verzögertes Dimmen (Nr. 26): der Timer setzt `refreshing` erst, wenn der
  // Hintergrund-Fetch länger als REFRESH_DIM_DELAY_MS läuft.
  const dimTimerRef = useRef(null);

  // Spiegel des aktuellen Zustands für Handler ohne Stale-Closures
  const stateRef = useRef({});
  stateRef.current = {
    notes, pagination, noteCounts, allTags, showArchived, showTrash, selectedTag, searchTerm,
    treeNodes, selectedIds, folderScope
  };

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
  const applyServerState = useCallback((normalized, { merge = false, keepAbsentMeta = false } = {}) => {
    // v1.14.0 Nr. 8: Bei includeMeta=false (Folgeseiten im Vordergrund) fehlen
    // counts/tags bewusst in der Antwort — der Sidebar-Stand bleibt gültig.
    // Nur substituieren, wenn der Server sie wirklich weggelassen hat UND wir
    // sie angefordert haben; Trash-Antworten (nie tags) fallen weiter auf [].
    const incomingCounts = keepAbsentMeta && normalized.hasCounts === false
      ? stateRef.current.noteCounts
      : normalized.counts;
    const incomingTags = keepAbsentMeta && normalized.hasTags === false
      ? stateRef.current.allTags
      : normalized.tags;
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
          counts: incomingCounts,
          tags: incomingTags,
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
    setNoteCounts(incomingCounts);
    setAllTags(incomingTags);
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
      // Ordner-Scope (v1.11.1): der Server filtert — clientseitiges Filtern
      // des geladenen Fensters zeigte Ordner ab ein paar hundert Notizen leer.
      if (!trashView && stateRef.current.folderScope) params.folderId = stateRef.current.folderScope;
      // v1.14.0 Nr. 8: Folgeseiten im Vordergrund (Blättern) brauchen keine
      // Counts/Tag-Cloud — die vier Extra-Queries entfallen. Hintergrund-
      // Refreshes laufen nur, wenn die Meta-Sonde eine Änderung meldete —
      // dann können sich auch Counts geändert haben → Meta mitliefern.
      const skipMeta = !background && page > 1;
      if (skipMeta) params.includeMeta = false;

      const response = await api.getAll(params, { signal: controller.signal });
      if (requestSequence !== fetchSequenceRef.current) return;
      applyServerState(normalizeNotesPayload(response), { merge: background, keepAbsentMeta: skipMeta });
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

  /**
   * Ordner-Baum neu lesen (v1.10.0). Läuft still mit: der Baum ist ein Panel
   * neben der Liste, kein primärer Inhalt — ein Fehler dort toastet nur, wenn
   * explizit danach gefragt wird (Erst-/Zweitaufruf über Mutationen bleibt stumm).
   */
  const refreshTree = useCallback(async ({ silent = true } = {}) => {
    if (!isLoggedIn) return;
    try {
      const flat = await api.getTree();
      if (!Array.isArray(flat)) return;
      // v1.10.1: Der Baum reist jetzt im 60-s-Poll mit — der Signatur-Vergleich
      // verhindert, dass jeder Tick bei unverändertem Baum zwei neue Objekt-
      // Identitäten (und damit ein Sidebar-Rerender) erzeugt.
      const signature = JSON.stringify(flat);
      if (signature === treeSignatureRef.current) return;
      treeSignatureRef.current = signature;
      const nodes = {};
      for (const node of flat) {
        if (node && typeof node.id === 'string') nodes[node.id] = node;
      }
      setTreeNodes(nodes);
      setNoteTree(buildNoteTree(flat));
    } catch (error) {
      console.error('Fehler beim Laden des Notiz-Baums:', error);
      if (!silent) showToast(resolveApiErrorMessage(error, t, 'errorLoadingNotes'), 'error');
    }
  }, [isLoggedIn, api, showToast, t]);

  // Notizen laden wenn eingeloggt bzw. wenn Ansicht/Filter sich ändert.
  // Nur der allererste Load (leere Liste) läuft mit `loading`/Skeletons,
  // alle weiteren Filterwechsel laufen als dimmed Hintergrund-Refresh.
  useEffect(() => {
    if (isLoggedIn && !authLoading) {
      const background = hasLoadedRef.current && stateRef.current.notes.length > 0;
      fetchNotes(searchTerm, 1, { background });
      refreshTree();
    }
  }, [isLoggedIn, authLoading, showArchived, showTrash, selectedTag, searchTerm, folderScope, fetchNotes, refreshTree]);

  // Beim Logout: Zustand zurücksetzen und laufende Fetches entwerten.
  useEffect(() => {
    if (!isLoggedIn) {
      hasLoadedRef.current = false;
      invalidateInFlightFetches();
      setNotes([]);
      setPagination(DEFAULT_PAGINATION);
      setNoteCounts(DEFAULT_COUNTS);
      setAllTags([]);
      setNoteTree([]);
      setTreeNodes({});
      treeSignatureRef.current = null;
      // Meta-Signatur ebenfalls verwerfen: Der nächste Login (ggf. ein anderer
      // Account) darf nicht gegen die Signatur der alten Session vergleichen.
      metaSignatureRef.current = null;
      setFolderScope(null);
      setSelectedIds(new Set());
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

  // ---------------------------------------------------------------------------
  // v1.10.0: Ordner (Baum), Verschieben, Mehrfachauswahl, Journal
  // ---------------------------------------------------------------------------

  /** Ansichts-Scope setzen; erneutes Antippen des aktiven Scope zeigt wieder alles. */
  const selectFolder = useCallback((scope) => {
    setFolderScope(prev => (prev === scope ? null : scope));
    setSelectedIds(new Set());
  }, []);

  /** Notiz in einen Ordner verschieben (parentId null = Hauptebene). */
  const moveNote = useCallback(async (id, parentId) => {
    setOperationLoading(prev => ({ ...prev, [id]: 'update' }));
    try {
      const response = normalizeNote(await api.update(id, { parentId }));
      if (!response) throw new Error('Ungültige Serverantwort');
      applyLocallyAndRevalidate({ type: 'update', note: response });
      refreshTree();
      showToast(t('noteMoved'), 'success');
      return response;
    } catch (error) {
      console.error('Fehler beim Verschieben:', error);
      showToast(resolveApiErrorMessage(error, t, 'errorUpdating'), 'error');
      return null;
    } finally {
      setOperationLoading(prev => withoutOperation(prev, id));
    }
  }, [api, applyLocallyAndRevalidate, refreshTree, showToast, t]);

  const toggleNoteSelection = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  /**
   * Führt eine Aktion für die gesamte Mehrfachauswahl sequenziell aus (keine
   * Batch-Endpoints serverseitig). Einzelfehler werden gezählt und geloggt, die
   * Auswahl räumt danach immer ab; ein Refresh zieht den Serverstand nach.
   */
  const runBulkAction = useCallback(async (action) => {
    const ids = Array.from(stateRef.current.selectedIds);
    if (ids.length === 0) return { done: 0, failed: 0 };
    setOperationLoading(prev => ({ ...prev, bulk: true }));
    try {
      // v1.10.1: 4er-Pool statt sequenzieller Schleife — s. runPool.
      const { done, failed } = await runPool(ids, {
        worker: (id) => action(id, stateRef.current.notes.find(note => note._id === id))
      });
      invalidateInFlightFetches();
      refreshInBackground(stateRef.current.searchTerm, 1, { silent: true });
      refreshTree();
      return { done, failed };
    } finally {
      setSelectedIds(new Set());
      setOperationLoading(prev => withoutOperation(prev, 'bulk'));
    }
  }, [invalidateInFlightFetches, refreshInBackground, refreshTree]);

  /** Alle ausgewählten anheften (pin=true) oder abheften. */
  const bulkSetPinned = useCallback(async (pin) => {
    // Nur zählen, was einen API-Call brauchte: runPool meldet auch Worker als
    // done, die vorzeitig returnen — bereits gepinnte Notizen und IDs außer-
    // halb des geladenen Fensters (Auswahl überlebt Pagination/Filter)
    // wären sonst als Erfolg gemeldet worden, ohne dass etwas passierte.
    let acted = 0;
    await runBulkAction(async (id, note) => {
      if (Boolean(note?.isPinned) === pin) return;
      acted += 1;
      await api.togglePin(id);
    });
    if (acted > 0) showToast(t(pin ? 'bulkPinned' : 'bulkUnpinned', { count: acted }), 'success');
  }, [runBulkAction, api, showToast, t]);

  /** Alle ausgewählten archivieren. */
  const bulkArchive = useCallback(async () => {
    let acted = 0;
    await runBulkAction(async (id, note) => {
      if (note?.isArchived) return;
      acted += 1;
      await api.toggleArchive(id);
    });
    if (acted > 0) showToast(t('bulkArchived', { count: acted }), 'success');
  }, [runBulkAction, api, showToast, t]);

  /** Alle ausgewählten in den Papierkorb. */
  const bulkDelete = useCallback(async () => {
    const { done } = await runBulkAction(async (id) => {
      await api.delete(id);
    });
    if (done > 0) showToast(t('bulkDeleted', { count: done }), 'success');
  }, [runBulkAction, api, showToast, t]);

  /** Ein Tag an alle ausgewählten Notizen anhängen (Duplikate überspringen). */
  const bulkAddTag = useCallback(async (tag) => {
    const trimmed = typeof tag === 'string' ? tag.trim() : '';
    if (!trimmed) return;
    const { done } = await runBulkAction(async (id, note) => {
      if (note?.tags?.includes(trimmed)) return;
      await api.update(id, { tags: [...(note?.tags ?? []), trimmed] });
    });
    if (done > 0) showToast(t('bulkTagged', { count: done, tag: trimmed }), 'success');
  }, [runBulkAction, api, showToast, t]);

  /** Alle ausgewählten in einen Ordner verschieben (parentId null = Hauptebene). */
  const bulkMove = useCallback(async (parentId) => {
    const { done } = await runBulkAction(async (id, note) => {
      if (note?.parentId === parentId) return;
      await api.update(id, { parentId });
    });
    if (done > 0) showToast(t('bulkMoved', { count: done }), 'success');
  }, [runBulkAction, api, showToast, t]);

  /**
   * Tag-Pflege über alle sichtbaren Notizen (v1.11.0): Umbenennen, Zusammen-
   * führen oder Löschen als EINE Server-Operation (updateMany-Endpoint) statt
   * einer Update-Request pro Notiz. Liste und Baum danach nachziehen.
   * @returns {Promise<{action: string, modified: number}|null>} null bei Fehler
   */
  const manageTag = useCallback(async (action, from, to) => {
    setOperationLoading(prev => ({ ...prev, bulk: true }));
    try {
      const result = await api.tagOperation(action, from, to);
      invalidateInFlightFetches();
      refreshInBackground(stateRef.current.searchTerm, 1, { silent: true });
      refreshTree();
      if (result?.modified > 0) {
        const message = action === 'delete'
          ? t('tagDeletedToast', { count: result.modified, tag: from[0] })
          : t(action === 'merge' ? 'tagMergedToast' : 'tagRenamedToast', { count: result.modified, tag: from[0], to: to || '' });
        showToast(message, 'success');
      }
      return result ?? { action, modified: 0 };
    } catch (error) {
      showToast(error?.message || t('errorUpdating'), 'error');
      return null;
    } finally {
      setOperationLoading(prev => withoutOperation(prev, 'bulk'));
    }
  }, [api, invalidateInFlightFetches, refreshInBackground, refreshTree, showToast, t]);

  /**
   * Journal „Heute" (v1.10.0): liefert die Tages-Notiz — Titel ist das ISO-
   * Datum, sie liegt im konfigurierten Journal-Ordner — und legt sie beim ersten
   * Zugriff des Tages an. Identisch zur Android-App, damit „Heute" auf beiden
   * Plattformen dieselbe Notiz findet.
   */
  const findOrCreateTodayNote = useCallback(async (journalFolderId) => {
    const today = new Date().toISOString().slice(0, 10);
    const targetParent = journalFolderId ?? null;
    const existing = Object.values(stateRef.current.treeNodes)
      .find(node => node.title === today
        && (node.parentId ?? null) === targetParent
        && !node.isArchived);
    if (existing) return existing.id;
    const created = await createNote({
      title: today,
      content: `# ${today}\n\n`,
      tags: ['Journal'],
      parentId: journalFolderId ?? undefined
    });
    refreshTree();
    return created?._id ?? null;
  }, [createNote, refreshTree]);

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
  // v1.10.1: Der Baum reist mit — vorher blieb die Ordnerstruktur über die
  // ganze Session stehen, während ein anderes Gerät Ordner anlegte/notierte.
  useEffect(() => {
    if (!isLoggedIn) return undefined;

    const throttledFocusRefresh = createThrottledAction(() => {
      refreshInBackground(undefined, undefined, { silent: true });
      refreshTree();
    }, { windowMs: FOCUS_REFRESH_THROTTLE_MS });

    const onWake = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      throttledFocusRefresh();
    };

    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);

    const pollInterval = setInterval(async () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return;
      // v1.13.0 Nr. 9: Meta-Sonde vor dem Voll-Abruf. Zählungen + max(updatedAt)
      // in einer Aggregation entscheiden, ob sich serverseitig überhaupt etwas
      // getan hat — im Leerlauf (Regelfall) fällt sonst pro Tick eine volle
      // 50er-Seite inkl. 5 paralleler DB-Queries plus der komplette Baum an.
      // Fail-open: Geht die Sonde schief oder kennt das API sie nicht, wird
      // wie bisher voll geladen — der Poll hungert nie aus.
      if (typeof api.getMeta === 'function' && hasLoadedRef.current) {
        try {
          const meta = await api.getMeta();
          const signature = notesMetaSignature(meta);
          if (metaSignatureRef.current === signature) return;
          metaSignatureRef.current = signature;
        } catch (_error) {
          // Sonde unerreichbar: unten voll weiterladen.
        }
      }
      refreshInBackground(undefined, undefined, { silent: true });
      refreshTree();
    }, POLL_INTERVAL_MS);

    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
      clearInterval(pollInterval);
      clearTimeout(dimTimerRef.current);
    };
  }, [isLoggedIn, api, refreshInBackground, refreshTree]);

  // Notizen nach Tag filtern und in angeheftete/sonstige Sektionen trennen.
  // Der Ordner-Scope (v1.11.1) filtert der Server (params.folderId) — hier
  // clientseitig zu filtern hieß, nur das geladene 50er-Fenster einzugrenzen:
  // Ab ein paar hundert Notizen bestand jede Seite aus Kindern anderer Ordner
  // und die Ansicht lief leer, obwohl der Ordner voll war.
  const { pinnedNotes, otherNotes } = useMemo(() => {
    let filtered = notes;
    if (selectedTag) {
      filtered = filtered.filter(item => item.tags && item.tags.includes(selectedTag));
    }
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
    // v1.10.0: Baum, Ordner-Scope, Mehrfachauswahl, Journal
    noteTree,
    treeNodes,
    folderScope,
    selectedIds,
    selectFolder,
    refreshTree,
    moveNote,
    toggleNoteSelection,
    clearSelection,
    bulkSetPinned,
    bulkArchive,
    bulkDelete,
    bulkAddTag,
    bulkMove,
    // v1.11.0: Tag umbenennen/zusammenführen/löschen über alle sichtbaren Notizen
    manageTag,
    findOrCreateTodayNote,
  };
}

export default useNotesManager;
