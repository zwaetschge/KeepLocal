package com.keeplocal.android.data.local.dao

import androidx.room.*
import androidx.sqlite.db.SupportSQLiteQuery
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

    // --- Sort modes + paging (v1.8.0); SQL built in NoteQueries ---

    @RawQuery(observedEntities = [NoteEntity::class])
    fun getNotesQuery(query: SupportSQLiteQuery): Flow<List<NoteEntity>>

    /** Live notes with a reminder in the future — the reminder scheduler's
     *  source of truth when (re)planning alarms. */
    @Query("SELECT * FROM notes WHERE remindAtEpochMs IS NOT NULL AND remindAtEpochMs > :nowEpochMs AND isArchived = 0")
    suspend fun getNotesWithUpcomingReminders(nowEpochMs: Long): List<NoteEntity>

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

    // --- Tree (v1.10.0): folder scoping, wiki links, backlinks ---

    /** Direct children of a folder note; `parentId IS :parentId` also matches
     *  the root level when null is bound. */
    @Query("SELECT * FROM notes WHERE parentId IS :parentId AND isArchived = 0 ORDER BY isPinned DESC, position ASC, updatedAt DESC")
    fun getNotesInFolder(parentId: String?): Flow<List<NoteEntity>>

    /** Suspend variant for one-shot subtree walks (cycle guard, move picker). */
    @Query("SELECT id FROM notes WHERE parentId IS :parentId AND isArchived = 0")
    suspend fun getDirectChildIds(parentId: String?): List<String>

    /** The whole live cache in one shot — the tree panel nests this in memory;
     *  local libraries are small enough that a second query family is not
     *  worth the duplication. */
    @Query("SELECT * FROM notes WHERE isArchived = 0 ORDER BY title COLLATE NOCASE ASC")
    suspend fun getAllLiveNotesSync(): List<NoteEntity>

    /** v1.14.0: synchroner Archiv-Lesezugriff — Tag-Spiegel und Sync-Aufräum-
     *  Schritt laufen in suspend-Kontexten ohne Flow-Observer. */
    @Query("SELECT * FROM notes WHERE isArchived = 1 ORDER BY updatedAt DESC")
    suspend fun getAllArchivedNotesSync(): List<NoteEntity>

    /** Wiki-link resolution: [[Title]] targets a note by (case-insensitive)
     *  exact title. Several notes may share a title — the picker decides. */
    @Query("SELECT * FROM notes WHERE title = :title COLLATE NOCASE AND isArchived = 0 ORDER BY updatedAt DESC")
    suspend fun findByExactTitle(title: String): List<NoteEntity>

    /** Backlinks: notes whose content mentions [[title]]. The pattern escapes
     *  LIKE's % and _ so a title containing them matches literally. */
    @Query("SELECT * FROM notes WHERE id != :excludeId AND isArchived = 0 AND content LIKE :pattern ESCAPE '\\' ORDER BY updatedAt DESC")
    suspend fun findBacklinks(excludeId: String, pattern: String): List<NoteEntity>

    /** Moves every child of [oldParentId] onto [newParentId] — the offline
     *  sync's companion to reassignNoteId, so a folder created offline keeps
     *  its children when the parent comes back with a server id. */
    @Query("UPDATE notes SET parentId = :newParentId WHERE parentId = :oldParentId")
    suspend fun reassignParentId(oldParentId: String, newParentId: String)
}

