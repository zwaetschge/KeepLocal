package com.keeplocal.android.data.local

import androidx.sqlite.db.SupportSQLiteQuery
import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.api.dto.NoteDto
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.dao.PendingOperationDao
import com.keeplocal.android.data.local.entity.NoteEntity
import com.keeplocal.android.data.local.entity.OperationType
import com.keeplocal.android.data.local.entity.PendingOperationEntity
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
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

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        noteDao = FakeNoteDao()
        pendingDao = FakePendingOperationDao()
        // The cache-clear queries read the pending table; the fakes share state
        // through this provider so "deleteSyncedNotes keeps queued ids" holds.
        noteDao.pendingNoteIdsProvider = { pendingDao.ops.mapTo(mutableSetOf()) { it.noteId } }
        syncManager = SyncManager(api, noteDao, pendingDao)
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
}

/** In-memory PendingOperationDao mirroring the queue semantics (insert order = createdAt). */
private class FakePendingOperationDao : PendingOperationDao {
    val ops = mutableListOf<PendingOperationEntity>()
    private var nextId = 1L

    override suspend fun getAllOperations(): List<PendingOperationEntity> =
        ops.sortedBy { it.createdAt }.toList()

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

    override suspend fun deleteByNoteAndType(noteId: String, operationType: String) {
        ops.removeAll { it.noteId == noteId && it.operationType == operationType }
    }

    override suspend fun deleteByType(operationType: String) {
        ops.removeAll { it.operationType == operationType }
    }
}
