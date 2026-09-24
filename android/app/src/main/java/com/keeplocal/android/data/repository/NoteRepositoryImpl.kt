package com.keeplocal.android.data.repository

import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.api.dto.ImportMarkdownRequestDto
import com.keeplocal.android.data.api.dto.ReorderNotesDto
import com.keeplocal.android.data.api.dto.NoteDto
import com.keeplocal.android.data.api.dto.LinkPreviewRequestDto
import com.keeplocal.android.data.api.dto.ShareNoteDto
import com.keeplocal.android.data.api.dto.TagOperationRequestDto
import com.keeplocal.android.data.api.dto.buildMarkdownImportItems
import com.keeplocal.android.data.api.dto.toDomain
import com.keeplocal.android.data.api.dto.toCreateDto
import com.keeplocal.android.data.api.dto.toUpdateDto
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.data.local.SyncManager
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.dao.NoteQueries
import com.keeplocal.android.data.local.dao.PendingOperationDao
import com.keeplocal.android.data.local.entity.OperationType
import com.keeplocal.android.data.local.entity.PendingOperationEntity
import com.keeplocal.android.data.local.entity.toEntity
import com.keeplocal.android.data.local.entity.toDomain as entityToDomain
import com.keeplocal.android.domain.model.FolderScope
import com.keeplocal.android.domain.model.LinkPreview
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteColor
import com.keeplocal.android.domain.model.NoteTreeNode
import com.keeplocal.android.domain.model.NoteTypeFilter
import com.keeplocal.android.domain.model.SortMode
import com.keeplocal.android.domain.model.TodoItem
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.reminder.ReminderScheduler
import com.keeplocal.android.util.FileLogger
import com.keeplocal.android.util.MarkdownNoteParser
import com.keeplocal.android.util.NoteImportParser
import com.keeplocal.android.util.NoteShareFormatter
import com.keeplocal.android.util.Result
import com.keeplocal.android.util.ServerContract
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.withContext
import java.io.IOException
import java.io.OutputStream
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import javax.inject.Inject

// Server-side page size for note lists. A real "load more" needs a page
// parameter threaded through NoteRepository/GetNotesUseCase — reported as an
// open integration point instead of half-wired here.
private const val NOTES_PAGE_LIMIT = 100

/** Chunk size for the markdown bulk import — the server's per-request cap
 *  (validators: items max 500), same chunking the web client uses. */
private const val IMPORT_CHUNK_SIZE = 500

