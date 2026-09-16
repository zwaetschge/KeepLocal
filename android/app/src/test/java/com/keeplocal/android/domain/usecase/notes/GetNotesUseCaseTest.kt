package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteColor
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Instant

class GetNotesUseCaseTest {

    private lateinit var noteRepository: NoteRepository
    private lateinit var useCase: GetNotesUseCase

    private val testNotes = listOf(
        Note(
            id = "1", title = "Note 1", content = "Content 1",
            color = NoteColor.DEFAULT, isPinned = false, isArchived = false,
            isTodoList = false, todoItems = emptyList(), tags = emptyList(),
            sharedWith = emptyList(), owner = "user1", position = 0,
            createdAt = Instant.now(), updatedAt = Instant.now()
        )
    )

    @Before
    fun setup() {
        noteRepository = mockk()
        useCase = GetNotesUseCase(noteRepository)
    }

    @Test
    fun `invoke delegates to repository`() = runTest {
        every { noteRepository.getNotes(any(), any(), any()) } returns flowOf(Result.Success(testNotes))

        val result = useCase(search = "test", tag = "work", archived = false).first()

        assertTrue(result.isSuccess)
        assertEquals(testNotes, result.getOrNull())
        verify { noteRepository.getNotes(search = "test", tag = "work", archived = false) }
    }

    @Test
    fun `invoke with defaults passes null search and tag`() = runTest {
        every { noteRepository.getNotes(null, null, false) } returns flowOf(Result.Success(testNotes))

        val result = useCase().first()

        assertTrue(result.isSuccess)
        verify { noteRepository.getNotes(search = null, tag = null, archived = false) }
    }

    @Test
    fun `invoke passes archived flag`() = runTest {
        every { noteRepository.getNotes(null, null, true) } returns flowOf(Result.Success(emptyList()))

        val result = useCase(archived = true).first()

        assertTrue(result.isSuccess)
        assertEquals(emptyList<Note>(), result.getOrNull())
        verify { noteRepository.getNotes(search = null, tag = null, archived = true) }
    }

    @Test
    fun `error from repository is propagated`() = runTest {
        every { noteRepository.getNotes(any(), any(), any()) } returns flowOf(Result.Error("Network error"))

        val result = useCase().first()

        assertTrue(result.isError)
    }
}
