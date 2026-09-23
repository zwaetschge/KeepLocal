package com.keeplocal.android.data.local

import androidx.sqlite.db.SupportSQLiteQuery
import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.api.dto.NoteDto
import com.keeplocal.android.data.api.dto.NoteTreeNodeDto
import com.keeplocal.android.data.api.dto.NotesMetaDto
import com.keeplocal.android.data.api.dto.NotesResponseDto
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.dao.PendingOperationDao
import com.keeplocal.android.data.local.entity.NoteEntity
import com.keeplocal.android.data.local.entity.OperationType
import com.keeplocal.android.data.local.entity.PendingOperationEntity
import io.mockk.coEvery
import java.io.IOException
import io.mockk.every
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.runTest
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Response

class SyncManagerTest {

    private lateinit var api: KeepLocalApi
    private lateinit var noteDao: FakeNoteDao
    private lateinit var pendingDao: FakePendingOperationDao
    private lateinit var syncManager: SyncManager

    // v1.14.0 Nr. 6: DataStore stand-in with readable/writable state so the
    // pull tests can assert what got persisted (signature + since).
    private lateinit var settings: SettingsDataStore
    private var storedSignature = ""
    private var storedSince = ""

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        noteDao = FakeNoteDao()
        pendingDao = FakePendingOperationDao()
        settings = mockk(relaxed = true)
        every { settings.syncSignature } returns flow { emit(storedSignature) }
        every { settings.syncSince } returns flow { emit(storedSince) }
        coEvery { settings.setSyncSignature(any()) } answers { storedSignature = firstArg() }
        coEvery { settings.setSyncSince(any()) } answers { storedSince = firstArg() }
        // The cache-clear queries read the pending table; the fakes share state
        // through this provider so "deleteSyncedNotes keeps queued ids" holds.
        noteDao.pendingNoteIdsProvider = { pendingDao.ops.mapTo(mutableSetOf()) { it.noteId } }
        syncManager = SyncManager(api, noteDao, pendingDao, settings)
    }

    // --- helpers ------------------------------------------------------

    private fun entity(id: String, title: String = "Title", base: String? = null) = NoteEntity(
        id = id, title = title, content = "content of $id", color = "default",
        isPinned = false, isArchived = false, isTodoList = false,
        todoItemsJson = "[]", tagsJson = "[]", sharedWithJson = "[]",
        owner = "user1", position = 0, createdAt = 1L, updatedAt = 2L,
        baseUpdatedAt = base
    )

    private fun dto(id: String, title: String, updatedAt: String = "2026-09-06T10:00:00.000Z") = NoteDto(
        mongoId = id, title = title, content = "content of $id", updatedAt = updatedAt
    )

    private fun errorResponse(code: Int, body: String = ""): Response<NoteDto> =
        Response.error(code, body.toResponseBody("application/json".toMediaType()))

    private suspend fun enqueue(type: String, noteId: String) {
        pendingDao.insert(PendingOperationEntity(operationType = type, noteId = noteId, payloadJson = ""))
    }

    // --- (a) CREATE + TOGGLE_PIN offline -> id rewrite ----------------

    @Test
    fun `create rewrites offline id and following toggle uses server id`() = runTest {
        noteDao.insertNote(entity("offline_1", title = "Offline note"))
        enqueue(OperationType.CREATE, "offline_1")
        enqueue(OperationType.TOGGLE_PIN, "offline_1")
        coEvery { api.createNote(any()) } returns Response.success(dto("srv1", "Offline note"))
        coEvery { api.togglePin("srv1") } returns Response.success(dto("srv1", "Offline note").copy(isPinned = true))

        val result = syncManager.syncPendingOperations()

        assertEquals(2, result.synced)
        assertEquals(0, result.failed)
        assertTrue("queue must be empty", pendingDao.ops.isEmpty())
        assertNull("offline row must be replaced", noteDao.notes["offline_1"])
        val synced = noteDao.notes["srv1"]
        assertNotNull(synced)
        assertEquals(true, synced?.isPinned)
        assertEquals("2026-09-06T10:00:00.000Z", synced?.baseUpdatedAt)
        // No 404 leftovers: the pin must never hit the stale offline id.
        coVerify(exactly = 1) { api.togglePin("srv1") }
        coVerify(exactly = 0) { api.togglePin("offline_1") }
    }

    @Test
    fun `successful sync resets the status`() = runTest {
        noteDao.insertNote(entity("offline_1"))
        enqueue(OperationType.CREATE, "offline_1")
        coEvery { api.createNote(any()) } returns Response.success(dto("srv1", "Title"))

        syncManager.syncPendingOperations()

        assertEquals(SyncStatus(), syncManager.syncStatus.value)
    }

    // --- (b) stillborn operations ------------------------------------

    @Test
    fun `update without local entity is discarded and server version pulled`() = runTest {
        enqueue(OperationType.UPDATE, "srv9")
        coEvery { api.getNote("srv9") } returns Response.success(dto("srv9", "Server title", updatedAt = "2026-09-06T12:00:00.000Z"))

        val result = syncManager.syncPendingOperations()

        assertEquals(0, result.synced)
        assertEquals(0, result.failed)
        assertEquals(1, result.skipped)
        assertTrue(pendingDao.ops.isEmpty())
        assertEquals("Server title", noteDao.notes["srv9"]?.title)
        assertEquals("2026-09-06T12:00:00.000Z", noteDao.notes["srv9"]?.baseUpdatedAt)
    }

    @Test
    fun `update without local entity stays skipped when server also lost it`() = runTest {
        enqueue(OperationType.UPDATE, "gone")
        coEvery { api.getNote("gone") } returns errorResponse(404)

        val result = syncManager.syncPendingOperations()

        assertEquals(1, result.skipped)
        assertEquals(0, result.failed)
        assertTrue(pendingDao.ops.isEmpty())
        assertNull(noteDao.notes["gone"])
    }

    @Test
    fun `create without local entity is discarded without any api call`() = runTest {
        enqueue(OperationType.CREATE, "offline_x")

        val result = syncManager.syncPendingOperations()

        assertEquals(1, result.skipped)
        assertTrue(pendingDao.ops.isEmpty())
        coVerify(exactly = 0) { api.createNote(any()) }
    }

    // --- (c) 409 conflict -> local version saved as copy ---------------

    @Test
    fun `conflict on update keeps local edits as copy and adopts server version`() = runTest {
        noteDao.insertNote(entity("srv1", title = "Local edit", base = "2026-09-06T10:00:00.000Z").let {
            it.copy(content = "local content")
        })
        enqueue(OperationType.UPDATE, "srv1")
        coEvery { api.updateNote(eq("srv1"), any()) } returns errorResponse(
            409,
            """{"error":"Note was modified","currentNote":{"_id":"srv1","title":"Server title",""" +
                """"content":"server content","updatedAt":"2026-09-06T12:00:00.000Z"}}"""
        )
        coEvery { api.createNote(any()) } returns Response.success(dto("srv2", "whatever"))

        val result = syncManager.syncPendingOperations()

        assertEquals(1, result.synced)
        assertEquals(0, result.failed)
        assertTrue(pendingDao.ops.isEmpty())
        // Server version wins the original id and becomes the new base.
        assertEquals("Server title", noteDao.notes["srv1"]?.title)
        assertEquals("2026-09-06T12:00:00.000Z", noteDao.notes["srv1"]?.baseUpdatedAt)
        // Local edits survive as a marked copy.
        val copy = noteDao.notes["srv2"]
        assertNotNull(copy)
        assertTrue("copy title: ${copy?.title}", copy?.title?.contains("(lokale Version") == true)
        assertEquals("local content", copy?.content)
        assertEquals(listOf("Local edit"), result.conflicts)
    }

    // --- (d) 401 -> auth required, no endless retry ---------------------

    @Test
    fun `unauthorized sync stops and reports auth required`() = runTest {
        // CREATE only sends when a local row exists; without these the ops
        // would be dropped as SKIPPED before the API is ever called.
        noteDao.insertNote(entity("offline_a"))
        noteDao.insertNote(entity("offline_b"))
        enqueue(OperationType.CREATE, "offline_a")
        enqueue(OperationType.CREATE, "offline_b")
        coEvery { api.createNote(any()) } returns errorResponse(401, "{\"error\":\"Authelia session expired\"}")

        val result = syncManager.syncPendingOperations()

        assertTrue(result.authRequired)
        assertEquals(0, result.synced)
        // The second op was never even attempted — no endless retry loop.
        coVerify(exactly = 1) { api.createNote(any()) }
        assertEquals("queue must survive for the post-login retry", 2, pendingDao.ops.size)
        assertTrue(syncManager.syncStatus.value.authRequired)
    }

    // --- toggle 404 handling -------------------------------------------

    @Test
    fun `toggle pin on server-deleted note is dropped when no create is pending`() = runTest {
        enqueue(OperationType.TOGGLE_PIN, "srv7")
        coEvery { api.togglePin("srv7") } returns errorResponse(404)

        val result = syncManager.syncPendingOperations()

        assertEquals(1, result.skipped)
        assertEquals(0, result.failed)
        assertTrue(pendingDao.ops.isEmpty())
    }

    @Test
    fun `toggle pin 404 is kept while its create is still queued`() = runTest {
        noteDao.insertNote(entity("offline_1"))
        enqueue(OperationType.CREATE, "offline_1")
        enqueue(OperationType.TOGGLE_PIN, "offline_1")
        coEvery { api.createNote(any()) } returns errorResponse(500)
        coEvery { api.togglePin("offline_1") } returns errorResponse(404)

        val result = syncManager.syncPendingOperations()

        assertEquals(2, result.failed)
        assertEquals("both ops must stay queued", 2, pendingDao.ops.size)
    }

    // --- delete stays idempotent ----------------------------------------

    @Test
    fun `delete succeeds when note is already gone on the server`() = runTest {
        enqueue(OperationType.DELETE, "gone")
        coEvery { api.deleteNote("gone") } returns Response.success(Unit)

        val result = syncManager.syncPendingOperations()

        assertEquals(1, result.synced)
        assertTrue(pendingDao.ops.isEmpty())
    }

    // --- (e) poison cap + network abort (v1.16.0) ----------------------

    @Test
    fun `server-rejected op is poisoned after eight failed drains and never retried`() = runTest {
        noteDao.insertNote(entity("offline_p", title = "Gift"))
        enqueue(OperationType.CREATE, "offline_p")
        coEvery { api.createNote(any()) } returns errorResponse(500)

        // Seven drains: op fails, attempt counter climbs, still active.
        repeat(7) {
            val result = syncManager.syncPendingOperations()
            assertEquals(1, result.failed)
            assertEquals(0, result.poisoned)
        }
        assertEquals(7, pendingDao.ops.single().attemptCount)
        assertEquals(false, pendingDao.ops.single().poisoned)

        // Eighth rejection hits the cap -> poisoned, row survives.
        val capped = syncManager.syncPendingOperations()
        assertEquals(1, capped.failed)
        assertEquals(1, capped.poisoned)
        assertEquals(true, pendingDao.ops.single().poisoned)
        assertEquals(1, syncManager.syncStatus.value.poisonedCount)

        // Ninth drain: no API call at all — the endless 15-minute retry is over.
        syncManager.syncPendingOperations()
        coVerify(exactly = 8) { api.createNote(any()) }
    }

    @Test
    fun `poisoned op is discarded for good and the rest of the queue keeps syncing`() = runTest {
        noteDao.insertNote(entity("offline_p", title = "Gift"))
        noteDao.insertNote(entity("offline_2", title = "Gesund"))
        enqueue(OperationType.CREATE, "offline_p")
        enqueue(OperationType.CREATE, "offline_2")
        // The Gift note is permanently rejected, its healthy neighbour is not.
        coEvery { api.createNote(match { it.title == "Gift" }) } returns errorResponse(500)
        coEvery { api.createNote(match { it.title != "Gift" }) } returns Response.success(dto("srv2", "Gesund"))

        repeat(8) { syncManager.syncPendingOperations() }
        assertEquals(true, pendingDao.ops.first { it.noteId == "offline_p" }.poisoned)

        // The healthy op synced on the FIRST drain (the poison cap never
        // blocks the rest of the queue); afterwards only the poison row stays.
        assertEquals(1, pendingDao.ops.size)
        assertNotNull(noteDao.notes["srv2"])
    }

    @Test
    fun `network failure aborts the drain without attempt counting`() = runTest {
        enqueue(OperationType.DELETE, "srv_a")
        enqueue(OperationType.DELETE, "srv_b")
        coEvery { api.deleteNote("srv_a") } throws IOException("connection reset")
        coEvery { api.deleteNote("srv_b") } returns Response.success(Unit)

        val result = syncManager.syncPendingOperations()

        // Aborted at the first transport error: the second op was never
        // attempted and NOTHING counted as server-side failure.
        coVerify(exactly = 0) { api.deleteNote("srv_b") }
        assertEquals(0, result.failed)
        assertEquals("both ops stay queued for the next online drain", 2, pendingDao.ops.size)
        assertEquals("network hiccups must not eat the attempt budget", 0, pendingDao.ops[0].attemptCount)
    }

    @Test
    fun `unexpected exceptions count toward the poison cap`() = runTest {
        // A JsonDataException/serialization crash is not transport (no
        // IOException) and not a server verdict — but it IS deterministic:
        // left uncounted, a permanently broken op rides along in every
        // drain forever (v1.16.0 review finding L).
        noteDao.insertNote(entity("offline_x", title = "Kaputt"))
        enqueue(OperationType.CREATE, "offline_x")
        coEvery { api.createNote(any()) } throws RuntimeException("bad json")

        repeat(7) {
            val result = syncManager.syncPendingOperations()
            assertEquals(1, result.failed)
            assertEquals(0, result.poisoned)
        }
        assertEquals(7, pendingDao.ops.single().attemptCount)

        val capped = syncManager.syncPendingOperations()
        assertEquals(1, capped.poisoned)
        assertEquals(true, pendingDao.ops.single().poisoned)
    }

    @Test
    fun `auth failure never poisons the queue`() = runTest {
        noteDao.insertNote(entity("offline_a"))
        enqueue(OperationType.CREATE, "offline_a")
        coEvery { api.createNote(any()) } returns errorResponse(401)

        repeat(10) { syncManager.syncPendingOperations() }

        assertEquals(false, pendingDao.ops.single().poisoned)
        assertEquals("401 is not a server rejection", 0, pendingDao.ops.single().attemptCount)
    }

    // --- Abbruch + Single-Flight (v1.17.0) ----------------------------

    /**
     * assertFailsWith-Ersatz (v1.17.0): kotlin.test ist nicht im Tree, und
     * JUnits assertThrows nimmt keine suspend-Lambdas. Der Abbruch muss durch
     * den kompletten Sync-Pfad durchreichen — genau das prüft der Helper.
     */
    private suspend fun assertPropagatesCancellation(block: suspend () -> Unit) {
        try {
            block()
        } catch (expected: CancellationException) {
            return
        }
        throw AssertionError("expected a CancellationException to propagate")
    }

    @Test
    fun `cancellation mid-drain propagates instead of poisoning the queue`() = runTest {
        noteDao.insertNote(entity("offline_a"))
        noteDao.insertNote(entity("offline_b"))
        enqueue(OperationType.CREATE, "offline_a")
        enqueue(OperationType.CREATE, "offline_b")
        // Erster Aufruf: der Worker wird mitten in der ersten Op gestoppt.
        coEvery { api.createNote(any()) } throws CancellationException("workmanager stop") andThen
            Response.success(dto("srv1", "T1")) andThen Response.success(dto("srv2", "T2"))

        assertPropagatesCancellation { syncManager.syncPendingOperations() }

        // Der Abbruch darf weder fressen noch zählen: Queue komplett da,
        // kein Versuch verbraucht, kein „läuft“-Banner-Kleber.
        assertEquals("queue survives the aborted drain", 2, pendingDao.ops.size)
        assertEquals("cancellation must not eat the attempt budget", 0, pendingDao.ops[0].attemptCount)
        assertEquals(false, syncManager.syncStatus.value.isSyncing)

        // Die Mutex ist nach dem Abbruch frei — der nächste Drain synced alles.
        val retry = syncManager.syncPendingOperations()
        assertEquals(2, retry.synced)
        assertTrue(pendingDao.ops.isEmpty())
        assertNotNull(noteDao.notes["srv1"])
        assertNotNull(noteDao.notes["srv2"])
    }

    @Test
    fun `a second drain while one is running returns immediately`() = runTest {
        noteDao.insertNote(entity("offline_1"))
        enqueue(OperationType.CREATE, "offline_1")
        // Gate im API-Call: der erste Drain hält die Mutex, bis wir sie
        // freigeben — deterministisch, nicht über Scheduler-Timing.
        val enteredApi = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        coEvery { api.createNote(any()) } coAnswers {
            enteredApi.complete(Unit)
            release.await()
            Response.success(dto("srv1", "Title"))
        }

        val first = async { syncManager.syncPendingOperations() }
        enteredApi.await() // erster Drain sitzt definitiv im API-Call
        val second = async { syncManager.syncPendingOperations() }
        val secondResult = second.await()

        // Single-Flight: kein Anstehen, kein Doppel-Drain — Nullergebnis.
        assertEquals(0, secondResult.synced)
        assertEquals(0, secondResult.failed)

        release.complete(Unit)
        assertEquals("the running drain covers the queue", 1, first.await().synced)
        coVerify(exactly = 1) { api.createNote(any()) }
        assertTrue(pendingDao.ops.isEmpty())
    }

    @Test
    fun `export drains wait behind a running drain and push their own late op`() = runTest {
        noteDao.insertNote(entity("offline_1"))
        noteDao.insertNote(entity("offline_2"))
        enqueue(OperationType.CREATE, "offline_1")
        val enteredApi = CompletableDeferred<Unit>()
        val release = CompletableDeferred<Unit>()
        var apiCalls = 0
        coEvery { api.createNote(any()) } coAnswers {
            apiCalls++
            enteredApi.complete(Unit)
            if (apiCalls == 1) release.await() // erster Drain hält die Mutex
            Response.success(dto("srv-$apiCalls", "Title $apiCalls"))
        }

        val first = async { syncManager.syncPendingOperations() }
        enteredApi.await()
        // Op NACH dem Snapshot des laufenden Drains enqueued — der v1.17.0-
        // Early-Return hätte sie nie gepusht und dem Export stille Alte
        // Daten geliefert (Review v1.17.0). awaitRunningDrain stellt sich
        // hinter die Mutex und draine danach selbst.
        enqueue(OperationType.CREATE, "offline_2")
        val exportDrain = async { syncManager.syncPendingOperations(awaitRunningDrain = true) }

        release.complete(Unit)
        assertEquals(1, first.await().synced)
        assertEquals("die nach-Snapshot-Op erreicht den Server doch", 1, exportDrain.await().synced)
        coVerify(exactly = 2) { api.createNote(any()) }
        assertTrue(pendingDao.ops.isEmpty())
        assertNotNull(noteDao.notes["srv-1"])
        assertNotNull(noteDao.notes["srv-2"])
    }

    // --- pullRemoteChanges (v1.14.0 Nr. 6) ---------------------------

    private fun meta(
        active: Int = 1,
        archived: Int = 0,
        trash: Int = 0,
        maxUpdatedAt: String? = "2026-09-22T10:00:00.000Z"
    ): Response<NotesMetaDto> = Response.success(NotesMetaDto(active, archived, trash, maxUpdatedAt))

    private fun emptyListPage(): Response<NotesResponseDto> =
        Response.success(NotesResponseDto(notes = emptyList(), pages = 1))

    @Test
    fun `unchanged signature skips the pull entirely`() = runTest {
        storedSignature = "1/0/0/2026-09-22T10:00:00.000Z"
        coEvery { api.getNotesMeta() } returns meta()

        assertEquals(0, syncManager.pullRemoteChanges())
        coVerify(exactly = 0) { api.getNoteTree() }
        coVerify(exactly = 0) {
            api.getNotes(any(), any(), any(), any(), any(), any(), any())
        }
    }

    @Test
    fun `server-deleted notes are cleaned up, offline and pending ids survive`() = runTest {
        storedSignature = ""
        coEvery { api.getNotesMeta() } returns meta(active = 2)
        coEvery { api.getNoteTree() } returns Response.success(
            listOf(
                NoteTreeNodeDto(id = "aaaaaaaaaaaaaaaaaaaaaaaa"),
                NoteTreeNodeDto(id = "bbbbbbbbbbbbbbbbbbbbbbbb")
            )
        )
        coEvery {
            api.getNotes(any(), any(), any(), any(), any(), any(), any())
        } returns emptyListPage()

        noteDao.insertNote(entity("aaaaaaaaaaaaaaaaaaaaaaaa")) // still on server
        noteDao.insertNote(entity("cccccccccccccccccccccccc")) // deleted server-side
        noteDao.insertNote(entity("offline_1")) // local id, never in the tree
        noteDao.insertNote(entity("dddddddddddddddddddddddd")) // deleted but queued
        enqueue(OperationType.UPDATE, "dddddddddddddddddddddddd")

        assertEquals(1, syncManager.pullRemoteChanges())

        assertNotNull(noteDao.getNoteById("aaaaaaaaaaaaaaaaaaaaaaaa"))
        assertNull("deleted server-side and not queued -> removed", noteDao.getNoteById("cccccccccccccccccccccccc"))
        assertNotNull("offline ids are not server notes", noteDao.getNoteById("offline_1"))
        assertNotNull("queued notes wait for their op", noteDao.getNoteById("dddddddddddddddddddddddd"))
        assertEquals("2/0/0/2026-09-22T10:00:00.000Z", storedSignature)
    }

    @Test
    fun `delta upserts changed notes but never overwrites queued edits`() = runTest {
        storedSignature = ""
        storedSince = "2026-09-22T09:00:00.000Z"
        coEvery { api.getNotesMeta() } returns meta()
        coEvery { api.getNoteTree() } returns Response.success(
            listOf(NoteTreeNodeDto(id = "eeeeeeeeeeeeeeeeeeeeeeee"), NoteTreeNodeDto(id = "ffffffffffffffffffffffff"))
        )
        coEvery {
            api.getNotes(any(), any(), eq(false), any(), any(), any(), any())
        } returns Response.success(
            NotesResponseDto(
                notes = listOf(
                    dto("eeeeeeeeeeeeeeeeeeeeeeee", "Geändert", updatedAt = "2026-09-22T09:30:00.000Z"),
                    dto("ffffffffffffffffffffffff", "Server-Fassung", updatedAt = "2026-09-22T09:45:00.000Z")
                ),
                pages = 1
            )
        )
        coEvery {
            api.getNotes(any(), any(), eq(true), any(), any(), any(), any())
        } returns emptyListPage()

        noteDao.insertNote(entity("ffffffffffffffffffffffff", title = "Lokale Fassung"))
        enqueue(OperationType.UPDATE, "ffffffffffffffffffffffff")

        assertEquals(1, syncManager.pullRemoteChanges())

        assertEquals("Geändert", noteDao.getNoteById("eeeeeeeeeeeeeeeeeeeeeeee")?.title)
        assertEquals("queued note keeps its local row", "Lokale Fassung", noteDao.getNoteById("ffffffffffffffffffffffff")?.title)
        // Next delta starts after the newest change actually seen.
        assertEquals("2026-09-22T09:45:00.000Z", storedSince)
    }

    @Test
    fun `an edit queued mid-pull is honored by the live pending check`() = runTest {
        storedSignature = ""
        storedSince = "2026-09-22T09:00:00.000Z"
        coEvery { api.getNotesMeta() } returns meta()
        coEvery { api.getNoteTree() } returns Response.success(
            listOf(NoteTreeNodeDto(id = "eeeeeeeeeeeeeeeeeeeeeeee"))
        )
        coEvery {
            api.getNotes(any(), any(), eq(false), any(), any(), any(), any())
        } returns Response.success(
            NotesResponseDto(
                notes = listOf(dto("eeeeeeeeeeeeeeeeeeeeeeee", "Server-Fassung", updatedAt = "2026-09-22T09:30:00.000Z")),
                pages = 1
            )
        )
        coEvery {
            api.getNotes(any(), any(), eq(true), any(), any(), any(), any())
        } returns emptyListPage()

        noteDao.insertNote(entity("eeeeeeeeeeeeeeeeeeeeeeee", title = "Lokale Fassung"))
        // Der Snapshot vor der Loop ist leer — die UPDATE taucht erst WÄHREND
        // des Pulls auf (lateEditIds zählt nur im Live-Check, nicht in
        // getAllOperations). Ohne den Live-Check hätte der REPLACE-Upsert die
        // lokale Fassung mit der Server-Version überschrieben.
        pendingDao.lateEditIds += "eeeeeeeeeeeeeeeeeeeeeeee"

        assertEquals(0, syncManager.pullRemoteChanges())

        assertEquals(
            "mid-pull edit survives the REPLACE upsert",
            "Lokale Fassung",
            noteDao.getNoteById("eeeeeeeeeeeeeeeeeeeeeeee")?.title
        )
    }

    @Test
    fun `a torn delta keeps the old signature for a full retry`() = runTest {
        storedSignature = ""
        coEvery { api.getNotesMeta() } returns meta()
        coEvery { api.getNoteTree() } returns Response.success(emptyList())
        coEvery {
            api.getNotes(any(), any(), any(), any(), any(), any(), any())
        } returns Response.error(500, "".toResponseBody("text/plain".toMediaType()))

        syncManager.pullRemoteChanges()

        assertEquals("signature stays stale -> next period retries", "", storedSignature)
    }

    @Test
    fun `expired session aborts the pull without persisting`() = runTest {
        storedSignature = ""
        coEvery { api.getNotesMeta() } returns Response.error(401, "".toResponseBody("text/plain".toMediaType()))

        assertEquals(0, syncManager.pullRemoteChanges())
        assertEquals("", storedSignature)
        assertEquals("", storedSince)
    }

    @Test
    fun `cancellation during the pull propagates instead of returning 0`() = runTest {
        storedSignature = ""
        coEvery { api.getNotesMeta() } throws CancellationException("worker stopped")

        assertPropagatesCancellation { syncManager.pullRemoteChanges() }
        assertEquals("signature stays stale -> the next period retries", "", storedSignature)
    }
}

