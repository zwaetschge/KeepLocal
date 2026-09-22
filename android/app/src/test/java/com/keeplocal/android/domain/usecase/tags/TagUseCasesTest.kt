package com.keeplocal.android.domain.usecase.tags

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteColor
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Instant

// v1.14.0 Nr. 4: Rename/Merge/Delete laufen als EIN applyTagOperation pro
// Aktion (Server-updateMany) statt einem updateNote pro Notiz. Gepinnt ist
// die Delegation — was die Notizen am Ende tragen, entscheidet der Server.

class TagUseCasesTest {

    private lateinit var repository: NoteRepository
    private val bulkCalls = mutableListOf<Triple<String, List<String>, String?>>()

    private fun note(id: String, vararg tags: String) = Note(
        id = id,
        title = id,
        content = "",
        color = NoteColor.DEFAULT,
        isPinned = false,
        isArchived = false,
        isTodoList = false,
        todoItems = emptyList(),
        tags = tags.toList(),
        sharedWith = emptyList(),
        owner = "u",
        position = 0,
        createdAt = Instant.EPOCH,
        updatedAt = Instant.EPOCH
    )

    @Before
    fun setUp() {
        repository = mockk(relaxed = true)
        coEvery { repository.applyTagOperation(any(), any(), any()) } answers {
            bulkCalls += Triple(firstArg(), secondArg(), thirdArg())
            Result.Success(3)
        }
    }

    @Test
    fun `rename delegates one bulk call and passes the count through`() = runTest {
        val result = RenameTagUseCase(repository)("  einkauf ", "Einkauf 2026")

        assertEquals(Result.Success(3), result)
        assertEquals(listOf(Triple("rename", listOf("einkauf"), "Einkauf 2026")), bulkCalls)
        coVerify(exactly = 0) { repository.updateNote(any()) }
    }

    @Test
    fun `merge sends all sources in one request`() = runTest {
        MergeTagsUseCase(repository)(listOf(" Einkauf ", "shopping", "Einkauf"), "einkauf")

        // Getrimmt und distinct — Quell-Tags, die dem Ziel entsprechen,
        // filtert der Server selbst heraus (setUnion, kein Doppeltag).
        assertEquals(
            listOf(Triple("merge", listOf("Einkauf", "shopping"), "einkauf")),
            bulkCalls
        )
    }

    @Test
    fun `merge with only the target as source delegates as a server-side no-op`() = runTest {
        // Vor v1.14.0 war das ein lokaler Fehler; der Server behandelt es als
        // No-Op mit modified=0 — ehrlicher als eine Fehlermeldung.
        val result = MergeTagsUseCase(repository)(listOf("einkauf"), "einkauf")

        assertEquals(Result.Success(3), result)
        assertEquals(1, bulkCalls.size)
    }

    @Test
    fun `rename rejects identical names and blanks before any request`() = runTest {
        val useCase = RenameTagUseCase(repository)
        assertTrue(useCase("x", "x") is Result.Error)
        assertTrue(useCase(" ", "y") is Result.Error)
        assertTrue(useCase("x", " ") is Result.Error)
        assertTrue(bulkCalls.isEmpty())
    }

    @Test
    fun `delete delegates one bulk call without a target`() = runTest {
        val result = DeleteTagUseCase(repository)("  alt ")

        assertEquals(Result.Success(3), result)
        assertEquals(listOf(Triple("delete", listOf("alt"), null)), bulkCalls)
    }

    @Test
    fun `delete rejects blanks before any request`() = runTest {
        assertTrue(DeleteTagUseCase(repository)("  ") is Result.Error)
        assertTrue(bulkCalls.isEmpty())
    }

    @Test
    fun `overview counts tags across live and archived notes`() = runTest {
        coEvery {
            repository.getCachedNotes(search = any(), archived = false, sortMode = any(), limit = any(), filter = any())
        } returns flowOf(Result.Success(listOf(note("a", "x", "y"), note("b", "x"))))
        coEvery {
            repository.getCachedNotes(search = any(), archived = true, sortMode = any(), limit = any(), filter = any())
        } returns flowOf(Result.Success(listOf(note("c", "y"), note("d", "y"))))

        val tags = (GetTagsUseCase(repository)() as Result.Success).data

        assertEquals(
            listOf(TagOverview("y", 3), TagOverview("x", 2)),
            tags
        )
    }
}
