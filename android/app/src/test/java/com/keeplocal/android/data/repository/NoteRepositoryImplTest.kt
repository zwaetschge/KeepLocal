package com.keeplocal.android.data.repository

import androidx.sqlite.db.SupportSQLiteQuery
import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.api.dto.NoteDto
import com.keeplocal.android.data.api.dto.NotesResponseDto
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.data.local.SyncManager
import com.keeplocal.android.data.local.SyncResult
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.dao.PendingOperationDao
import com.keeplocal.android.data.local.entity.NoteEntity
import com.keeplocal.android.data.local.entity.OperationType
import com.keeplocal.android.data.local.entity.PendingOperationEntity
import com.keeplocal.android.domain.model.FolderScope
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteTypeFilter
import com.keeplocal.android.domain.model.SortMode
import com.keeplocal.android.reminder.ReminderScheduler
import com.keeplocal.android.util.FileLogger
import com.keeplocal.android.util.Result
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Response

/**
 * v1.18.0: the dirty-set guard of the plain list (queued UPDATE/CREATE ops
 * must not be shadowed by stale server rows) has to hold for the search and
 * tag branches too — they read the server answer directly instead of Room.
 */
class NoteRepositoryImplTest {

    private lateinit var api: KeepLocalApi
    private lateinit var noteDao: FakeNoteDao
    private lateinit var pendingDao: FakePendingOperationDao
    private lateinit var repository: NoteRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        noteDao = FakeNoteDao()
        pendingDao = FakePendingOperationDao()
        // The cache-clear helpers read the queue — share the state, like the
        // Room tables would.
        noteDao.pendingOpsProvider = { pendingDao.ops.toList() }
        // The drain is not the unit under test here — a no-op keeps the
        // queue exactly as the test arranged it.
        val syncManager = mockk<SyncManager>(relaxed = true)
        coEvery { syncManager.syncPendingOperations(any()) } returns SyncResult(0, 0)
        repository = NoteRepositoryImpl(
            api = api,
            noteDao = noteDao,
            pendingOperationDao = pendingDao,
            syncManager = syncManager,
            settingsDataStore = mockk<SettingsDataStore>(relaxed = true),
            reminderScheduler = mockk<ReminderScheduler>(relaxed = true),
            fileLogger = mockk<FileLogger>(relaxed = true)
        )
    }

    // --- helpers ------------------------------------------------------

    private fun entity(id: String, title: String = "Title") = NoteEntity(
        id = id, title = title, content = "content of $id", color = "default",
        isPinned = false, isArchived = false, isTodoList = false,
        todoItemsJson = "[]", tagsJson = "[]", sharedWithJson = "[]",
        owner = "user1", position = 0, createdAt = 1L, updatedAt = 2L
    )

    private fun dto(id: String, title: String, updatedAt: String = "2026-09-06T10:00:00.000Z") = NoteDto(
        mongoId = id, title = title, content = "content of $id", updatedAt = updatedAt
    )

    private suspend fun enqueue(type: String, noteId: String) {
        pendingDao.insert(PendingOperationEntity(operationType = type, noteId = noteId, payloadJson = ""))
    }

    private fun serverReturns(vararg notes: NoteDto) {
        coEvery { api.getNotes(any(), any(), any(), any(), any(), any(), any()) } returns
            Response.success(NotesResponseDto(notes = notes.toList(), pages = 1))
    }

    private suspend fun notesOf(
        search: String? = null,
        tag: String? = null
    ): List<Note> {
        val result = repository.getNotes(
            search = search, tag = tag, archived = false,
            sortMode = if (search == null && tag == null) SortMode.UPDATED else SortMode.MANUAL,
            limit = null, filter = NoteTypeFilter.ALL, scope = FolderScope.All
        ).toList().single()
        assertTrue("expected success, got $result", result is Result.Success)
        return (result as Result.Success).data
    }

    // --- search branch -------------------------------------------------

    @Test
    fun `search shows the local version of a dirty note and keeps its Room row`() = runTest {
        noteDao.insertNote(entity("srv1", title = "Local offline edit").copy(content = "local content"))
        enqueue(OperationType.UPDATE, "srv1")
        serverReturns(dto("srv1", "Stale server title"))

        val notes = notesOf(search = "stale")

        assertEquals(1, notes.size)
        assertEquals("Local offline edit", notes.single().title)
        assertEquals("local content", notes.single().content)
        // The stale server body must not clobber the row the queued UPDATE
        // replays from.
        assertEquals("Local offline edit", noteDao.notes["srv1"]?.title)
        assertEquals("local content", noteDao.notes["srv1"]?.content)
    }

    @Test
    fun `tag filter shows the local version of a dirty note`() = runTest {
        noteDao.insertNote(entity("srv1", title = "Local offline edit"))
        enqueue(OperationType.UPDATE, "srv1")
        serverReturns(dto("srv1", "Stale server title"))

        val notes = notesOf(tag = "work")

        assertEquals(1, notes.size)
        assertEquals("Local offline edit", notes.single().title)
        assertEquals("Local offline edit", noteDao.notes["srv1"]?.title)
    }

    @Test
    fun `dirty id without a cached row is dropped from search results`() = runTest {
        enqueue(OperationType.UPDATE, "srv9")
        serverReturns(dto("srv1", "Kept note"), dto("srv9", "Stranded stale note"))

        val notes = notesOf(search = "note")

        assertEquals(listOf("srv1"), notes.map { it.id })
    }

    @Test
    fun `search without pending operations keeps the server answer`() = runTest {
        serverReturns(dto("srv1", "Server title"))

        val notes = notesOf(search = "title")

        assertEquals("Server title", notes.single().title)
        // Unchanged behaviour: clean hits are merged into Room as the new
        // optimistic-lock base.
        assertEquals("Server title", noteDao.notes["srv1"]?.title)
    }

    // --- plain list branch (refactor regression guard) ------------------

    @Test
    fun `plain list rebuild still preserves dirty Room rows`() = runTest {
        noteDao.insertNote(entity("srv1", title = "Local offline edit"))
        enqueue(OperationType.UPDATE, "srv1")
        serverReturns(dto("srv1", "Stale server title"), dto("srv2", "Fresh note"))

        notesOf()

        assertEquals("Local offline edit", noteDao.notes["srv1"]?.title)
        assertEquals("Fresh note", noteDao.notes["srv2"]?.title)
    }
}

