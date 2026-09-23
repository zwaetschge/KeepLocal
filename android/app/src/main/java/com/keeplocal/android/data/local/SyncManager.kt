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
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import java.io.IOException
import okhttp3.ResponseBody
import retrofit2.Response
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import javax.inject.Inject
import javax.inject.Singleton

/** Page size for the background delta pull — matches the server-side list limit. */
private const val PULL_PAGE_LIMIT = 100

/**
 * Poison cap (v1.16.0): a queued op the server keeps rejecting gets at most
 * this many drains before it is poisoned (kept in the table, never replayed).
 * Counted are server-side failures only — network hiccups and 401s are free,
 * otherwise one elevator ride offline would bury the whole queue.
 */
const val MAX_SYNC_ATTEMPTS = 8

/** Snapshot of the offline queue, collected by the notes UI for its sync banner. */
data class SyncStatus(
    val isSyncing: Boolean = false,
    val pendingCount: Int = 0,
    val failedCount: Int = 0,
    val skippedCount: Int = 0,
    val poisonedCount: Int = 0,
    val authRequired: Boolean = false,
    val conflicts: List<String> = emptyList()
)

@Singleton
class SyncManager @Inject constructor(
    private val api: KeepLocalApi,
    private val noteDao: NoteDao,
    private val pendingOperationDao: PendingOperationDao,
    private val settingsDataStore: SettingsDataStore
) {
    private val _syncStatus = MutableStateFlow(SyncStatus())
    val syncStatus: StateFlow<SyncStatus> = _syncStatus.asStateFlow()

    /** Fired once per sync run that bounced off an expired session (401). */
    private val _authRequired = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val authRequired: SharedFlow<Unit> = _authRequired.asSharedFlow()

    /**
     * Single-Flight für den Drain (v1.17.0): SyncWorker (15-min-Takt),
     * Repository (getNotes/Export/Import) und UI (retrySync) können alle
     * gleichzeitig einen Drain anstoßen — zwei parallele Drains spielten
     * dieselbe Op-Liste zweimal ab (Doppel-TOGGLE, Rennen um die id-Rewrites).
     * Der unterlegene Aufruf kehrt sofort mit Null zurück — ABER: Das deckt
     * nur Ops ab, die schon im Snapshot des laufenden Drains stecken. Ops,
     * die NACH dessen Snapshot enqueued wurden, sieht der laufende Drain nie
     * (v1.17.1, Review). Wer die Garantie braucht, dass SEINE Ops gepusht
     * sind, ruft mit [awaitRunningDrain] auf und stellt sich hinter die Mutex.
     */
    private val drainMutex = Mutex()

    /** Called by the repository whenever it queues another offline operation. */
    suspend fun onPendingOperationQueued() {
        _syncStatus.value = _syncStatus.value.copy(pendingCount = pendingOperationDao.getCount())
    }

    /**
     * Drained die Offline-Queue (Single-Flight, siehe [drainMutex]).
     *
     * @param awaitRunningDrain true = läuft bereits ein Drain, STELLE uns
     *   dahinter und draine danach selbst (Export-Pfade: „offline Edits
     *   zuerst pushen“ muss auch für Ops gelten, die nach dem Snapshot des
     *   laufenden Drains enqueued wurden). false (Default) = sofortiges
     *   Nullergebnis — richtig für Worker/UI, die kein Ergebnis brauchen.
     */
    suspend fun syncPendingOperations(awaitRunningDrain: Boolean = false): SyncResult = withContext(Dispatchers.IO) {
        // Single-Flight (v1.17.0): siehe drainMutex. tryLock statt withLock —
        // der unterlegene Aufruf soll nicht anstehen (der laufende Drain
        // erledigt seine Ops ohnehin), sondern sofort ein Nullergebnis
        // zurückmelden. Ausnahme: awaitRunningDrain (Export) — der darf
        // nicht ohne seine eigenen Ops weiterlaufen.
        if (!drainMutex.tryLock()) {
            if (!awaitRunningDrain) return@withContext SyncResult(0, 0)
            drainMutex.lock()
        }
        try {
            return@withContext drainQueue()
        } finally {
            drainMutex.unlock()
        }
    }

    private suspend fun drainQueue(): SyncResult {
        // v1.16.0: poisoned ops never replay — a permanently rejected op
        // (validation, deleted shared note, …) used to retry every drain
        // forever. They stay in the table for the sync-queue view.
        val operations = pendingOperationDao.getActiveOperations()
        if (operations.isEmpty()) {
            _syncStatus.value = SyncStatus(pendingCount = pendingOperationDao.getCount(), poisonedCount = pendingOperationDao.getPoisonedCount())
            return SyncResult(0, 0, poisoned = pendingOperationDao.getPoisonedCount())
        }

        _syncStatus.value = _syncStatus.value.copy(isSyncing = true)

        try {
            var synced = 0
            var failed = 0
            var skipped = 0
            var poisoned = 0
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
                        OpOutcome.FAILED -> {
                            failed++
                            // Poison cap (v1.16.0): only server rejections count —
                            // this branch is unreachable for IOException (the catch
                            // below intercepts transport errors first).
                            pendingOperationDao.incrementAttempts(op.id)
                            if (op.attemptCount + 1 >= MAX_SYNC_ATTEMPTS) {
                                pendingOperationDao.markPoisoned(op.id)
                                poisoned++
                            }
                        }
                        OpOutcome.AUTH_REQUIRED -> {
                            authRequired = true
                            failed++
                        }
                    }
                } catch (e: IOException) {
                    // Netz weg mitten im Drain (v1.16.0): abbrechen statt durch die
                    // Rest-Queue zu hungern — jede weitere Op liefe bis zum
                    // Timeout. Kein failed-, kein Versuch-Zähler: der nächste
                    // Drain (wieder online) setzt unverändert fort.
                    break
                } catch (e: CancellationException) {
                    // Abbruch ist kein Fehler (v1.17.0): Der Worker wurde gestoppt
                    // oder der Scope geschlossen. Ohne Rethrow liefe die Loop als
                    // Zombie weiter — jede weitere Suspension wirft erneut, am
                    // Ende stünde die halbe Queue als failed mit Versuch-Zählern.
                    throw e
                } catch (e: Exception) {
                    // Unerwartete Fehler (Serialisierung, Storage-Defekt …) zählen
                    // genauso zum Gift-Cap wie Server-Ablehnungen — sonst lebt
                    // eine dauerhaft kaputte Op für immer in jedem Drain mit.
                    // IOException steht darüber und bricht ohne Zähler ab.
                    failed++
                    pendingOperationDao.incrementAttempts(op.id)
                    if (op.attemptCount + 1 >= MAX_SYNC_ATTEMPTS) {
                        pendingOperationDao.markPoisoned(op.id)
                        poisoned++
                    }
                }
            }

            val result = SyncResult(
                synced = synced,
                failed = failed,
                skipped = skipped,
                poisoned = poisoned,
                authRequired = authRequired,
                conflicts = conflicts
            )
            _syncStatus.value = SyncStatus(
                pendingCount = pendingOperationDao.getCount(),
                failedCount = failed,
                skippedCount = skipped,
                poisonedCount = pendingOperationDao.getPoisonedCount(),
                authRequired = authRequired,
                conflicts = conflicts
            )
            if (authRequired) _authRequired.tryEmit(Unit)
            return result
        } finally {
            // Auch bei Abbruch (v1.17.0): isSyncing darf nicht kleben bleiben —
            // sonst zeigt das Sync-Banner nach einem gestoppten Worker für
            // immer „läuft“.
            _syncStatus.value = _syncStatus.value.copy(isSyncing = false)
        }
    }

    suspend fun hasPendingOperations(): Boolean = pendingOperationDao.getCount() > 0

    /**
     * Pull half of the background sync (v1.14.0 Nr. 6): draining the offline
     * queue only ever PUSHED — notes edited in the web UI or on another
     * device never reached a backgrounded app. Meta probe first (one cheap
     * aggregation): an unchanged signature skips the whole pull. Otherwise:
     *  1. full tree → local server-id notes missing from the tree AND without
     *     queued ops were deleted server-side → remove them from Room
     *     (the tree excludes trash but includes archived + shared notes);
     *  2. paged ?since= delta for active AND archived notes, upserting into
     *     Room while skipping notes with pending ops (their Room row is
     *     newer than anything the server knows about them).
     * Signature + since are persisted only after a clean pull, so a torn
     * run retries completely next period. Returns how many rows changed.
     */
    suspend fun pullRemoteChanges(): Int = withContext(Dispatchers.IO) {
        try {
            val storedSignature = settingsDataStore.syncSignature.first()
            val metaResponse = api.getNotesMeta()
            if (metaResponse.code() == 401) return@withContext 0
            if (!metaResponse.isSuccessful) return@withContext 0
            val meta = metaResponse.body() ?: return@withContext 0
            val signature = meta.signature()
            if (signature == storedSignature) return@withContext 0

            val pendingIds = pendingOperationDao.getAllOperations().map { it.noteId }.toSet()
            var changed = 0

            // 1) Deletion cleanup over the full tree projection.
            val treeIds = try {
                val tree = api.getNoteTree()
                if (!tree.isSuccessful) null
                else tree.body().orEmpty().map { it.id }.toSet()
            } catch (e: CancellationException) {
                throw e // v1.17.0: Abbruch ist kein Best-Effort-Fehler
            } catch (_: Exception) {
                null
            }
            if (treeIds != null) {
                val localServerIds = (noteDao.getAllLiveNotesSync() + noteDao.getAllArchivedNotesSync())
                    .map { it.id }
                    .filter { ServerContract.isServerId(it) }
                localServerIds.forEach { id ->
                    if (id !in treeIds && id !in pendingIds) {
                        noteDao.deleteNoteById(id)
                        changed++
                    }
                }
            }

            // 2) Delta upsert in two sweeps (since=null → full pull: exactly
            // what a cold cache needs); a torn pull keeps the old signature
            // so the next period retries from the same since.
            val since = settingsDataStore.syncSince.first().takeIf { it.isNotBlank() }
            var pullClean = treeIds != null
            var maxSeenUpdatedAt: String? = null
            run {
                for (archived in listOf(false, true)) {
                    var page = 1
                    var pages = 1
                    while (page <= pages) {
                        val response = try {
                            api.getNotes(archived = archived, page = page, limit = PULL_PAGE_LIMIT, since = since)
                        } catch (e: CancellationException) {
                            throw e // v1.17.0: Abbruch darf nicht als „Seite leer“ durchgehen
                        } catch (_: Exception) {
                            pullClean = false
                            break
                        }
                        if (response.code() == 401) {
                            pullClean = false
                            break
                        }
                        if (!response.isSuccessful) {
                            pullClean = false
                            break
                        }
                        val body = response.body() ?: break
                        pages = body.pages ?: 1
                        for (dto in body.getNotesList()) {
                            val domain = dto.toDomain()
                            maxSeenUpdatedAt = newerIso(dto.updatedAt, maxSeenUpdatedAt)
                            // pendingIds is only the fast path from before the
                            // pull started — an offline edit queued WHILE this
                            // multi-second loop runs must also be honored, or
                            // the REPLACE upsert below would wipe it and the
                            // still-queued UPDATE would push the server content
                            // back (silent loss, no conflict copy). Live check
                            // per note (indexed COUNT, sub-millisecond).
                            if (domain.id in pendingIds ||
                                pendingOperationDao.getCountForNote(domain.id) > 0
                            ) continue
                            noteDao.insertNote(domain.toEntity().copy(baseUpdatedAt = dto.updatedAt))
                            changed++
                        }
                        page++
                    }
                    if (!pullClean) break
                }
            }

            if (pullClean) {
                settingsDataStore.setSyncSignature(signature)
                // Next delta starts strictly after the newest change seen —
                // server maxUpdatedAt as the floor, the delta itself may
                // have raced ahead of the probe.
                val newSince = maxSeenUpdatedAt ?: meta.maxUpdatedAt
                if (newSince != null) settingsDataStore.setSyncSince(newSince)
            }
            changed
        } catch (e: CancellationException) {
            // Ein Abbruch (Worker gestoppt, Scope zu) ist kein Best-Effort-
            // Fehler: geschluckt würde die Coroutine cancelled weiterlaufen
            // und der Aufrufer den Abbruch als „Pull fertig 0“ feiern (v1.17.0).
            throw e
        } catch (_: Exception) {
            // Pull is best-effort: a crashing pull must never take the
            // queue drain (its caller) down with it.
            0
        }
    }

    /** Lexicographic max over uniform Mongo ISO strings ("…Z", ms precision). */
    private fun newerIso(candidate: String?, champion: String?): String? = when {
        candidate.isNullOrBlank() -> champion
        champion == null -> candidate
        else -> if (candidate > champion) candidate else champion
    }

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
                // Tree (v1.10.0): children created offline still reference the
                // temporary id in their parentId — move them onto the server
                // id, or the structure silently falls apart on replay.
                noteDao.reassignParentId(noteId, serverId)
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
                    } catch (e: CancellationException) {
                        throw e // v1.17.0: Abbruch darf eine gedroppte Op nicht „überspringen“
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
            } catch (e: CancellationException) {
                throw e // v1.17.0: Abbruch ist kein „Fallback unavailable“
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
        } catch (e: CancellationException) {
            throw e // v1.17.0: Abbruch darf die Konflikt-Kopie nicht als FAILED zählen
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
    /** Ops newly poisoned in THIS drain (hit the attempt cap). */
    val poisoned: Int = 0,
    val authRequired: Boolean = false,
    val conflicts: List<String> = emptyList()
)

/** Body of the server's 409 answer: {error, currentNote} (see UpdateNoteDto contract). */
internal data class ConflictBodyDto(
    val error: String? = null,
    val currentNote: NoteDto? = null
)
