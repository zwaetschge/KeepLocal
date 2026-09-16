package com.keeplocal.android.domain.repository

import com.keeplocal.android.domain.model.LinkPreview
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.util.Result
import kotlinx.coroutines.flow.Flow

interface NoteRepository {
    fun getNotes(search: String? = null, tag: String? = null, archived: Boolean = false): Flow<Result<List<Note>>>
    suspend fun getNote(id: String): Result<Note>
    suspend fun createNote(note: Note): Result<Note>
    suspend fun updateNote(note: Note): Result<Note>
    suspend fun deleteNote(id: String): Result<Unit>
    // Trash (30-day server retention). Online-only by design: trashed notes
    // never enter the offline cache, so these always hit the API directly.
    /** Notes in the trash, newest deletion first. */
    suspend fun getTrashedNotes(): Result<List<Note>>
    /** Moves a note back out of the trash. */
    suspend fun restoreNote(id: String): Result<Note>
    /** Permanently deletes a trashed note, including its images. */
    suspend fun purgeNote(id: String): Result<Unit>
    /** Empties the whole trash; returns how many notes were purged. */
    suspend fun emptyTrash(): Result<Int>
    suspend fun togglePin(id: String): Result<Note>
    suspend fun toggleArchive(id: String): Result<Note>
    /**
     * Persists a new display order (drag & drop): writes the positions to
     * Room immediately, then pushes PATCH /api/notes/reorder — offline ids
     * are filtered out and the list is chunked to the server's 200-id limit.
     * Offline, the order is queued as a single deduplicated REORDER op that
     * replays with the then-current Room order.
     */
    suspend fun reorderNotes(orderedIds: List<String>): Result<Unit>
    /**
     * Brings a just-deleted note back. If the DELETE has not been synced it
     * is pulled from the queue and the cached row restored; otherwise the
     * server-side trash restore endpoint is used.
     */
    suspend fun undoDelete(note: Note): Result<Unit>
    /** Pinned notes for the home-screen widget. */
    suspend fun getPinnedNotes(maxCount: Int): Result<List<Note>>
    suspend fun shareNote(noteId: String, userId: String): Result<Unit>
    suspend fun unshareNote(noteId: String, userId: String): Result<Unit>
    suspend fun getLinkPreview(url: String): Result<LinkPreview>
    /**
     * All live notes (active + archived, not trashed) for the user-triggered
     * export (v1.6.0 Nr. 7). Hits the API directly with pagination instead of
     * getNotes() — that flow rebuilds the Room cache and a call with
     * archived=true would leave the cache holding only archived rows. Falls
     * back to the offline cache when the server is unreachable, which is
     * exactly what a backup is for.
     */
    suspend fun getAllNotesForExport(): Result<List<Note>>
}