/** In-memory NoteDao — only the suspend accessors matter for the sync flow. */
private class FakeNoteDao : NoteDao {
    val notes = linkedMapOf<String, NoteEntity>()

    override fun getAllNotes(): Flow<List<NoteEntity>> = flow { emit(notes.values.toList()) }

    override fun getArchivedNotes(): Flow<List<NoteEntity>> = flow { emit(notes.values.filter { it.isArchived }) }

    override fun searchNotes(query: String): Flow<List<NoteEntity>> =
        flow { emit(notes.values.filter { it.title.contains(query) || it.content.contains(query) }) }

    /** Raw-SQL display query (sort modes + paging); the sync flow never reads it. */
    override fun getNotesQuery(query: SupportSQLiteQuery): Flow<List<NoteEntity>> =
        flow { emit(emptyList()) }

    /** Reminder re-planning after sync; not exercised by these tests. */
    override suspend fun getNotesWithUpcomingReminders(nowEpochMs: Long): List<NoteEntity> =
        emptyList()

    override suspend fun getNoteById(id: String): NoteEntity? = notes[id]

    override suspend fun insertNote(note: NoteEntity) {
        notes[note.id] = note
    }

    override suspend fun insertNotes(notes: List<NoteEntity>) {
        notes.forEach { this.notes[it.id] = it }
    }

