package com.keeplocal.android.domain.repository

import com.keeplocal.android.domain.model.FolderScope
import com.keeplocal.android.domain.model.LinkPreview
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteTreeNode
import com.keeplocal.android.domain.model.NoteTypeFilter
import com.keeplocal.android.domain.model.SortMode
import com.keeplocal.android.util.MarkdownNoteParser
import com.keeplocal.android.util.NoteImportParser
import com.keeplocal.android.util.Result
import kotlinx.coroutines.flow.Flow
import java.io.OutputStream

interface NoteRepository {
    /**
     * Current list view (v1.8.0): syncs the offline queue, refreshes the Room
     * cache from the server, then reads the display list back from Room — so
     * [sortMode] and [limit] (paging window; null = everything) apply equally
     * to fresh server data and to the offline fallback. [filter] (v1.9.0)
     * narrows the result to a structural type; unlike the server-side search
     * it is applied locally, in SQL, so it also works offline. [scope]
     * (v1.10.0) narrows the grid to one tree node or the root level.
     */
    fun getNotes(
        search: String? = null,
        tag: String? = null,
        archived: Boolean = false,
        sortMode: SortMode = SortMode.MANUAL,
        limit: Int? = null,
        filter: NoteTypeFilter = NoteTypeFilter.ALL,
        scope: FolderScope = FolderScope.All
    ): Flow<Result<List<Note>>>

    /** Room-only view for cheap re-reads: sort switch, "load more", widget.
     *  Never touches the network. */
    fun getCachedNotes(
        search: String? = null,
        archived: Boolean = false,
        sortMode: SortMode = SortMode.MANUAL,
        limit: Int? = null,
        filter: NoteTypeFilter = NoteTypeFilter.ALL,
        scope: FolderScope = FolderScope.All
    ): Flow<Result<List<Note>>>
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
    /**
     * Live notes whose reminder lies in the future, soonest first — the
     * "upcoming" overview (v1.9.0 Nr. 5). Local cache only: reminders are
     * device-scheduled anyway, so this works offline by construction.
     */
    suspend fun getUpcomingReminders(): Result<List<Note>>
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

    /**
     * Import (v1.8.0 Nr. 1): creates every parsed export note as a NEW note
     * (server copy) — existing notes are never touched. Runs through
     * createNote, so it is offline-capable and queues like any other edit.
     * Returns how many notes were created.
     */
    suspend fun importNotes(notes: List<NoteImportParser.ParsedNote>): Result<Int>

    /**
     * Duplicate (v1.8.0 Nr. 8): full copy of the note under a "(Kopie)" title,
     * created like a new note (own id, reminders kept, sharing not copied).
     */
    suspend fun duplicateNote(noteId: String, copyLabel: String): Result<Note>

    // --- Tree, wiki links, journal (v1.10.0) ---

    /**
     * The whole live tree nested in memory out of the Room cache. A note with
     * children is a folder — there is no separate folder type. Roots are notes
     * without a parent; orphans whose parent row is missing are surfaced as
     * roots instead of silently disappearing.
     */
    suspend fun getNoteTree(): Result<List<NoteTreeNode>>

    /**
     * Moves a note to another parent (null = root level). Cycles are rejected
     * locally before anything is sent — a note never moves into itself or its
     * own subtree. Routes through [updateNote], so the move is offline-capable
     * and conflict-guarded like any edit.
     */
    suspend fun moveNote(id: String, parentId: String?): Result<Note>

    /** All ids in the note's subtree, [id] itself included — the move picker
     *  disables these targets, bulk actions bound their scope with it. */
    suspend fun getSubtreeIds(id: String): List<String>

    /**
     * Wiki-link resolution: [[Title]] targets notes by exact title
     * (case-insensitive). Several notes may share a title — the caller picks.
     */
    suspend fun findByExactTitle(title: String): Result<List<Note>>

    /**
     * Notes whose content mentions [[title]] ("Erwähnt in"). Pure Room query —
     * works offline and updates with every cache refresh.
     */
    suspend fun getBacklinks(title: String, excludeId: String): Result<List<Note>>

    /**
     * Journal (v1.10.0): the note for today, titled with the ISO date
     * ("2026-09-19") inside the configured journal folder (root level when no
     * folder is set). Creates it on first access of the day, tagged "Journal".
     */
    suspend fun findOrCreateTodayNote(): Result<Note>

    /**
     * Markdown export (v1.10.0): streams the server-built ZIP (folders =
     * directories, one .md per note) into [output]. The caller owns the
     * stream and closes it. Returns the number of bytes written.
     */
    suspend fun exportMarkdownTo(output: OutputStream): Result<Long>

    /**
     * Markdown/Trilium import (v1.10.0): turns traversed .md files into notes
     * — directories become folder notes (`_index.md` supplies their content),
     * files become their children. Returns how many notes were created.
     */
    suspend fun importMarkdownFiles(files: List<MarkdownNoteParser.FileEntry>): Result<Int>
}