/** In-memory NoteDao — only the suspend accessors matter for these tests. */
private class FakeNoteDao : NoteDao {
    val notes = linkedMapOf<String, NoteEntity>()

    override fun getAllNotes(): Flow<List<NoteEntity>> = flow { emit(notes.values.toList()) }

    override fun getArchivedNotes(): Flow<List<NoteEntity>> = flow { emit(notes.values.filter { it.isArchived }) }

    override fun searchNotes(query: String): Flow<List<NoteEntity>> =
        flow { emit(notes.values.filter { it.title.contains(query) || it.content.contains(query) }) }

    /** Raw-SQL display query; asserting the Room rows directly instead. */
    override fun getNotesQuery(query: SupportSQLiteQuery): Flow<List<NoteEntity>> =
        flow { emit(emptyList()) }

    override suspend fun getNotesWithUpcomingReminders(nowEpochMs: Long): List<NoteEntity> = emptyList()

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

    override suspend fun getActiveNoteIdsInDisplayOrder(): List<String> =
        notes.values.filter { !it.isArchived }.map { it.id }

    override suspend fun updatePosition(id: String, position: Int) {
        notes[id]?.let { notes[id] = it.copy(position = position) }
    }

    override suspend fun getPinnedNotes(limit: Int): List<NoteEntity> =
        notes.values.filter { it.isPinned }.take(limit)

    override suspend fun countPendingNoteIds(): Int =
        notes.keys.count { id -> pendingOpsProvider().any { it.noteId == id } }

    override suspend fun deleteSyncedNotes(): Int {
        val keep = pendingOpsProvider().map { it.noteId }.toSet()
        val before = notes.size
        notes.entries.removeAll { it.key !in keep }
        return before - notes.size
    }

    /** Wired in setup() — the queue lives in the other fake. */
    var pendingOpsProvider: () -> List<PendingOperationEntity> = { emptyList() }

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

    override suspend fun getCountForNote(noteId: String): Int =
        ops.count { it.noteId == noteId }

    override suspend fun deleteByNoteAndType(noteId: String, operationType: String) {
        ops.removeAll { it.noteId == noteId && it.operationType == operationType }
    }

    override suspend fun deleteByType(operationType: String) {
        ops.removeAll { it.operationType == operationType }
    }
}
