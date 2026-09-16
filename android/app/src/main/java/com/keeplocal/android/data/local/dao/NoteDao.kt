package com.keeplocal.android.data.local.dao

import androidx.room.*
import com.keeplocal.android.data.local.entity.NoteEntity
import kotlinx.coroutines.flow.Flow

@Dao
interface NoteDao {
    @Query("SELECT * FROM notes WHERE isArchived = 0 ORDER BY isPinned DESC, position ASC, updatedAt DESC")
    fun getAllNotes(): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE isArchived = 1 ORDER BY updatedAt DESC")
    fun getArchivedNotes(): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE isArchived = 0 AND (title LIKE '%' || :query || '%' OR content LIKE '%' || :query || '%' OR todoItemsJson LIKE '%' || :query || '%' OR tagsJson LIKE '%' || :query || '%') ORDER BY isPinned DESC, updatedAt DESC")
    fun searchNotes(query: String): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE id = :id")
    suspend fun getNoteById(id: String): NoteEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertNote(note: NoteEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertNotes(notes: List<NoteEntity>)

    @Delete
    suspend fun deleteNote(note: NoteEntity)

    @Query("DELETE FROM notes WHERE id = :id")
    suspend fun deleteNoteById(id: String)

    @Query("DELETE FROM notes")
    suspend fun deleteAll()

    // --- Manual ordering (drag & drop, PATCH /api/notes/reorder) ---

    /** Current display order of live notes — the basis for drag-reorder and
     *  for replaying a queued REORDER after reconnect. */
    @Query("SELECT id FROM notes WHERE isArchived = 0 ORDER BY isPinned DESC, position ASC, updatedAt DESC")
    suspend fun getActiveNoteIdsInDisplayOrder(): List<String>

    @Query("UPDATE notes SET position = :position WHERE id = :id")
    suspend fun updatePosition(id: String, position: Int)

    /** Pinned live notes for the home-screen widget. */
    @Query("SELECT * FROM notes WHERE isArchived = 0 AND isPinned = 1 ORDER BY position ASC LIMIT :limit")
    suspend fun getPinnedNotes(limit: Int): List<NoteEntity>

    // --- "Clear local cache" support (SettingsViewModel.clearCache) ---

    /** Number of distinct notes still referenced by an open pending operation. */
    @Query("SELECT COUNT(DISTINCT noteId) FROM pending_operations")
    suspend fun countPendingNoteIds(): Int

    /**
     * Deletes only notes that are NOT referenced by an open pending
     * operation, so unsynced offline notes survive a cache clear until they
     * were synced. Returns the number of deleted rows.
     */
    @Query("DELETE FROM notes WHERE id NOT IN (SELECT noteId FROM pending_operations)")
    suspend fun deleteSyncedNotes(): Int
}
