package com.keeplocal.android.data.local

import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.api.dto.NoteDto
import com.keeplocal.android.data.api.dto.NotesMetaDto
import com.keeplocal.android.data.api.dto.NotesResponseDto
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.dao.PendingOperationDao
import com.keeplocal.android.data.local.entity.NoteEntity
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import retrofit2.Response

/**
 * v1.18.0 perf fix: the delta pull collects a page's notes and upserts them
 * as ONE Room transaction per page (insertNotes) instead of one transaction
 * per note. These tests pin the call shape (batch per page, no per-note
 * inserts) and that the per-note pending check still filters the batch.
 * The real REPLACE-by-primary-key semantics stay covered by the Room layer
 * itself — there is no Robolectric/instrumented Room harness in this module.
 */
class SyncManagerDeltaPullBatchTest {

    private lateinit var api: KeepLocalApi
    private lateinit var noteDao: NoteDao
    private lateinit var pendingDao: PendingOperationDao
    private lateinit var syncManager: SyncManager
    private lateinit var settings: SettingsDataStore

    private var storedSignature = ""
    private var storedSince = ""

    /** Every list handed to insertNotes, in call order. */
    private val batches = mutableListOf<List<NoteEntity>>()

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        noteDao = mockk(relaxed = true)
        pendingDao = mockk(relaxed = true)
        settings = mockk(relaxed = true)
        every { settings.syncSignature } returns flow { emit(storedSignature) }
        every { settings.syncSince } returns flow { emit(storedSince) }
        coEvery { settings.setSyncSignature(any()) } answers { storedSignature = firstArg() }
        coEvery { settings.setSyncSince(any()) } answers { storedSince = firstArg() }
        coEvery { noteDao.getAllLiveNotesSync() } returns emptyList()
        coEvery { noteDao.getAllArchivedNotesSync() } returns emptyList()
        coEvery { noteDao.insertNotes(any()) } answers { batches.add(firstArg()) }
        // Der Seiten-Insert läuft über die transaktionsgebundene Variante
        // mit Pending-Filter (Review v1.18.0) — sie liefert die Anzahl der
        // wirklich geschriebenen Zeilen.
        coEvery { noteDao.insertNotesSkippingPending(any()) } answers {
            val batch: List<NoteEntity> = firstArg()
            batches.add(batch)
            batch.size
        }
        coEvery { pendingDao.getAllOperations() } returns emptyList()
        coEvery { pendingDao.getCountForNote(any()) } returns 0
        coEvery { api.getNotesMeta() } returns Response.success(NotesMetaDto(active = 1))
        coEvery { api.getNoteTree() } returns Response.success(emptyList())
        coEvery {
            api.getNotes(any(), any(), eq(true), any(), any(), any(), any())
        } returns Response.success(NotesResponseDto(notes = emptyList(), pages = 1))
        syncManager = SyncManager(api, noteDao, pendingDao, settings)
    }

    private fun noteDto(id: String, updatedAt: String) = NoteDto(
        mongoId = id, title = "T $id", content = "C $id", updatedAt = updatedAt
    )

    private fun page(notes: List<NoteDto>, pages: Int = 1): Response<NotesResponseDto> =
        Response.success(NotesResponseDto(notes = notes, pages = pages))

    private fun stubActivePages(vararg pages: List<NoteDto>) {
        pages.forEachIndexed { index, notes ->
            coEvery {
                api.getNotes(any(), any(), eq(false), any(), eq(index + 1), any(), any())
            } returns page(notes, pages = pages.size)
        }
    }

    @Test
    fun `delta pull writes one batch per page instead of one insert per note`() = runTest {
        stubActivePages(
            listOf(
                noteDto("p1a", "2026-09-22T09:10:00.000Z"),
                noteDto("p1b", "2026-09-22T09:20:00.000Z"),
                noteDto("p1c", "2026-09-22T09:30:00.000Z")
            ),
            listOf(noteDto("p2a", "2026-09-22T09:40:00.000Z"))
        )

        val changed = syncManager.pullRemoteChanges()

        assertEquals(4, changed)
        coVerify(exactly = 2) { noteDao.insertNotesSkippingPending(any()) }
        coVerify(exactly = 0) { noteDao.insertNote(any()) }
        assertEquals(listOf("p1a", "p1b", "p1c"), batches[0].map { it.id })
        assertEquals(listOf("p2a"), batches[1].map { it.id })
        // Server updatedAt stays the optimistic-lock base, batch or not.
        assertTrue(batches[0].all { it.baseUpdatedAt != null })
        assertEquals("2026-09-22T09:40:00.000Z", storedSince)
    }

    @Test
    fun `queued note is left out of the page batch`() = runTest {
        stubActivePages(
            listOf(
                noteDto("p1a", "2026-09-22T09:10:00.000Z"),
                noteDto("p1b", "2026-09-22T09:20:00.000Z")
            )
        )
        // Late offline edit: not in the pre-pull snapshot, caught only by
        // the live per-note check — must never reach the batch insert.
        coEvery { pendingDao.getCountForNote("p1b") } returns 1

        val changed = syncManager.pullRemoteChanges()

        assertEquals(1, changed)
        coVerify(exactly = 1) { noteDao.insertNotesSkippingPending(any()) }
        coVerify(exactly = 0) { noteDao.insertNote(any()) }
        assertEquals(listOf("p1a"), batches.single().map { it.id })
    }

    @Test
    fun `an empty page does not issue a batch insert`() = runTest {
        stubActivePages(emptyList())

        assertEquals(0, syncManager.pullRemoteChanges())

        coVerify(exactly = 0) { noteDao.insertNotes(any()) }
        coVerify(exactly = 0) { noteDao.insertNote(any()) }
    }

    @Test
    fun `the page insert re-checks pending ops inside its own transaction`() = runTest {
        // Review v1.18.0: Der per-note Check oben lief VOR dem Seiten-Insert;
        // eine offline Änderung, die während des Seitenparsens landet, wirft
        // erst der transaktionsgebundene Filter wirklich raus.
        coEvery { noteDao.getPendingNoteIds() } returns listOf("p1b")
        // Der Default-Method-Körper läuft echt (callOriginal); was die interne
        // Transaktion wirklich an insertNotes übergibt, ist der gefilterte
        // Batch — genau den pinnen wir über das Recording.
        coEvery { noteDao.insertNotes(any()) } answers { batches.add(firstArg()) }
        coEvery { noteDao.insertNotesSkippingPending(any()) } answers { callOriginal() }
        stubActivePages(
            listOf(
                noteDto("p1a", "2026-09-22T09:10:00.000Z"),
                noteDto("p1b", "2026-09-22T09:20:00.000Z")
            )
        )

        val changed = syncManager.pullRemoteChanges()

        assertEquals(1, changed)
        assertEquals(listOf("p1a"), batches.single().map { it.id })
    }

    @Test
    fun `a pull that outlives a logout does not re-arm the old cursor`() = runTest {
        // Logout während des Pulls: der Signatur-Slot trägt den Wipe-Marker —
        // der Cursor darf nicht mehr für das nächste Konto zurückgeschrieben
        // werden (Review v1.18.0).
        every { settings.syncSignature } returns flow { emit(SettingsDataStore.SYNC_SIGNATURE_WIPED) }
        stubActivePages(listOf(noteDto("p1a", "2026-09-22T09:10:00.000Z")))

        val changed = syncManager.pullRemoteChanges()

        assertEquals(1, changed)
        coVerify(exactly = 0) { settings.setSyncSignature(any()) }
        coVerify(exactly = 0) { settings.setSyncSince(any()) }
    }
}
