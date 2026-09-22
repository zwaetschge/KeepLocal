package com.keeplocal.android.data.local.dao

import androidx.room.*
import com.keeplocal.android.data.local.entity.PendingOperationEntity

@Dao
interface PendingOperationDao {
    @Query("SELECT * FROM pending_operations ORDER BY createdAt ASC")
    suspend fun getAllOperations(): List<PendingOperationEntity>

    @Insert
    suspend fun insert(operation: PendingOperationEntity)

    @Delete
    suspend fun delete(operation: PendingOperationEntity)

    @Query("DELETE FROM pending_operations")
    suspend fun deleteAll()

    @Query("SELECT COUNT(*) FROM pending_operations")
    suspend fun getCount(): Int

    /** Drops every queued op of one type for one note — undo-delete uses this
     *  to cancel a DELETE that has not been synced yet. */
    @Query("DELETE FROM pending_operations WHERE noteId = :noteId AND operationType = :operationType")
    suspend fun deleteByNoteAndType(noteId: String, operationType: String)

    /** Drops one specific queued op — the sync-queue view's discard button. */
    @Query("DELETE FROM pending_operations WHERE id = :id")
    suspend fun deleteById(id: Long)

    /** Drops every queued op of one type regardless of note — keeps at most
     *  one open REORDER op (the replay always sends the freshest order). */
    @Query("DELETE FROM pending_operations WHERE operationType = :operationType")
    suspend fun deleteByType(operationType: String)

    /**
     * Re-points every queued operation of a note at a new id — used after an
     * offline CREATE succeeded and the temporary offline id was replaced by
     * the server id, so the following UPDATE/TOGGLE ops hit the right note.
     */
    @Query("UPDATE pending_operations SET noteId = :newId WHERE noteId = :oldId")
    suspend fun reassignNoteId(oldId: String, newId: String)

    @Query("SELECT COUNT(*) FROM pending_operations WHERE noteId = :noteId AND operationType = :operationType")
    suspend fun getCountForNoteAndType(noteId: String, operationType: String): Int

    /**
     * Live check per note id — the delta pull upserts over seconds, and a
     * snapshot of pending ids taken before the loop would miss an offline
     * edit queued mid-pull (its Room row would be overwritten by the server
     * version: silent data loss instead of a 409 conflict copy).
     */
    @Query("SELECT COUNT(*) FROM pending_operations WHERE noteId = :noteId")
    suspend fun getCountForNote(noteId: String): Int
}
