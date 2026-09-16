package com.keeplocal.android.data.local

import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.api.dto.NoteDto
import com.keeplocal.android.data.api.dto.ReorderNotesDto
import com.keeplocal.android.data.api.dto.toCreateDto
import com.keeplocal.android.data.api.dto.toDomain
import com.keeplocal.android.data.api.dto.toUpdateDto
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.dao.PendingOperationDao
import com.keeplocal.android.data.local.entity.NoteEntity
import com.keeplocal.android.data.local.entity.OperationType
import com.keeplocal.android.data.local.entity.PendingOperationEntity
import com.keeplocal.android.data.local.entity.toDomain as entityToDomain
import com.keeplocal.android.data.local.entity.toEntity
import com.keeplocal.android.util.ServerContract
import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import okhttp3.ResponseBody
import retrofit2.Response
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/** Snapshot of the offline queue, collected by the notes UI for its sync banner. */
data class SyncStatus(
    val isSyncing: Boolean = false,
    val pendingCount: Int = 0,
    val failedCount: Int = 0,
    val skippedCount: Int = 0,
    val authRequired: Boolean = false,
    val conflicts: List<String> = emptyList()
)

@Singleton
class SyncManager @Inject constructor(
    private val api: KeepLocalApi,
    private val noteDao: NoteDao,
    private val pendingOperationDao: PendingOperationDao
) {
    private val _syncStatus = MutableStateFlow(SyncStatus())
    val syncStatus: StateFlow<SyncStatus> = _syncStatus.asStateFlow()

    /** Fired once per sync run that bounced off an expired session (401). */
    private val _authRequired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val authRequired: SharedFlow<Unit> = _authRequired.asSharedFlow()

    /** Called by the repository whenever it queues another offline operation. */
    suspend fun onPendingOperationQueued() {
        _syncStatus.value = _syncStatus.value.copy(pendingCount = pendingOperationDao.getCount())
    }

    suspend fun syncPendingOperations(): SyncResult = withContext(Dispatchers.IO) {
        val operations = pendingOperationDao.getAllOperations()
        if (operations.isEmpty()) {
            _syncStatus.value = SyncStatus()
            return@withContext SyncResult(0, 0)
        }

        _syncStatus.value = _syncStatus.value.copy(isSyncing = true)

        var synced = 0
        var failed = 0
        var skipped = 0
        var authRequired = false
        val conflicts = mutableListOf<String>()
        // A successful CREATE replaces the temporary offline id with the server
        // id; later operations of the same note still carry the stale offline
        // id inside this snapshot and are resolved through this map.
        val idRewrites = mutableMapOf<String, String>()

        for (op in operations) {
            if (authRequired) break // every further call would bounce off the expired session
            val noteId = idRewrites[op.noteId] ?: op.noteId
            try {
                when (syncOne(op, noteId, idRewrites, conflicts)) {
                    OpOutcome.SYNCED -> {
                        // syncOne only deletes ops it drops (skip cases); a
                        // completed op leaves the queue here. For CREATE this
                        // runs after reassignNoteId, and delete() matches by
                        // primary key, so the rewritten noteId is irrelevant.
                        pendingOperationDao.delete(op)
                        synced++
                    }
                    OpOutcome.SKIPPED -> skipped++
                    OpOutcome.FAILED -> failed++
                    OpOutcome.AUTH_REQUIRED -> {
                        authRequired = true
                        failed++
                    }
                }
            } catch (_: Exception) {
                failed++
            }
        }

        val result = SyncResult(
            synced = synced,
            failed = failed,
            skipped = skipped,
            authRequired = authRequired,
            conflicts = conflicts
        )
        _syncStatus.value = SyncStatus(
            pendingCount = pendingOperationDao.getCount(),
            failedCount = failed,
            skippedCount = skipped,
            authRequired = authRequired,
            conflicts = conflicts
        )
        if (authRequired) _authRequired.tryEmit(Unit)
        result
    }

    suspend fun hasPendingOperations(): Boolean = pendingOperationDao.getCount() > 0

    private enum class OpOutcome { SYNCED, FAILED, SKIPPED, AUTH_REQUIRED }

    private suspend fun syncOne(
        op: PendingOperationEntity,
        noteId: String,
        idRewrites: MutableMap<String, String>,
        conflicts: MutableList<String>
    ): OpOutcome {
        when (op.operationType) {
            OperationType.CREATE -> {
                val entity = noteDao.getNoteById(noteId)
                if (entity == null) {
                    // The note never made it into the local cache (or was
                    // deleted again offline): nothing to send, drop the op
                    // instead of retrying it forever.
                    pendingOperationDao.delete(op)
                    return OpOutcome.SKIPPED
                }
                val response = api.createNote(entity.entityToDomain().toCreateDto())
                if (response.code() == 401) return OpOutcome.AUTH_REQUIRED
                if (!response.isSuccessful) return OpOutcome.FAILED
                val dto = response.body() ?: return OpOutcome.SYNCED
                val serverId = dto.toDomain().id
                noteDao.deleteNoteById(noteId)
                insertServerNote(dto)
                // Re-point every still-queued operation of this note at the
                // server id, so the following UPDATE/TOGGLE ops hit the note
                // that was just created instead of 404-ing on the offline id.
                pendingOperationDao.reassignNoteId(noteId, serverId)
                idRewrites[op.noteId] = serverId
                return OpOutcome.SYNCED
            }

            OperationType.UPDATE -> {
                val entity = noteDao.getNoteById(noteId)
                if (entity == null) {
                    // Local row is gone (deleted offline meanwhile): drop the
                    // op, but pull the server version so the next list
                    // refresh shows it again instead of an empty cache.
                    pendingOperationDao.delete(op)
                    try {
                        val response = api.getNote(noteId)
                        if (response.code() == 401) return OpOutcome.AUTH_REQUIRED
                        if (response.isSuccessful) response.body()?.let { insertServerNote(it) }
                    } catch (_: Exception) {
                        // A network hiccup must not resurrect an op we dropped.
                    }
                    return OpOutcome.SKIPPED
                }
                val dto = entity.entityToDomain()
                    .toUpdateDto()
                    .copy(baseUpdatedAt = entity.baseUpdatedAt)
                val response = api.updateNote(noteId, dto)
                if (response.code() == 401) return OpOutcome.AUTH_REQUIRED
                return when {
                    response.isSuccessful -> {
                        response.body()?.let { insertServerNote(it) }
                        OpOutcome.SYNCED
                    }
                    response.code() == 409 -> resolveUpdateConflict(noteId, entity, response, conflicts)
                    else -> OpOutcome.FAILED
                }
            }

            OperationType.DELETE -> {
                val response = api.deleteNote(noteId)
                if (response.code() == 401) return OpOutcome.AUTH_REQUIRED
                // 404 = already gone server-side, which is what we wanted.
                return if (response.isSuccessful || response.code() == 404) OpOutcome.SYNCED else OpOutcome.FAILED
            }

            OperationType.REORDER -> {
                // Replays with the freshest order Room knows, so several
                // consecutive drags collapse into this one queued op.
                val orderedIds = noteDao.getActiveNoteIdsInDisplayOrder()
                    .filter { ServerContract.isServerId(it) }
                if (orderedIds.isEmpty()) {
                    pendingOperationDao.delete(op)
                    return OpOutcome.SKIPPED
                }
                for (chunk in orderedIds.chunked(ServerContract.MAX_REORDER_IDS)) {
                    val response = api.reorderNotes(ReorderNotesDto(chunk))
                    if (response.code() == 401) return OpOutcome.AUTH_REQUIRED
                    if (!response.isSuccessful) return OpOutcome.FAILED
                }
                return OpOutcome.SYNCED
            }

            OperationType.TOGGLE_PIN, OperationType.TOGGLE_ARCHIVE -> {
                val response = if (op.operationType == OperationType.TOGGLE_PIN) {
                    api.togglePin(noteId)
                } else {
                    api.toggleArchive(noteId)
                }
                if (response.code() == 401) return OpOutcome.AUTH_REQUIRED
                if (response.isSuccessful) {
                    response.body()?.let { insertServerNote(it) }
                    return OpOutcome.SYNCED
                }
                if (response.code() == 404) {
                    // The note no longer exists on the server. Dropping the op
                    // is only safe when its CREATE isn't still queued —
                    // otherwise this toggle has to wait for that CREATE.
                    val createPending = pendingOperationDao.getCountForNoteAndType(noteId, OperationType.CREATE) > 0
                    if (!createPending) {
                        pendingOperationDao.delete(op)
                        return OpOutcome.SKIPPED
                    }
                }
                return OpOutcome.FAILED
            }

            else -> {
                // Unknown operation type from a newer app version: drop it.
                pendingOperationDao.delete(op)
                return OpOutcome.SKIPPED
            }
        }
    }

    /**
     * 409 from an UPDATE: the note changed on the server since our base
     * version. Minimal resolution — the server version wins the id and the
     * local edits are preserved as a new note titled "(lokale Version …)".
     */
    private suspend fun resolveUpdateConflict(
        noteId: String,
        localEntity: NoteEntity,
        response: Response<NoteDto>,
        conflicts: MutableList<String>
    ): OpOutcome {
        var serverDto = parseConflictBody(response.errorBody())?.currentNote
        if (serverDto == null) {
            val fallback = try {
                api.getNote(noteId)
            } catch (_: Exception) {
                null
            }
            if (fallback?.code() == 401) return OpOutcome.AUTH_REQUIRED
            serverDto = fallback?.takeIf { it.isSuccessful }?.body()
        }
        if (serverDto == null) return OpOutcome.FAILED

        val copyTitle = conflictCopyTitle(localEntity.title)
        val copy = try {
            api.createNote(
                localEntity.entityToDomain().copy(title = copyTitle).toCreateDto()
            )
        } catch (_: Exception) {
            null
        }
        if (copy == null || !copy.isSuccessful) return OpOutcome.FAILED

        // The server now holds the copy under its own id; mirror it locally so
        // the user sees both versions immediately, offline included. The local
        // row keeps its own content — only id, marker title and the fresh
        // base come from the server response.
        copy.body()?.let { body ->
            noteDao.insertNote(
                localEntity.copy(
                    id = body.toDomain().id,
                    title = copyTitle,
                    baseUpdatedAt = body.updatedAt
                )
            )
        }
        insertServerNote(serverDto)
        conflicts += localEntity.title.ifBlank { serverDto.title }
        return OpOutcome.SYNCED
    }

    /** Server rows always land locally with their own updatedAt as the new base. */
    private suspend fun insertServerNote(dto: NoteDto) {
        noteDao.insertNote(dto.toDomain().toEntity().copy(baseUpdatedAt = dto.updatedAt))
    }

    private fun parseConflictBody(errorBody: ResponseBody?): ConflictBodyDto? {
        if (errorBody == null) return null
        return try {
            conflictAdapter.fromJson(errorBody.string())
        } catch (_: Exception) {
            null
        }
    }

    private val conflictAdapter by lazy {
        Moshi.Builder().add(KotlinJsonAdapterFactory()).build().adapter(ConflictBodyDto::class.java)
    }

    private fun conflictCopyTitle(original: String): String {
        // TODO-STR: data layer has no resource access, so the copy title is
        // hardcoded German (flagged in the report for a follow-up resource).
        val timestamp = DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT, FormatStyle.SHORT)
            .withLocale(Locale.getDefault())
            .format(ZonedDateTime.now())
        return "${original.ifBlank { "Notiz" }} (lokale Version $timestamp)"
    }
}

data class SyncResult(
    val synced: Int,
    val failed: Int,
    val skipped: Int = 0,
    val authRequired: Boolean = false,
    val conflicts: List<String> = emptyList()
)

/** Body of the server's 409 answer: {error, currentNote} (see UpdateNoteDto contract). */
internal data class ConflictBodyDto(
    val error: String? = null,
    val currentNote: NoteDto? = null
)
