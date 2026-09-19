import { useCallback, useMemo } from 'react';
import notesAPI from '../services/api/notesAPI';

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
 * - Backlinks („Erwähnt in") für die geöffnete Notiz, rein clientseitig
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
  setSavedSearches,
  setSearchTerm,
  setSelectedTag,
  setShowTrash,
  setShowArchived,
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
    setSearchTerm(search.query || '');
    setSelectedTag(search.tag || null);
  }, [setShowTrash, setShowArchived, setSearchTerm, setSelectedTag]);

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

  /** Backlinks („Erwähnt in") für die geöffnete Notiz — exakt das `[[Titel]]`,
   *  das der Editor schreibt, über das geladene Fenster. */
  const backlinks = useMemo(() => {
    const title = noteModal.note?.title?.trim();
    if (!noteModal.isOpen || !title) return [];
    const needle = `[[${title}]]`;
    return notes
      .filter(item => item._id !== noteModal.note._id && !item.isArchived
        && (item.content || '').includes(needle))
      .map(item => ({ id: item._id, title: item.title || t('untitledNote') }));
  }, [noteModal, notes, t]);

  /** Nach Markdown-Import (Settings): Liste und Baum nachziehen. */
  const handleDataImported = useCallback(() => {
    fetchNotes(searchTerm, 1, { background: true, silent: true });
    refreshTree();
  }, [fetchNotes, searchTerm, refreshTree]);

  return {
    folderOptions,
    wikiNotes,
    allKnownTags,
    backlinks,
    handleOpenNoteById,
    handleOpenToday,
    handleRunSavedSearch,
    handleSaveCurrentSearch,
    handleDeleteSavedSearch,
    handleFolderDrop,
    handleDataImported,
  };
}

export default useFolderFeatures;