    override suspend fun deleteNote(note: NoteEntity) {
        notes.remove(note.id)
    }

    override suspend fun deleteNoteById(id: String) {
        notes.remove(id)
    }

    override suspend fun deleteAll() {
        notes.clear()
    }

    // Display order as the Room query defines it: pinned first, then
    // position, then newest edit.
    override suspend fun getActiveNoteIdsInDisplayOrder(): List<String> =
        notes.values
            .filter { !it.isArchived }
            .sortedWith(
                compareByDescending<NoteEntity> { it.isPinned }
                    .thenBy { it.position }
                    .thenByDescending { it.updatedAt }
            )
            .map { it.id }

    override suspend fun updatePosition(id: String, position: Int) {
        notes[id]?.let { notes[id] = it.copy(position = position) }
    }

    override suspend fun getPinnedNotes(limit: Int): List<NoteEntity> =
        notes.values.filter { it.isPinned }.sortedBy { it.position }.take(limit)

    /** Distinct note ids with open pending operations; wired in setup(). */
    var pendingNoteIdsProvider: () -> Set<String> = { emptySet() }

    override suspend fun countPendingNoteIds(): Int = pendingNoteIdsProvider().size

    override suspend fun deleteSyncedNotes(): Int {
        val keep = pendingNoteIdsProvider()
        val before = notes.size
        notes.entries.removeAll { it.key !in keep }
        return before - notes.size
    }

