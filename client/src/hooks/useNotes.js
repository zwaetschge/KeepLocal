import { useState, useCallback, useMemo } from 'react';
import { notesAPI } from '../services/api';

/**
 * Hook for managing notes data and operations
 * Handles CRUD operations, pinning, archiving, and drag & drop
 *
 * @param {Function} showToast - Toast notification function
 * @param {Function} t - Translation function
 * @returns {Object} Notes state and handlers
 *
 * @example
 * const {
 *   notes,
 *   loading,
 *   operationLoading,
 *   fetchNotes,
 *   createNote,
 *   updateNote,
 *   deleteNote,
 *   togglePinNote,
 *   toggleArchiveNote,
 *   dragHandlers
 * } = useNotes(showToast, t);
 */
export function useNotes(showToast, t) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [operationLoading, setOperationLoading] = useState({});
  const [draggedNoteId, setDraggedNoteId] = useState(null);

  /**
   * Fetch notes from API
   * @param {Object} params - Query parameters (archived, tags, search, etc.)
   */
  const fetchNotes = useCallback(
    async (params = {}) => {
      setLoading(true);
      try {
        const data = await notesAPI.getAll(params);
        setNotes(data);
      } catch (error) {
        console.error('Failed to fetch notes:', error);
        if (showToast) {
          showToast(error.message || 'Failed to fetch notes', 'error');
        }
      } finally {
        setLoading(false);
      }
    },
    [showToast]
  );

  /**
   * Create a new note
   * @param {Object} noteData - Note data
   */
  const createNote = useCallback(
    async (noteData) => {
      setOperationLoading((prev) => ({ ...prev, create: true }));
      try {
        const response = await notesAPI.create(noteData);
        setNotes((prev) => [response, ...prev]);
        if (showToast) {
          showToast(t?.('noteCreated') || 'Notiz erfolgreich erstellt', 'success');
        }
        return response;
      } catch (error) {
        console.error('Failed to create note:', error);
        if (showToast) {
          showToast(error.message || 'Fehler beim Erstellen der Notiz', 'error');
        }
        throw error;
      } finally {
        setOperationLoading((prev) => ({ ...prev, create: false }));
      }
    },
    [showToast, t]
  );

  /**
   * Update an existing note
   * @param {string} id - Note ID
   * @param {Object} updatedData - Updated note data
   */
  const updateNote = useCallback(
    async (id, updatedData) => {
      setOperationLoading((prev) => ({ ...prev, [id]: 'update' }));
      try {
        const response = await notesAPI.update(id, updatedData);
        setNotes((prev) => prev.map((note) => (note._id === id ? response : note)));
        if (showToast) {
          showToast(t?.('noteUpdated') || 'Notiz aktualisiert', 'success');
        }
        return response;
      } catch (error) {
        console.error('Failed to update note:', error);
        if (showToast) {
          showToast(error.message || 'Fehler beim Aktualisieren der Notiz', 'error');
        }
        throw error;
      } finally {
        setOperationLoading((prev) => ({ ...prev, [id]: false }));
      }
    },
    [showToast, t]
  );

  /**
   * Delete a note
   * @param {string} id - Note ID
   */
  const deleteNote = useCallback(
    async (id) => {
      setOperationLoading((prev) => ({ ...prev, [id]: 'delete' }));
      try {
        await notesAPI.delete(id);
        setNotes((prev) => prev.filter((note) => note._id !== id));
        if (showToast) {
          showToast(t?.('noteDeleted') || 'Notiz gelöscht', 'success');
        }
      } catch (error) {
        console.error('Failed to delete note:', error);
        if (showToast) {
          showToast(error.message || 'Fehler beim Löschen der Notiz', 'error');
        }
        throw error;
      } finally {
        setOperationLoading((prev) => ({ ...prev, [id]: false }));
      }
    },
    [showToast, t]
  );

  /**
   * Toggle pin status of a note
   * @param {string} id - Note ID
   */
  const togglePinNote = useCallback(
    async (id) => {
      setOperationLoading((prev) => ({ ...prev, [id]: 'pin' }));
      try {
        const response = await notesAPI.togglePin(id);
        setNotes((prev) => prev.map((note) => (note._id === id ? response : note)));
        if (showToast) {
          const message = response.isPinned
            ? t?.('notePinned') || 'Notiz angeheftet'
            : t?.('noteUnpinned') || 'Notiz abgeheftet';
          showToast(message, 'success');
        }
        return response;
      } catch (error) {
        console.error('Failed to pin note:', error);
        if (showToast) {
          showToast(error.message || 'Fehler beim Anheften der Notiz', 'error');
        }
        throw error;
      } finally {
        setOperationLoading((prev) => ({ ...prev, [id]: false }));
      }
    },
    [showToast, t]
  );

  /**
   * Toggle archive status of a note
   * @param {string} id - Note ID
   * @param {boolean} showArchived - Whether currently viewing archived notes
   */
  const toggleArchiveNote = useCallback(
    async (id, showArchived = false) => {
      setOperationLoading((prev) => ({ ...prev, [id]: 'archive' }));
      try {
        const response = await notesAPI.toggleArchive(id);
        if (showToast) {
          const message = response.isArchived
            ? t?.('noteArchived') || 'Notiz archiviert'
            : t?.('noteUnarchived') || 'Notiz wiederhergestellt';
          showToast(message, 'success');
        }

        // Remove note from list if it doesn't match current view
        if ((response.isArchived && !showArchived) || (!response.isArchived && showArchived)) {
          setNotes((prev) => prev.filter((note) => note._id !== id));
        } else {
          setNotes((prev) => prev.map((note) => (note._id === id ? response : note)));
        }

        return response;
      } catch (error) {
        console.error('Failed to archive note:', error);
        if (showToast) {
          showToast(error.message || t?.('errorUpdating') || 'Fehler beim Archivieren', 'error');
        }
        throw error;
      } finally {
        setOperationLoading((prev) => ({ ...prev, [id]: false }));
      }
    },
    [showToast, t]
  );

  /**
   * Update a note after sharing (without showing toast)
   * @param {Object} updatedNote - Updated note data
   */
  const updateNoteAfterShare = useCallback((updatedNote) => {
    setNotes((prev) =>
      prev.map((note) => (note._id === updatedNote._id ? updatedNote : note))
    );
  }, []);

  /**
   * Drag & Drop handlers
   */
  const dragHandlers = useMemo(
    () => ({
      handleDragStart: (noteId) => {
        setDraggedNoteId(noteId);
      },

      handleDragEnd: () => {
        setDraggedNoteId(null);
      },

      handleDragOver: (e) => {
        e.preventDefault();
      },

      handleDrop: async (targetNoteId) => {
        if (!draggedNoteId || draggedNoteId === targetNoteId) {
          setDraggedNoteId(null);
          return;
        }

        const draggedNote = notes.find((n) => n._id === draggedNoteId);
        const targetNote = notes.find((n) => n._id === targetNoteId);

        if (!draggedNote || !targetNote) {
          setDraggedNoteId(null);
          return;
        }

        // If dropped in different section (pinned vs unpinned), toggle pin status
        if (draggedNote.isPinned !== targetNote.isPinned) {
          await togglePinNote(draggedNoteId);
        }

        setDraggedNoteId(null);
      },

      draggedNoteId,
    }),
    [draggedNoteId, notes, togglePinNote]
  );

  return {
    notes,
    setNotes,
    loading,
    operationLoading,
    fetchNotes,
    createNote,
    updateNote,
    deleteNote,
    togglePinNote,
    toggleArchiveNote,
    updateNoteAfterShare,
    dragHandlers,
  };
}

export default useNotes;
