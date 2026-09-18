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

class TagUseCasesTest {

    private lateinit var repository: NoteRepository
    private lateinit var updatedNotes: MutableList<Note>

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

    private fun tagFlow(vararg notes: Note) = flowOf(Result.Success(notes.toList()))

    @Before
    fun setUp() {
        repository = mockk(relaxed = true)
        updatedNotes = mutableListOf()
        coEvery { repository.updateNote(capture(updatedNotes)) } answers {
            Result.Success(firstArg<Note>())
        }
    }

    @Test
    fun `rename rewrites the tag on every affected note`() = runTest {
        coEvery { repository.getNotes(tag = "einkauf") } returns tagFlow(
            note("a", "einkauf", "privat"),
            note("b", "einkauf")
        )

        val result = RenameTagUseCase(repository)("einkauf", "Einkauf 2026")

        assertEquals(Result.Success(2), result)
        assertEquals(2, updatedNotes.size)
        assertTrue(updatedNotes.any { it.id == "a" && it.tags == listOf("privat", "Einkauf 2026") })
        assertTrue(updatedNotes.any { it.id == "b" && it.tags == listOf("Einkauf 2026") })
    }

    @Test
    fun `rename onto an existing tag merges instead of duplicating`() = runTest {
        coEvery { repository.getNotes(tag = "shop") } returns tagFlow(
            note("a", "shop", "einkauf")
        )

        RenameTagUseCase(repository)("shop", "einkauf")

        assertEquals(listOf("einkauf"), updatedNotes.single().tags)
    }

    @Test
    fun `rename rejects identical names and blanks`() = runTest {
        val useCase = RenameTagUseCase(repository)
        assertTrue(useCase("x", "x") is Result.Error)
        assertTrue(useCase(" ", "y") is Result.Error)
        assertTrue(useCase("x", " ") is Result.Error)
        coVerify(exactly = 0) { repository.updateNote(any()) }
    }

    @Test
    fun `merge collapses several source tags into the target`() = runTest {
        coEvery { repository.getNotes(tag = "Einkauf") } returns tagFlow(note("a", "Einkauf", "privat"))
        coEvery { repository.getNotes(tag = "shopping") } returns tagFlow(
            note("b", "shopping", "Einkauf"), // carries two source tags
            note("c", "shopping")
        )

        val result = MergeTagsUseCase(repository)(listOf("Einkauf", "shopping"), "einkauf")

        assertEquals(Result.Success(3), result)
        val byId = updatedNotes.associateBy { it.id }
        assertEquals(listOf("privat", "einkauf"), byId.getValue("a").tags)
        assertEquals(listOf("einkauf"), byId.getValue("b").tags) // single target tag, not two
        assertEquals(listOf("einkauf"), byId.getValue("c").tags)
    }

    @Test
    fun `merge with only the target as source is rejected`() = runTest {
        val result = MergeTagsUseCase(repository)(listOf("einkauf"), "einkauf")
        assertTrue(result is Result.Error)
        coVerify(exactly = 0) { repository.updateNote(any()) }
    }

    @Test
    fun `delete removes the tag but keeps the notes`() = runTest {
        coEvery { repository.getNotes(tag = "alt") } returns tagFlow(note("a", "alt", "bleibt"))

        val result = DeleteTagUseCase(repository)("alt")

        assertEquals(Result.Success(1), result)
        assertEquals(listOf("bleibt"), updatedNotes.single().tags)
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
