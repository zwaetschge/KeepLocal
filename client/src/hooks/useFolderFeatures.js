import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import notesAPI from '../services/api/notesAPI';
import { migrateTagReferences } from '../utils/tagMigration.mjs';

/**
 * v1.10.0: Ableitungen und Handler rund um den Notiz-Baum — als eigener Hook,
 * damit App.jsx reine Verdrahtung bleibt (Zeilen-Guard in
 * tests/notesManagerLogic.test.js).
 *
 * Enthält:
 * - Flattenierung des Baums für Auswahllisten (Ordner-Picker, Bulk-Move,
 *   Journal-Ordner, Elternwahl im Editor)
 * - Titel-Index für Wiki-Links `[[Titel]]` (aus der Baum-Projektion, nicht dem
 *   geladenen Fenster — der Baum kennt jede Notiz)
 * - Tag-Union (Fenster-Tags + Baum-Tags) für die Vervollständigung
 * - Journal „Heute", gespeicherte Suchen, Notiz-in-Ordner-Verschiebung
 */
export function useFolderFeatures({
  notes,
  noteTree,
  treeNodes,
  allTags,
  noteModal,
  findOrCreateTodayNote,
  moveNote,
  draggedNoteId,
  refreshTree,
  fetchNotes,
  openNoteModal,
  showToast,
  t,
  searchTerm,
  selectedTag,
  settings,
  manageTag,
  updateSettings,
  setSavedSearches,
  setSearchTerm,
  setSelectedTag,
  setShowTrash,
  setShowArchived,
  // v1.18.0: Gespeicherte Suchen laufen global — der Ordner-Scope des
  // Moments darf sie nicht still auf einen Unterbaum begrenzen.
  clearFolderScope,
}) {
  /** Notiz öffnen — aus dem Fenster oder per Einzelabruf nachladen. */
  const handleOpenNoteById = useCallback(async (id) => {
    if (!id) return;
    const local = notes.find(item => item._id === id);
    if (local) {
      openNoteModal(local);
      return;
    }
    // Außerhalb des geladenen Fensters (z.B. Wiki-Link in eine alte Notiz):
    // einmal nachladen statt still zu ignorieren.
    try {
      openNoteModal(await notesAPI.getById(id));
    } catch (error) {
      console.error('Notiz konnte nicht geladen werden:', error);
      showToast(t('errorLoadingNotes'), 'error');
    }
  }, [notes, openNoteModal, showToast, t]);

  /** Journal „Heute": Tages-Notiz öffnen (der Notizen-Hook legt sie an —
   *  dieselbe Konvention wie die Android-App, damit beide denselben Treffer
   *  finden). */
  const handleOpenToday = useCallback(async () => {
    const id = await findOrCreateTodayNote(settings.journalFolderId);
    if (id) await handleOpenNoteById(id);
  }, [findOrCreateTodayNote, settings.journalFolderId, handleOpenNoteById]);

  // Gespeicherte Suchen: anwenden, speichern (Suchbegriff + Tag des Moments),
  // löschen. typeFilter bleibt web-seitig ungesetzt (reine Suche/Tag-Suchen).
  const handleRunSavedSearch = useCallback((search) => {
    setShowTrash(false);
    setShowArchived(false);
    // v1.18.0: Ein offener Ordner blieb stehen und begrenzte die gespeicherte
    // Suche still auf diesen Unterbaum — obwohl sie global gemeint war.
    clearFolderScope?.();
    setSearchTerm(search.query || '');
    setSelectedTag(search.tag || null);
  }, [setShowTrash, setShowArchived, clearFolderScope, setSearchTerm, setSelectedTag]);

  const handleSaveCurrentSearch = useCallback(() => {
    const query = searchTerm.trim();
    if (!query && !selectedTag) return;
    const name = [query || null, selectedTag ? `#${selectedTag}` : null]
      .filter(Boolean).join(' · ');
    const id = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setSavedSearches([...settings.savedSearches, { id, name, query, typeFilter: null, tag: selectedTag }].slice(-20));
    showToast(t('savedSearchSaved'), 'success');
  }, [searchTerm, selectedTag, settings.savedSearches, setSavedSearches, showToast, t]);

  const handleDeleteSavedSearch = useCallback((id) => {
    setSavedSearches(settings.savedSearches.filter(search => search.id !== id));
  }, [settings.savedSearches, setSavedSearches]);

  /** v1.11.0: Tag-Pflege aus der Sidebar. v1.16.0: Tag-Farben und gespeicherte
   *  Suchen wandern mit (migrateTagReferences) — im Client, direkt nach dem
   *  erfolgreichen Server-Lauf, weil der SettingsContext die Preferences
   *  debounced zurückpusht. */
  const handleTagManage = useCallback(async (action, from, to) => {
    const result = await manageTag(action, from, to);
    if (!result) return;
    const migration = migrateTagReferences(action, from, to, settings);
    if (migration?.tagColors) updateSettings({ tagColors: migration.tagColors });
    if (migration?.savedSearches) setSavedSearches(migration.savedSearches);

    // Aktiver Tag-Filter wandert mit — in der lowercased-Form, die der
    // Server speichert: Die Notizen tragen "rezepte", ein Roh-"Rezepte"
    // träfe weder das Sidebar-Chip-Highlight noch clientseitiges Filtering.
    const affected = from.map((tag) => tag.toLowerCase());
    if (selectedTag && affected.includes(selectedTag.toLowerCase())) {
      setSelectedTag(action === 'delete' ? null : (to ? to.trim().toLowerCase() : null));
    }
  }, [manageTag, selectedTag, settings, updateSettings, setSavedSearches, setSelectedTag]);

  /** Notiz per Drag & Drop in einen Sidebar-Ordner verschieben. Die gezogene
   *  ID kommt aus dem DnD-Pfad des Notizen-Hooks (draggedNoteId), nicht aus
   *  dem dataTransfer — derselbe Mechanismus wie beim Umsortieren der Liste. */
  const handleFolderDrop = useCallback((parentId) => {
    if (draggedNoteId && draggedNoteId !== parentId) moveNote(draggedNoteId, parentId);
  }, [draggedNoteId, moveNote]);

  /** Flattenierter Baum für Auswahl-Listen. */
  const folderOptions = useMemo(() => {
    const options = [];
    const walk = (entries, depth) => {
      for (const entry of entries) {
        if (!entry.node.isArchived) {
          options.push({ id: entry.node.id, title: entry.node.title || t('untitledNote'), depth });
        }
        walk(entry.children, depth + 1);
      }
    };
    walk(noteTree, 0);
    return options;
  }, [noteTree, t]);

  /** Titel-Index für Wiki-Links. */
  const wikiNotes = useMemo(() => Object.values(treeNodes)
    .filter(node => node.title && !node.isArchived)
    .map(node => ({ id: node.id, title: node.title }))
    .sort((a, b) => a.title.localeCompare(b.title)), [treeNodes]);

  /** Tag-Vervollständigung: Fenster-Tags plus alle Tags aus der Baum-Projektion. */
  const allKnownTags = useMemo(() => {
    const names = new Set(allTags.map(tag => tag.name));
    for (const node of Object.values(treeNodes)) {
      for (const tag of node.tags || []) names.add(tag);
    }
    return Array.from(names).sort();
  }, [allTags, treeNodes]);

  /** v1.17.0 (W3): Anstehende Erinnerungen — die Baum-Projektion trägt remindAt
   *  für den KOMPLETTEN Bestand (nicht nur das 50er-Fenster) und reist
   *  ohnehin im 60s-Poll mit. Archivierte bleiben außen vor; gefeuerte
   *  Erinnerungen bleiben 60 s sichtbar, damit ein kurz vorbei geplanter
   *  Termin nicht sofort verschwindet. */
  // v1.17.1 (Review): Der Cutoff (Date.now()) fraß sich in das useMemo — auf
  // einer idle Session mit unverändertem Baum rechnete er NIE neu, gefeuerte
  // Erinnerungen blieben für immer „anstehend“. Ein Minuten-Tick macht das
  // Memo neu, ohne einen Rerender pro Sekunde zu erzwingen.
  const [reminderTick, setReminderTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setReminderTick((tick) => tick + 1), 60_000);
    return () => clearInterval(id);
  }, []);

  const upcomingReminders = useMemo(() => Object.values(treeNodes)
    .filter(node => node.remindAt && !node.isArchived
      && new Date(node.remindAt).getTime() > Date.now() - 60_000)
    .sort((a, b) => new Date(a.remindAt) - new Date(b.remindAt))
    .slice(0, 5)
    .map(node => ({
      id: node.id,
      title: node.title,
      label: new Date(node.remindAt).toLocaleString(undefined, {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      })
    })), [treeNodes, reminderTick]);

  /** v1.18.0: Erinnerungen FEUERN — die Übersicht oben zeigt sie an, aber der
   *  Termin verstrich still: Toast und System-Notification erschienen nie.
   *  Der 60s-Tick (oder eine Baum-Aktualisierung) prüft, welche remindAt SEIT
   *  dem letzten Check fällig wurde, und stößt genau die einmal pro Notiz und
   *  Session an. Das Nachholf-Fenster ist auf 15 Minuten gedeckelt — ein
   *  Reload soll den kurz verpassten Termin nachholen, nicht jeden alten.
   *  Die Freigabe für System-Notifications gibt es in den Einstellungen;
   *  ohne sie bleibt der Toast. */
  const firedRemindersRef = useRef(new Set());
  const lastDueCheckRef = useRef(Date.now() - 15 * 60_000);
  useEffect(() => {
    // Ohne Baum keine Aussage: Das Fenster darf erst fortschreiten, wenn
    // Daten da sind — sonst brennt der Mount-Lauf (Login-Screen, leerer
    // Baum) die 15 Minuten ab, und ein Termin, der während des Reloads
    // fällig wurde, hätte keine Chance mehr (Review v1.18.0).
    if (Object.keys(treeNodes).length === 0) return;
    const now = Date.now();
    const since = Math.max(lastDueCheckRef.current, now - 15 * 60_000);
    lastDueCheckRef.current = now;
    for (const node of Object.values(treeNodes)) {
      const due = node.remindAt ? new Date(node.remindAt).getTime() : null;
      if (!due || node.isArchived || due > now || due <= since) continue;
      if (firedRemindersRef.current.has(node.id)) continue;
      firedRemindersRef.current.add(node.id);
      const title = node.title || t('untitledNote');
      const label = new Date(node.remindAt).toLocaleString(undefined, {
        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
      });
      showToast(`${t('reminderDue')}: ${title} · ${label}`, 'info', { duration: 10_000 });
      try {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          const notification = new Notification(t('reminderDue'), { body: `${title} · ${label}`, tag: node.id });
          notification.addEventListener('click', () => {
            window.focus();
            handleOpenNoteById(node.id);
          });
        }
      } catch { // Manche Browser werfen ohne Service Worker — der Toast deckt es.
      }
    }
  }, [treeNodes, reminderTick, showToast, t, handleOpenNoteById]);

  /** Nach Markdown-Import (Settings): Liste und Baum nachziehen. */
  const handleDataImported = useCallback(() => {
    fetchNotes(searchTerm, 1, { background: true, silent: true });
    refreshTree();
  }, [fetchNotes, searchTerm, refreshTree]);

  return {
    folderOptions,
    wikiNotes,
    allKnownTags,
    handleOpenNoteById,
    handleOpenToday,
    handleRunSavedSearch,
    handleSaveCurrentSearch,
    handleDeleteSavedSearch,
    handleTagManage,
    handleFolderDrop,
    handleDataImported,
    // v1.17.0 (W3): Erinnerungs-Übersicht in der Sidebar
    upcomingReminders,
  };
}

export default useFolderFeatures;