    // Tree queries (v1.10.0); the sync flow only touches reassignParentId —
    // a CREATE that comes back with a server id must drag its children along.
    override fun getNotesInFolder(parentId: String?): Flow<List<NoteEntity>> =
        flow { emit(notes.values.filter { it.parentId == parentId && !it.isArchived }) }

    override suspend fun getDirectChildIds(parentId: String?): List<String> =
        notes.values.filter { it.parentId == parentId && !it.isArchived }.map { it.id }

    override suspend fun getAllLiveNotesSync(): List<NoteEntity> =
        notes.values.filter { !it.isArchived }

    override suspend fun getAllArchivedNotesSync(): List<NoteEntity> =
        notes.values.filter { it.isArchived }

    override suspend fun findByExactTitle(title: String): List<NoteEntity> =
        notes.values.filter { it.title.equals(title, ignoreCase = true) && !it.isArchived }

    override suspend fun findBacklinks(excludeId: String, pattern: String): List<NoteEntity> =
        notes.values.filter { it.id != excludeId && !it.isArchived && it.content.contains("[[") }

    override suspend fun reassignParentId(oldParentId: String, newParentId: String) {
        notes.values.filter { it.parentId == oldParentId }.forEach {
            notes[it.id] = it.copy(parentId = newParentId)
        }
    }
}