class NoteRepositoryImpl @Inject constructor(
    private val api: KeepLocalApi,
    private val noteDao: NoteDao,
    private val pendingOperationDao: PendingOperationDao,
    private val syncManager: SyncManager,
    private val settingsDataStore: SettingsDataStore,
    private val reminderScheduler: ReminderScheduler,
    private val fileLogger: FileLogger
) : NoteRepository {

    override fun getNotes(
        search: String?,
        tag: String?,
        archived: Boolean,
        sortMode: SortMode,
        limit: Int?,
        filter: NoteTypeFilter,
        scope: FolderScope
    ): Flow<Result<List<Note>>> = flow {
        try { syncManager.syncPendingOperations() } catch (e: CancellationException) { throw e } catch (_: Exception) {}

        try {
            fileLogger.log(
                "NoteRepo",
                "getNotes: search=${FileLogger.redact(search ?: "")} tag=${FileLogger.redact(tag ?: "")} archived=$archived"
            )
            val response = api.getNotes(search = search, tag = tag, archived = archived, limit = NOTES_PAGE_LIMIT)
            fileLogger.log("NoteRepo", "getNotes response: code=${response.code()}")
            if (response.isSuccessful) {
                var dtos = response.body()?.getNotesList() ?: emptyList()
                // v1.13.0 Nr. 1: Die Klartext-Liste (ohne Suche/Tag) zieht ALLE
                // Seiten nach — der Server paginiert mit 100 pro Seite, und bis-
                // her blieb der Room-Cache ab Notiz 101 dauerhaft unvollständig
                // (Offline-Liste, Erinnerungen, Widgets). Suche/Tag bleiben bei
                // einer Seite: Dort rankt der serverseitige Volltextindex über
                // den Gesamtbestand, und die erste Seite trägt die Treffer.
                if (search == null && tag == null) {
                    dtos = dtos + fetchRemainingNotePages(archived, response.body()?.pages, dtos.size)
                }
                val notes = dtos.map { it.toDomain() }
                fileLogger.log("NoteRepo", "getNotes success: ${notes.size} notes")
                settingsDataStore.setLastSyncAt(System.currentTimeMillis())
                // Server rows always become the new optimistic-lock base.
                val serverEntities = dtos.map { dto ->
                    dto.toDomain().toEntity().copy(baseUpdatedAt = dto.updatedAt)
                }
                if (search == null && tag == null) {
                    // Preserve locally modified notes that haven't synced yet
                    val pendingNoteIds = dirtyNoteIds()

                    if (pendingNoteIds.isEmpty()) {
                        noteDao.deleteAll()
                        noteDao.insertNotes(serverEntities)
                    } else {
                        fileLogger.log("NoteRepo", "Preserving ${pendingNoteIds.size} locally modified notes: $pendingNoteIds")
                        // Read pending local notes BEFORE deleting
                        val pendingLocalNotes = pendingNoteIds.mapNotNull { id ->
                            noteDao.getNoteById(id)
                        }
                        // Now safe to delete all and rebuild
                        noteDao.deleteAll()
                        // Insert server notes that DON'T have pending local changes
                        noteDao.insertNotes(serverEntities.filter { it.id !in pendingNoteIds })
                        // Re-insert locally modified notes
                        if (pendingLocalNotes.isNotEmpty()) {
                            noteDao.insertNotes(pendingLocalNotes)
                        }
                    }
                    // The rebuild replaced every cached reminder — re-plan all
                    // alarms in one sweep (v1.8.0).
                    try { reminderScheduler.rescheduleAll() } catch (_: Exception) {}
                    // Room is the single display source for the plain list:
                    // sorting and the paging window apply to fresh server data
                    // and offline alike. The tree scope rides along (v1.10.0).
                    emit(Result.Success(readCache(null, archived, sortMode, limit, filter, scope)))
                } else {
                    // Search/tag results keep the server's relevance ranking
                    // (full-text index over ALL notes, not just the cache);
                    // the hits are merged into Room so the offline fallback
                    // knows them too. An explicitly chosen sort re-orders even
                    // search results — MANUAL means "as delivered". The type
                    // chip is a client-side concern — the server has no such
                    // filter — so it narrows the ranked hits in memory; so
                    // does the tree scope (the server search is tree-blind).
                    // Same dirty-set guard as the plain list: a queued local
                    // op means the server answer predates the offline edit.
                    // The stale row must not clobber the Room version (a
                    // queued UPDATE replays FROM Room) and the list shows the
                    // local version in the hit's place, exactly like the
                    // cache rebuild does for the plain list.
                    val pendingNoteIds = dirtyNoteIds()
                    val hasDirty = pendingNoteIds.isNotEmpty()
                    noteDao.insertNotes(
                        if (hasDirty) serverEntities.filter { it.id !in pendingNoteIds } else serverEntities
                    )
                    // A dirty id without a cached row (row lost, op stranded)
                    // is dropped instead of surfacing the stale server body.
                    val localDirty = if (hasDirty) {
                        pendingNoteIds.mapNotNull { noteDao.getNoteById(it) }.associateBy { it.id }
                    } else {
                        emptyMap()
                    }
                    val filtered = notes
                        .mapNotNull { if (it.id in pendingNoteIds) localDirty[it.id]?.entityToDomain() else it }
                        .let { if (filter == NoteTypeFilter.ALL) it else it.filter { filter.matches(it) } }
                        .let { if (scope == FolderScope.All) it else it.filter { scope.matches(it.parentId) } }
                    val display = if (sortMode == SortMode.MANUAL) filtered else sortInMemory(filtered, sortMode)
                    emit(Result.Success(window(display, limit)))
                }
            } else {
                val body = try { response.errorBody()?.string()?.take(500) } catch (_: Exception) { null }
                fileLogger.error("NoteRepo", "getNotes failed: code=${response.code()} body=$body")
                emit(Result.Error(errorMessage("Loading notes", response.code(), body)))
            }
        } catch (e: Exception) {
            fileLogger.error("NoteRepo", "getNotes exception, serving cache", e)
            try {
                val cached = readCache(search, archived, sortMode, limit, filter, scope)
                if (cached.isNotEmpty()) {
                    emit(Result.Success(cached))
                } else {
                    emit(Result.Error(exceptionMessage(e)))
                }
            } catch (_: Exception) {
                emit(Result.Error(exceptionMessage(e)))
            }
        }
    }

    override fun getCachedNotes(
        search: String?,
        archived: Boolean,
        sortMode: SortMode,
        limit: Int?,
        filter: NoteTypeFilter,
        scope: FolderScope
    ): Flow<Result<List<Note>>> = flow {
        emit(Result.Success(readCache(search, archived, sortMode, limit, filter, scope)))
    }

    /**
     * The display list out of Room, honouring sort mode and paging window.
     * A blank search reads the whole section; a term narrows it with the same
     * LIKE match the offline fallback always used. The type filter rides
     * along in SQL (v1.9.0), and so does the tree scope (v1.10.0).
     */
    private suspend fun readCache(
        search: String?,
        archived: Boolean,
        sortMode: SortMode,
        limit: Int?,
        filter: NoteTypeFilter = NoteTypeFilter.ALL,
        scope: FolderScope = FolderScope.All
    ): List<Note> {
        val query = when {
            !search.isNullOrBlank() -> NoteQueries.searchNotes(search, sortMode, limit, filter, scope)
            archived -> NoteQueries.archivedNotes(sortMode, limit)
            else -> NoteQueries.liveNotes(sortMode, limit, filter, scope)
        }
        return noteDao.getNotesQuery(query).first().map { it.entityToDomain() }
    }

    override suspend fun getNote(id: String): Result<Note> {
        return try {
            val response = api.getNote(id)
            if (response.isSuccessful) {
                val note = response.body()?.toDomain() ?: throw Exception("Note not found")
                // A freshly fetched note is by definition current — mark it
                // as its own base so a following edit sends the right guard.
                Result.Success(note.copy(baseUpdatedAt = note.updatedAt))
            } else {
                val cached = noteDao.getNoteById(id)
                if (cached != null) Result.Success(cached.entityToDomain())
                else Result.Error(errorMessage("Loading note", response.code()))
            }
        } catch (e: Exception) {
            val cached = noteDao.getNoteById(id)
            if (cached != null) Result.Success(cached.entityToDomain())
            else Result.Error(exceptionMessage(e))
        }
    }

    override suspend fun createNote(note: Note): Result<Note> {
        return try {
            fileLogger.log("NoteRepo", "createNote: titleLength=${note.title.length} contentLength=${note.content.length}")
            val response = api.createNote(note.toCreateDto())
            if (response.isSuccessful) {
                val dto = response.body() ?: throw Exception("Failed to create note")
                val created = dto.toDomain()
                fileLogger.log("NoteRepo", "createNote success: id=${created.id}")
                noteDao.insertNote(created.toEntity().copy(baseUpdatedAt = dto.updatedAt))
                try { reminderScheduler.syncForNote(created.id) } catch (_: Exception) {}
                Result.Success(created)
            } else {
                val body = try { response.errorBody()?.string()?.take(500) } catch (_: Exception) { null }
                fileLogger.error("NoteRepo", "createNote failed: code=${response.code()} body=$body")
                throw Exception(errorMessage("Creating note", response.code(), body))
            }
        } catch (e: Exception) {
            fileLogger.error("NoteRepo", "createNote exception, saving offline", e)
            val offlineId = "offline_${UUID.randomUUID()}"
            val offlineNote = note.copy(id = offlineId)
            noteDao.insertNote(offlineNote.toEntity())
            pendingOperationDao.insert(
                PendingOperationEntity(
                    operationType = OperationType.CREATE,
                    noteId = offlineId,
                    payloadJson = ""
                )
            )
            syncManager.onPendingOperationQueued()
            try { reminderScheduler.syncForNote(offlineId) } catch (_: Exception) {}
            Result.Success(offlineNote)
        }
    }

    override suspend fun updateNote(note: Note): Result<Note> {
        // Optimistic locking base: the version this edit started from, falling
        // back to the last synced version of the cached row.
        val baseUpdatedAt = note.baseUpdatedAt?.toString()
            ?: noteDao.getNoteById(note.id)?.baseUpdatedAt
        return try {
            fileLogger.log("NoteRepo", "updateNote: id=${note.id} titleLength=${note.title.length} contentLength=${note.content.length}")
            val response = api.updateNote(note.id, note.toUpdateDto().copy(baseUpdatedAt = baseUpdatedAt))
            if (response.isSuccessful) {
                val dto = response.body() ?: throw Exception("Failed to update note")
                val updated = dto.toDomain()
                fileLogger.log("NoteRepo", "updateNote success: id=${updated.id}")
                noteDao.insertNote(updated.toEntity().copy(baseUpdatedAt = dto.updatedAt))
                try { reminderScheduler.syncForNote(updated.id) } catch (_: Exception) {}
                Result.Success(updated)
            } else {
                val body = try { response.errorBody()?.string()?.take(500) } catch (_: Exception) { null }
                fileLogger.error("NoteRepo", "updateNote failed: code=${response.code()} body=$body")
                throw Exception(errorMessage("Updating note", response.code(), body))
            }
        } catch (e: Exception) {
            fileLogger.error("NoteRepo", "updateNote exception, saving locally", e)
            // Keep the base of the version we diverged from, so the sync can
            // detect the conflict (409) once connectivity is back.
            noteDao.insertNote(note.toEntity().copy(baseUpdatedAt = baseUpdatedAt))
            pendingOperationDao.insert(
                PendingOperationEntity(
                    operationType = OperationType.UPDATE,
                    noteId = note.id,
                    payloadJson = ""
                )
            )
            syncManager.onPendingOperationQueued()
            try { reminderScheduler.syncForNote(note.id) } catch (_: Exception) {}
            Result.Success(note)
        }
    }

    override suspend fun deleteNote(id: String): Result<Unit> {
        try { reminderScheduler.cancel(id) } catch (_: Exception) {}
        return try {
            val response = api.deleteNote(id)
            if (response.isSuccessful) {
                noteDao.deleteNoteById(id)
                Result.Success(Unit)
            } else {
                throw Exception(errorMessage("Deleting note", response.code()))
            }
        } catch (_: Exception) {
            noteDao.deleteNoteById(id)
            pendingOperationDao.insert(
                PendingOperationEntity(
                    operationType = OperationType.DELETE,
                    noteId = id,
                    payloadJson = ""
                )
            )
            syncManager.onPendingOperationQueued()
            Result.Success(Unit)
        }
    }

    override suspend fun getTrashedNotes(): Result<List<Note>> = Result.catching {
        val response = api.getTrashedNotes(limit = NOTES_PAGE_LIMIT)
        if (!response.isSuccessful) throw Exception(errorMessage("Loading trash", response.code()))
        val dtos = response.body()?.getNotesList() ?: emptyList()
        fileLogger.log("NoteRepo", "getTrashedNotes: ${dtos.size} notes")
        // Deliberately NOT cached: trashed notes never enter the offline
        // cache, so a restore/purge elsewhere can never desync Room.
        dtos.map { it.toDomain() }
    }

    override suspend fun restoreNote(id: String): Result<Note> = Result.catching {
        val response = api.restoreNote(id)
        if (!response.isSuccessful) throw Exception(errorMessage("Restoring note", response.code()))
        val dto = response.body() ?: throw Exception("Restore without response")
        val note = dto.toDomain()
        // Back among the living — the restored note re-enters the local cache
        // with the server's updatedAt as the optimistic-lock base.
        runCatching {
            noteDao.insertNote(note.toEntity().copy(baseUpdatedAt = dto.updatedAt))
            reminderScheduler.syncForNote(note.id)
        }
        note
    }

    override suspend fun purgeNote(id: String): Result<Unit> = Result.catching {
        val response = api.deleteNote(id, permanent = true)
        if (!response.isSuccessful) throw Exception(errorMessage("Deleting note permanently", response.code()))
        noteDao.deleteNoteById(id)
    }

    override suspend fun emptyTrash(): Result<Int> = Result.catching {
        val response = api.emptyTrash()
        if (!response.isSuccessful) throw Exception(errorMessage("Emptying trash", response.code()))
        val removed = response.body()?.removed ?: 0
        fileLogger.log("NoteRepo", "emptyTrash: removed=$removed")
        removed
    }

    override suspend fun applyTagOperation(action: String, from: List<String>, to: String?): Result<Int> {
        fileLogger.log("NoteRepo", "applyTagOperation: action=$action sources=${from.size} to=${to != null}")
        return try {
            val response = api.tagOperation(
                TagOperationRequestDto(action = action, from = from, to = to)
            )
            if (!response.isSuccessful) {
                val body = try { response.errorBody()?.string()?.take(300) } catch (_: Exception) { null }
                fileLogger.error("NoteRepo", "tagOperation failed: code=${response.code()} body=$body", null)
                Result.Error(errorMessage("Tag operation", response.code(), body))
            } else {
                val modified = response.body()?.modified ?: 0
                // Room-Spiegel: Die Tag-Übersicht liest aus dem Cache — ohne
                // Spiegel bliebe der alte Tag sichtbar bis zum nächsten getNotes.
                mirrorTagOperation(from, to)
                Result.Success(modified)
            }
        } catch (e: IOException) {
            // Offline: alter Einzel-Notiz-Pfad — updateNote schreibt Room und
            // queued die Offline-Operation, genau wie vor v1.14.0.
            fileLogger.log("NoteRepo", "tagOperation offline, per-note fallback")
            offlineTagRewrite(from, to)
        }
    }

    /** Best-effort mirror of a successful server tag operation into Room. */
    private suspend fun mirrorTagOperation(from: List<String>, to: String?) {
        runCatching {
            val sources = from.map { it.trim().lowercase() }.filter { it.isNotEmpty() }.toSet()
            if (sources.isEmpty()) return@runCatching
            // Server speichert das Ziel lowercased — Spiegel genauso.
            val target = to?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
            val cached = noteDao.getAllLiveNotesSync() + noteDao.getAllArchivedNotesSync()
            cached.forEach { entity ->
                val note = entity.entityToDomain()
                if (note.tags.any { tag -> tag.lowercase() in sources }) {
                    val newTags = (
                        note.tags.filterNot { tag -> tag.lowercase() in sources } +
                            listOfNotNull(target)
                        ).distinct()
                    noteDao.insertNote(note.copy(tags = newTags).toEntity())
                }
            }
        }.onFailure { fileLogger.error("NoteRepo", "tag mirror failed", it as? Exception) }
    }

    /** Legacy path for offline tag operations: one queued update per note. */
    private suspend fun offlineTagRewrite(from: List<String>, to: String?): Result<Int> {
        val sources = from.map { it.trim() }.filter { it.isNotEmpty() }
        val target = to?.trim()?.takeIf { it.isNotEmpty() }
        var updated = 0
        val cached = noteDao.getAllLiveNotesSync() + noteDao.getAllArchivedNotesSync()
        for (entity in cached) {
            val note = entity.entityToDomain()
            if (note.tags.none { tag -> sources.any { it.equals(tag, ignoreCase = true) } }) continue
            val newTags = (
                note.tags.filterNot { tag -> sources.any { it.equals(tag, ignoreCase = true) } } +
                    listOfNotNull(target)
                ).distinct()
            if (newTags == note.tags) continue
            val result = updateNote(note.copy(tags = newTags))
            if (result is Result.Success) updated++
        }
        return Result.Success(updated)
    }

    override suspend fun togglePin(id: String): Result<Note> {
        return try {
            val response = api.togglePin(id)
            if (response.isSuccessful) {
                val dto = response.body() ?: throw Exception("Failed to toggle pin")
                val note = dto.toDomain()
                noteDao.insertNote(note.toEntity().copy(baseUpdatedAt = dto.updatedAt))
                Result.Success(note)
            } else {
                throw Exception(errorMessage("Pinning note", response.code()))
            }
        } catch (e: Exception) {
            val cached = noteDao.getNoteById(id)
            if (cached != null) {
                val toggled = cached.copy(isPinned = !cached.isPinned)
                noteDao.insertNote(toggled)
                pendingOperationDao.insert(
                    PendingOperationEntity(
                        operationType = OperationType.TOGGLE_PIN,
                        noteId = id,
                        payloadJson = ""
                    )
                )
                syncManager.onPendingOperationQueued()
                Result.Success(toggled.entityToDomain())
            } else {
                Result.Error(exceptionMessage(e))
            }
        }
    }

    override suspend fun toggleArchive(id: String): Result<Note> {
        return try {
            val response = api.toggleArchive(id)
            if (response.isSuccessful) {
                val dto = response.body() ?: throw Exception("Failed to toggle archive")
                val note = dto.toDomain()
                noteDao.insertNote(note.toEntity().copy(baseUpdatedAt = dto.updatedAt))
                Result.Success(note)
            } else {
                throw Exception(errorMessage("Archiving note", response.code()))
            }
        } catch (e: Exception) {
            val cached = noteDao.getNoteById(id)
            if (cached != null) {
                val toggled = cached.copy(isArchived = !cached.isArchived)
                noteDao.insertNote(toggled)
                pendingOperationDao.insert(
                    PendingOperationEntity(
                        operationType = OperationType.TOGGLE_ARCHIVE,
                        noteId = id,
                        payloadJson = ""
                    )
                )
                syncManager.onPendingOperationQueued()
                Result.Success(toggled.entityToDomain())
            } else {
                Result.Error(exceptionMessage(e))
            }
        }
    }

    override suspend fun shareNote(noteId: String, userId: String): Result<Unit> = Result.catching {
        val response = api.shareNote(noteId, ShareNoteDto(userId))
        if (!response.isSuccessful) throw Exception(errorMessage("Sharing note", response.code()))
    }

    override suspend fun reorderNotes(orderedIds: List<String>): Result<Unit> {
        // Local positions first — the UI is correct immediately, offline included.
        orderedIds.forEachIndexed { index, id -> noteDao.updatePosition(id, index) }
        return try {
            pushReorderToServer(orderedIds)
            fileLogger.log("NoteRepo", "reorderNotes: pushed ${orderedIds.size} ids")
            Result.Success(Unit)
        } catch (e: Exception) {
            fileLogger.error("NoteRepo", "reorderNotes failed, queuing offline", e)
            // One open REORDER op at most: the replay reads the freshest
            // order from Room anyway, so older snapshots are obsolete.
            pendingOperationDao.deleteByType(OperationType.REORDER)
            pendingOperationDao.insert(
                PendingOperationEntity(
                    operationType = OperationType.REORDER,
                    noteId = OperationType.REORDER_SENTINEL_NOTE_ID,
                    payloadJson = ""
                )
            )
            syncManager.onPendingOperationQueued()
            Result.Success(Unit)
        }
    }

    /** Offline ids must not reach the validator; lists beyond 200 ids are chunked. */
    private suspend fun pushReorderToServer(orderedIds: List<String>) {
        val serverIds = orderedIds.filter { ServerContract.isServerId(it) }
        if (serverIds.isEmpty()) return
        serverIds.chunked(ServerContract.MAX_REORDER_IDS).forEach { chunk ->
            val response = api.reorderNotes(ReorderNotesDto(chunk))
            if (!response.isSuccessful) {
                throw Exception(errorMessage("Reordering notes", response.code()))
            }
        }
    }

    override suspend fun undoDelete(note: Note): Result<Unit> {
        return try {
            val queued = pendingOperationDao.getCountForNoteAndType(note.id, OperationType.DELETE) > 0
            if (queued) {
                // The DELETE never left the device: cancel it and put the
                // cached row back — to the server nothing ever happened.
                pendingOperationDao.deleteByNoteAndType(note.id, OperationType.DELETE)
                noteDao.insertNote(note.toEntity())
                fileLogger.log("NoteRepo", "undoDelete: cancelled queued DELETE id=${note.id}")
            } else {
                // Already in the server's 30-day trash: restore endpoint.
                val response = api.restoreNote(note.id)
                if (response.isSuccessful) {
                    val dto = response.body()
                    noteDao.insertNote(
                        (dto?.toDomain() ?: note).toEntity().copy(baseUpdatedAt = dto?.updatedAt)
                    )
                    fileLogger.log("NoteRepo", "undoDelete: restored from trash id=${note.id}")
                } else {
                    // Purged or otherwise unreachable — still restore the
                    // cache; the next list refresh reconciles.
                    noteDao.insertNote(note.toEntity())
                    fileLogger.log("NoteRepo", "undoDelete: restore HTTP ${response.code()}, re-cached")
                }
            }
            syncManager.onPendingOperationQueued()
            // The delete cancelled this note's alarm — bring it back if the
            // restored note still carries a future reminder.
            try { reminderScheduler.syncForNote(note.id) } catch (_: Exception) {}
            Result.Success(Unit)
        } catch (e: Exception) {
            fileLogger.error("NoteRepo", "undoDelete failed", e)
            Result.Error(exceptionMessage(e))
        }
    }

    override suspend fun getPinnedNotes(maxCount: Int): Result<List<Note>> = Result.catching {
        noteDao.getPinnedNotes(maxCount).map { it.entityToDomain() }
    }

    override suspend fun getUpcomingReminders(): Result<List<Note>> = Result.catching {
        noteDao.getNotesWithUpcomingReminders(System.currentTimeMillis())
            .map { it.entityToDomain() }
            .sortedBy { it.remindAt }
    }

    override suspend fun unshareNote(noteId: String, userId: String): Result<Unit> = Result.catching {
        val response = api.unshareNote(noteId, userId)
        if (!response.isSuccessful) throw Exception(errorMessage("Unsharing note", response.code()))
    }

    override suspend fun getLinkPreview(url: String): Result<LinkPreview> {
        return try {
            val response = api.getLinkPreview(LinkPreviewRequestDto(url))
            if (response.isSuccessful) {
                val preview = response.body()?.toDomain() ?: throw Exception("No preview data")
                Result.Success(preview)
            } else {
                Result.Error(errorMessage("Loading link preview", response.code()))
            }
        } catch (e: Exception) {
            Result.Error(exceptionMessage(e))
        }
    }

    /**
     * Folgeseiten einer Notizliste (v1.13.0 Nr. 1). Seite 1 hat der Aufrufer
     * schon; hier laufen Seite 2..N mit, bis der Server das Ende meldet. Ein
     * Fehler auf einer Folgeseite bricht ab und behält, was schon da ist —
     * ein Teilbestand ist besser als eine leere Liste —, Seite 1 kann gar
     * nicht scheitern, weil der Aufrufer sie bereits geprüft hat.
     */
    private suspend fun fetchRemainingNotePages(
        archived: Boolean,
        firstBodyPages: Int?,
        firstPageSize: Int
    ): List<NoteDto> {
        val maxPages = 100 // hartes Limit, selbst wenn der Server spinnt
        var totalPages = firstBodyPages
            ?: if (firstPageSize < NOTES_PAGE_LIMIT) 1 else 2 // Feld fehlt: an Seitenende erkennen
        val collected = mutableListOf<NoteDto>()
        var page = 2
        while (page <= maxPages && page <= totalPages) {
            val response = try {
                api.getNotes(archived = archived, deleted = false, page = page, limit = NOTES_PAGE_LIMIT)
            } catch (e: Exception) {
                fileLogger.error("NoteRepo", "getNotes page $page failed", e)
                break
            }
            if (!response.isSuccessful) {
                fileLogger.error("NoteRepo", "getNotes page $page failed: code=${response.code()}")
                break
            }
            val dtos = response.body()?.getNotesList() ?: break
            collected += dtos
            if (dtos.size < NOTES_PAGE_LIMIT) break
            // Fehlt das pages-Feld, verhindert die Vollseiten-Heuristik ein
            // zu frühes Ende: eine volle Seite vermutet immer noch eine weitere.
            totalPages = response.body()?.pages ?: (page + 1)
            page++
        }
        if (collected.isNotEmpty()) {
            fileLogger.log("NoteRepo", "getNotes: +${collected.size} notes from follow-up pages")
        }
        return collected
    }

    override suspend fun getAllNotesForExport(): Result<List<Note>> {
        // awaitRunningDrain wie im Markdown-Export (v1.17.1): auch dieses
        // Backup verspricht, offline Edits VOR dem Abruf gepusht zu haben.
        try { syncManager.syncPendingOperations(awaitRunningDrain = true) } catch (e: CancellationException) { throw e } catch (_: Exception) {}
        return try {
            // Two sweeps: the server splits live notes by archive state, and
            // trashed notes are deliberately excluded (they expire after 30
            // days, so a backup must not promise to restore them).
            val collected = mutableListOf<Note>()
            for (archived in listOf(false, true)) {
                val maxPages = 100 // hard stop even if the server misbehaves
                var page = 1
                while (page <= maxPages) {
                    val response = api.getNotes(
                        archived = archived,
                        deleted = false,
                        page = page,
                        limit = NOTES_PAGE_LIMIT
                    )
                    if (!response.isSuccessful) {
                        throw Exception(errorMessage("Export", response.code()))
                    }
                    val body = response.body() ?: break
                    val dtos = body.getNotesList()
                    collected += dtos.map { it.toDomain() }
                    val totalPages = body.pages
                        ?: if (dtos.size < NOTES_PAGE_LIMIT) page else page + 1
                    if (page >= totalPages) break
                    page++
                }
            }
            fileLogger.log("NoteRepo", "export: ${collected.size} notes from server")
            Result.Success(collected)
        } catch (e: Exception) {
            fileLogger.error("NoteRepo", "export failed, serving cache", e)
            // A backup taken offline is better than none — the Room cache
            // holds everything that was ever synced to this device.
            try {
                val cached = noteDao.getAllNotes().first() + noteDao.getArchivedNotes().first()
                if (cached.isNotEmpty()) {
                    fileLogger.log("NoteRepo", "export: ${cached.size} notes from cache")
                    Result.Success(cached.map { it.entityToDomain() })
                } else {
                    Result.Error(exceptionMessage(e))
                }
            } catch (_: Exception) {
                Result.Error(exceptionMessage(e))
            }
        }
    }

    override suspend fun importNotes(notes: List<NoteImportParser.ParsedNote>): Result<Int> = Result.catching {
        if (notes.isEmpty()) throw Exception("Nothing to import")
        val now = Instant.now()
        var created = 0
        var lastError: Exception? = null
        for (parsed in notes) {
            val draft = Note(
                id = "",
                title = parsed.title,
                content = parsed.content,
                color = NoteColor.fromHex(parsed.colorHex),
                isPinned = parsed.isPinned,
                isArchived = false, // created live; archived right after
                isTodoList = parsed.isTodoList,
                todoItems = parsed.todoItems,
                tags = parsed.tags,
                sharedWith = emptyList(), // sharing is account-bound, never copied
                images = emptyList(), // files live on the server; a copy has none
                owner = "",
                position = 0,
                createdAt = now,
                updatedAt = now,
                remindAt = parsed.remindAt
            )
            when (val result = createNote(draft)) {
                is Result.Success -> {
                    created++
                    if (parsed.isArchived) {
                        runCatching { toggleArchive(result.data.id) }
                    }
                }
                is Result.Error -> lastError = Exception(result.message)
            }
        }
        if (created == 0) {
            throw lastError ?: Exception("Import failed")
        }
        fileLogger.log("NoteRepo", "importNotes: created $created/${notes.size} notes")
        created
    }

    override suspend fun duplicateNote(noteId: String, copyLabel: String): Result<Note> = Result.catching {
        val original = when (val cached = getNote(noteId)) {
            is Result.Success -> cached.data
            is Result.Error -> throw Exception(cached.message)
        }
        val now = Instant.now()
        val copy = original.copy(
            id = "",
            title = NoteShareFormatter.duplicateTitle(original.title, copyLabel),
            isPinned = false, // a duplicate starts un-pinned
            sharedWith = emptyList(),
            images = emptyList(), // attachments cannot be cloned through the API
            createdAt = now,
            updatedAt = now,
            baseUpdatedAt = null // a new note has no lock base
        )
        when (val result = createNote(copy)) {
            is Result.Success -> result.data
            is Result.Error -> throw Exception(result.message)
        }
    }

    // --- Tree, wiki links, journal (v1.10.0) ---

    override suspend fun getNoteTree(): Result<List<NoteTreeNode>> = Result.catching {
        val all = noteDao.getAllLiveNotesSync().map { it.entityToDomain() }
        val byParent = all.groupBy { it.parentId }
        val liveIds = all.map { it.id }.toSet()
        // Roots: no parent, or a parent that is not part of the live cache
        // (archived or already deleted elsewhere) — those orphans surface at
        // the top instead of disappearing with their folder.
        fun build(note: Note, depth: Int, seen: Set<String>): NoteTreeNode =
            NoteTreeNode(
                note = note,
                depth = depth,
                children = if (note.id in seen) {
                    emptyList() // corrupt state guard — never recurse into a cycle
                } else {
                    (byParent[note.id] ?: emptyList())
                        .sortedWith(compareByDescending<Note> { it.isPinned }.thenBy { it.title.lowercase() })
                        .map { build(it, depth + 1, seen + note.id) }
                }
            )
        all
            .filter { it.parentId == null || it.parentId !in liveIds }
            .sortedWith(compareByDescending<Note> { it.isPinned }.thenBy { it.title.lowercase() })
            .map { build(it, 0, emptySet()) }
    }

    override suspend fun moveNote(id: String, parentId: String?): Result<Note> = Result.catching {
        if (parentId == id) {
            throw Exception("Eine Notiz kann nicht in sich selbst verschoben werden")
        }
        if (parentId != null && parentId in getSubtreeIds(id)) {
            throw Exception("Ein Ordner kann nicht in einen seiner Unterordner verschoben werden")
        }
        val current = when (val cached = getNote(id)) {
            is Result.Success -> cached.data
            is Result.Error -> throw Exception(cached.message)
        }
        if (current.parentId == parentId) return@catching current
        when (val moved = updateNote(current.copy(parentId = parentId))) {
            is Result.Success -> moved.data
            is Result.Error -> throw Exception(moved.message)
        }
    }

    override suspend fun getSubtreeIds(id: String): List<String> {
        val collected = mutableListOf<String>()
        val queue = ArrayDeque<String>()
        queue += id
        while (queue.isNotEmpty()) {
            val current = queue.removeFirst()
            if (current in collected) continue // corrupt state guard
            collected += current
            queue += noteDao.getDirectChildIds(current)
        }
        return collected
    }

    override suspend fun findByExactTitle(title: String): Result<List<Note>> = Result.catching {
        noteDao.findByExactTitle(title.trim()).map { it.entityToDomain() }
    }

    override suspend fun getBacklinks(title: String, excludeId: String): Result<List<Note>> = Result.catching {
        val trimmed = title.trim()
        if (trimmed.isEmpty()) return@catching emptyList()
        // Escape LIKE's own wildcards so a title containing % or _ matches
        // literally; the query declares ESCAPE '\'.
        val escaped = trimmed.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        noteDao.findBacklinks(excludeId, "%[[$escaped]]%").map { it.entityToDomain() }
    }

    override suspend fun findOrCreateTodayNote(): Result<Note> = Result.catching {
        val journalFolderId = settingsDataStore.journalFolderId.first()
        val today = LocalDate.now().toString() // ISO: "2026-09-19"
        // Dedupe happens against the Room cache; a same-day note created on
        // another device only becomes visible here after the next sync — the
        // first of the day should be written on the device that opens it.
        val existing = noteDao.findByExactTitle(today)
            .firstOrNull { it.parentId == journalFolderId && !it.isArchived }
        if (existing != null) return@catching existing.entityToDomain()
        val now = Instant.now()
        val draft = Note(
            id = "",
            title = today,
            content = "# $today\n\n",
            color = NoteColor.DEFAULT,
            isPinned = false,
            isArchived = false,
            isTodoList = false,
            todoItems = emptyList(),
            tags = listOf("Journal"),
            sharedWith = emptyList(),
            images = emptyList(),
            owner = "",
            position = 0,
            createdAt = now,
            updatedAt = now,
            parentId = journalFolderId
        )
        when (val created = createNote(draft)) {
            is Result.Success -> created.data
            is Result.Error -> throw Exception(created.message)
        }
    }

    override suspend fun exportMarkdownTo(output: OutputStream): Result<Long> = Result.catching {
        // Push offline edits first so the ZIP contains them. awaitRunningDrain
        // (v1.17.1, Review): Ops, die NACH dem Snapshot eines laufenden Drains
        // enqueued wurden, otherwise bleiben liegen — das ZIP wäre stille
        // Alte Daten, obwohl der Aufruf Erfolg meldet.
        try { syncManager.syncPendingOperations(awaitRunningDrain = true) } catch (e: CancellationException) { throw e } catch (_: Exception) {}
        withContext(Dispatchers.IO) {
            val response = api.exportMarkdown()
            if (!response.isSuccessful) {
                val body = try { response.errorBody()?.string()?.take(200) } catch (_: Exception) { null }
                throw Exception(errorMessage("Markdown-Export", response.code(), body))
            }
            val responseBody = response.body() ?: throw Exception("Export ohne Daten")
            var copied = 0L
            responseBody.byteStream().use { input ->
                val buffer = ByteArray(64 * 1024)
                while (true) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    output.write(buffer, 0, read)
                    copied += read
                }
            }
            output.flush()
            fileLogger.log("NoteRepo", "exportMarkdownTo: $copied bytes")
            copied
        }
    }

    override suspend fun importMarkdownFiles(files: List<MarkdownNoteParser.FileEntry>): Result<Int> = Result.catching {
        val parsed = when (val result = MarkdownNoteParser.parse(files)) {
            is MarkdownNoteParser.Result.Success -> result.import
            is MarkdownNoteParser.Result.Invalid -> throw Exception(result.reason)
        }
        // v1.16.0: Online geht der Import als Bulk-Chunks an
        // /api/notes/import/markdown (500 Dateien pro Request, dasselbe
        // Wire-Format wie der Web-Client) — vorher war es eine createNote-
        // Sequenz pro Datei mit halbem Import bei Abbruch mitten drin.
        var created = 0
        try {
            for (chunk in buildMarkdownImportItems(parsed).chunked(IMPORT_CHUNK_SIZE)) {
                val response = api.importMarkdown(ImportMarkdownRequestDto(chunk))
                if (!response.isSuccessful) {
                    val body = try { response.errorBody()?.string()?.take(500) } catch (_: Exception) { null }
                    throw Exception(errorMessage("Import", response.code(), body))
                }
                created += response.body()?.created ?: 0
            }
            // Frische Server-Notizen sofort in den Room-Cache ziehen (best
            // effort — das nächste Pull-Fenster holte sie sonst erst später).
            try { syncManager.pullRemoteChanges() } catch (e: CancellationException) { throw e } catch (_: Exception) {}
            fileLogger.log("NoteRepo", "importMarkdownFiles: bulk import created $created notes")
            created
        } catch (e: IOException) {
            // Offline-Fallback NUR solange nichts am Server gelandet ist: Der
            // Offline-Pfad legt JEDE Datei als Entwurf an — nach einem
            // Teilerfolg (Chunk 1 ok, Chunk 2 offline) hätte alles doppelt.
            // Dann lieber ehrlich scheitern: Die Fehlermeldung verrät den
            // Teilerfolg, ein Retry dupliziert höchstens den Rest-Chunk.
            if (created > 0) {
                fileLogger.error("NoteRepo", "importMarkdownFiles: partial bulk import ($created), surfacing error", e)
                throw Exception("Teilimport: $created Notizen angelegt, Rest fehlgeschlagen (${e.javaClass.simpleName}) — bitte erneut versuchen")
            }
            fileLogger.log("NoteRepo", "importMarkdownFiles: offline (${e.javaClass.simpleName}), queueing drafts")
            importOfflineDrafts(parsed)
        }
    }

    /** Offline-Pfad des Markdown-Imports: Ordner zuerst (Parser liefert Eltern
     *  vor Kindern, jede Ordner-Notiz trägt ihren _index.md-Körper), dann die
     *  Dateien — klettert eine Notiz zum nächsten existierenden Vorfahren,
     *  statt verloren zu gehen. */
    private suspend fun importOfflineDrafts(parsed: MarkdownNoteParser.ParsedImport): Int {
        val now = Instant.now()
        val pathToId = mutableMapOf<String, String>()
        var created = 0
        var lastError: Exception? = null
        suspend fun createDraft(
            title: String,
            content: String,
            tags: List<String>,
            isTodoList: Boolean,
            todoItems: List<TodoItem>,
            parentId: String?
        ): Note? {
            val draft = Note(
                id = "",
                title = title,
                content = content,
                color = NoteColor.DEFAULT,
                isPinned = false,
                isArchived = false,
                isTodoList = isTodoList,
                todoItems = todoItems,
                tags = tags,
                sharedWith = emptyList(), // sharing is account-bound, never copied
                images = emptyList(), // .md import is text-only by design
                owner = "",
                position = 0,
                createdAt = now,
                updatedAt = now,
                parentId = parentId
            )
            return when (val result = createNote(draft)) {
                is Result.Success -> result.data
                is Result.Error -> {
                    lastError = Exception(result.message)
                    null
                }
            }
        }

        for (dir in parsed.dirs) {
            val note = createDraft(
                title = dir.title,
                content = dir.indexContent ?: "# ${dir.title}",
                tags = emptyList(),
                isTodoList = false,
                todoItems = emptyList(),
                parentId = dir.parentPath?.let { pathToId[it] }
            ) ?: continue
            pathToId[dir.dirPath] = note.id
            created++
        }
        for (file in parsed.files) {
            val parentId = generateSequence(file.parentPath) { anchor ->
                MarkdownNoteParser.parentOf(anchor)?.ifEmpty { null }
            }.mapNotNull { anchor -> pathToId[anchor] }.firstOrNull()
            val note = createDraft(
                title = file.title,
                content = file.content,
                tags = file.tags,
                isTodoList = file.isTodoList,
                todoItems = file.todoItems,
                parentId = parentId
            ) ?: continue
            created++
        }
        if (created == 0) {
            throw lastError ?: Exception("Import fehlgeschlagen")
        }
        fileLogger.log("NoteRepo", "importOfflineDrafts: queued $created drafts")
        return created
    }

    /** Note ids with a queued UPDATE/CREATE (v1.18.0): their Room row is
     *  newer than anything the server can answer with, so server rows must
     *  neither shadow them in a result list nor overwrite them in the cache.
     *  DELETE keeps the old behaviour — a deleted note simply stays gone. */
    private suspend fun dirtyNoteIds(): Set<String> =
        pendingOperationDao.getAllOperations()
            .filter { it.operationType == OperationType.UPDATE || it.operationType == OperationType.CREATE }
            .map { it.noteId }
            .toSet()

    /** In-memory ordering for server-delivered lists (search/tag results);
     *  MANUAL is not mapped — the server ranking wins. */
    private fun sortInMemory(notes: List<Note>, sortMode: SortMode): List<Note> = when (sortMode) {
        SortMode.UPDATED -> notes.sortedWith(
            compareByDescending<Note> { it.isPinned }.thenByDescending { it.updatedAt }
        )
        SortMode.CREATED -> notes.sortedWith(
            compareByDescending<Note> { it.isPinned }.thenByDescending { it.createdAt }
        )
        SortMode.TITLE -> notes.sortedWith(
            compareByDescending<Note> { it.isPinned }.thenBy { it.title.lowercase() }
        )
        SortMode.MANUAL -> notes
    }

    private fun window(notes: List<Note>, limit: Int?): List<Note> =
        limit?.takeIf { it > 0 }?.let { notes.take(it) } ?: notes

    /** Surfaces the API's own validation text ("msg"/"error") instead of a raw status code. */
    private fun serverMessage(body: String?): String? {
        if (body.isNullOrBlank()) return null
        val msg = Regex("\"msg\"\\s*:\\s*\"([^\"]+)\"").find(body)?.groupValues?.getOrNull(1)
        if (msg != null) return msg
        return Regex("\"error\"\\s*:\\s*\"([^\"]+)\"").find(body)?.groupValues?.getOrNull(1)
    }

    private fun errorMessage(action: String, code: Int, body: String? = null): String =
        serverMessage(body) ?: "$action failed (HTTP $code)"

    private fun exceptionMessage(e: Exception): String =
        if (e.message.isNullOrBlank()) {
            "Network error (${e.javaClass.simpleName})"
        } else {
            "${e.javaClass.simpleName}: ${e.message}"
        }
}