/** In-memory PendingOperationDao mirroring the queue semantics (insert order = createdAt). */
private class FakePendingOperationDao : PendingOperationDao {
    val ops = mutableListOf<PendingOperationEntity>()
    private var nextId = 1L

    override suspend fun getAllOperations(): List<PendingOperationEntity> =
        ops.sortedBy { it.createdAt }.toList()

    override suspend fun getActiveOperations(): List<PendingOperationEntity> =
        ops.filter { !it.poisoned }.sortedBy { it.createdAt }.toList()

    override suspend fun incrementAttempts(id: Long) {
        val index = ops.indexOfFirst { it.id == id }
        if (index >= 0) ops[index] = ops[index].copy(attemptCount = ops[index].attemptCount + 1)
    }

    override suspend fun markPoisoned(id: Long) {
        val index = ops.indexOfFirst { it.id == id }
        if (index >= 0) ops[index] = ops[index].copy(poisoned = true)
    }

    override suspend fun getPoisonedCount(): Int = ops.count { it.poisoned }

    override suspend fun insert(operation: PendingOperationEntity) {
        ops.add(operation.copy(id = nextId++))
    }

    override suspend fun delete(operation: PendingOperationEntity) {
        ops.removeAll { it.id == operation.id }
    }

    override suspend fun deleteById(id: Long) {
        ops.removeAll { it.id == id }
    }

    override suspend fun deleteAll() {
        ops.clear()
    }

    override suspend fun getCount(): Int = ops.size

    override suspend fun reassignNoteId(oldId: String, newId: String) {
        for (i in ops.indices) {
            if (ops[i].noteId == oldId) ops[i] = ops[i].copy(noteId = newId)
        }
    }

    override suspend fun getCountForNoteAndType(noteId: String, operationType: String): Int =
        ops.count { it.noteId == noteId && it.operationType == operationType }

    /** Simuliert eine Operation, die NACH dem Snapshot der Pull-Loop enqueued
     *  wurde — der Live-Check muss sie trotzdem respektieren (Review-Fix). */
    val lateEditIds = mutableSetOf<String>()

    override suspend fun getCountForNote(noteId: String): Int =
        ops.count { it.noteId == noteId } + if (noteId in lateEditIds) 1 else 0

    override suspend fun deleteByNoteAndType(noteId: String, operationType: String) {
        ops.removeAll { it.noteId == noteId && it.operationType == operationType }
    }

    override suspend fun deleteByType(operationType: String) {
        ops.removeAll { it.operationType == operationType }
    }
}
