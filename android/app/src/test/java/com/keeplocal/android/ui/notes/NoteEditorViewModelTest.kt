package com.keeplocal.android.ui.notes

import android.content.Context
import androidx.lifecycle.SavedStateHandle
import app.cash.turbine.test
import com.keeplocal.android.data.local.NoteDraftStore
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteColor
import com.keeplocal.android.domain.model.NoteImage
import com.keeplocal.android.domain.model.NoteTreeNode
import com.keeplocal.android.domain.repository.MediaRepository
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.domain.usecase.friends.GetFriendsUseCase
import com.keeplocal.android.domain.usecase.notes.CreateNoteUseCase
import com.keeplocal.android.domain.usecase.notes.GetBacklinksUseCase
import com.keeplocal.android.domain.usecase.notes.GetLinkPreviewUseCase
import com.keeplocal.android.domain.usecase.notes.GetNoteTreeUseCase
import com.keeplocal.android.domain.usecase.notes.GetNoteUseCase
import com.keeplocal.android.domain.usecase.notes.ShareNoteUseCase
import com.keeplocal.android.domain.usecase.notes.TogglePinUseCase
import com.keeplocal.android.domain.usecase.notes.UpdateNoteUseCase
import com.keeplocal.android.util.Result
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class NoteEditorViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var getNoteUseCase: GetNoteUseCase
    private lateinit var createNoteUseCase: CreateNoteUseCase
    private lateinit var updateNoteUseCase: UpdateNoteUseCase
    private lateinit var shareNoteUseCase: ShareNoteUseCase
    private lateinit var getFriendsUseCase: GetFriendsUseCase
    private lateinit var togglePinUseCase: TogglePinUseCase
    private lateinit var getLinkPreviewUseCase: GetLinkPreviewUseCase
    private lateinit var getNoteTreeUseCase: GetNoteTreeUseCase
    private lateinit var getBacklinksUseCase: GetBacklinksUseCase
    private lateinit var noteRepository: NoteRepository
    private lateinit var mediaRepository: MediaRepository
    private lateinit var settingsDataStore: SettingsDataStore
    private lateinit var noteDraftStore: NoteDraftStore
    private lateinit var context: Context

    private val testNote = Note(
        id = "1", title = "Test", content = "Content",
        color = NoteColor.BLUE, isPinned = false, isArchived = false,
        isTodoList = false, todoItems = emptyList(), tags = listOf("work"),
        sharedWith = emptyList(), owner = "user1", position = 0,
        createdAt = Instant.now(), updatedAt = Instant.now()
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        getNoteUseCase = mockk()
        createNoteUseCase = mockk()
        updateNoteUseCase = mockk()
        shareNoteUseCase = mockk()
        getFriendsUseCase = mockk()
        togglePinUseCase = mockk()
        getLinkPreviewUseCase = mockk()
        // v1.10.0: empty tree/backlinks keep tag suggestions and the
        // "Erwähnt in" section at defaults.
        getNoteTreeUseCase = mockk()
        coEvery { getNoteTreeUseCase() } returns Result.Success(emptyList<NoteTreeNode>())
        getBacklinksUseCase = mockk()
        coEvery { getBacklinksUseCase(any(), any()) } returns Result.Success(emptyList<Note>())
        noteRepository = mockk(relaxed = true)
        mediaRepository = mockk(relaxed = true)
        settingsDataStore = mockk {
            every { voiceTranscription } returns flowOf(true)
            every { tagColors } returns flowOf(emptyMap())
        }
        noteDraftStore = mockk(relaxed = true)
        context = mockk(relaxed = true)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel(noteId: String? = null): NoteEditorViewModel {
        val savedStateHandle = SavedStateHandle().apply {
            if (noteId != null) set("noteId", noteId)
        }
        return NoteEditorViewModel(
            savedStateHandle, getNoteUseCase, createNoteUseCase,
            updateNoteUseCase, shareNoteUseCase, getFriendsUseCase,
            togglePinUseCase, getLinkPreviewUseCase, getNoteTreeUseCase,
            getBacklinksUseCase, noteRepository, mediaRepository,
            settingsDataStore, noteDraftStore, context
        )
    }

    @Test
    fun `new note starts with empty state`() = runTest {
        val viewModel = createViewModel()
        val state = viewModel.uiState.value

        assertTrue(state.isNewNote)
        assertEquals("", state.title)
        assertEquals("", state.content)
        assertEquals(NoteColor.DEFAULT, state.color)
    }

    @Test
    fun `existing note loads from use case`() = runTest {
        coEvery { getNoteUseCase("1") } returns Result.Success(testNote)
        val viewModel = createViewModel(noteId = "1")
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertFalse(state.isNewNote)
        assertEquals("Test", state.title)
        assertEquals("Content", state.content)
        assertEquals(NoteColor.BLUE, state.color)
    }

    @Test
    fun `update title sets hasChanges`() = runTest {
        val viewModel = createViewModel()
        assertFalse(viewModel.uiState.value.hasChanges)

        viewModel.updateTitle("New Title")
        assertEquals("New Title", viewModel.uiState.value.title)
        assertTrue(viewModel.uiState.value.hasChanges)
    }

    @Test
    fun `update content sets hasChanges`() = runTest {
        val viewModel = createViewModel()
        viewModel.updateContent("New Content")
        assertEquals("New Content", viewModel.uiState.value.content)
        assertTrue(viewModel.uiState.value.hasChanges)
    }

    @Test
    fun `toggle todo list creates first item`() = runTest {
        val viewModel = createViewModel()
        viewModel.toggleTodoList()

        assertTrue(viewModel.uiState.value.isTodoList)
        assertEquals(1, viewModel.uiState.value.todoItems.size)
    }

    @Test
    fun `add and remove tags`() = runTest {
        val viewModel = createViewModel()

        viewModel.updateTagInput("test-tag")
        viewModel.addTag()

        assertEquals(listOf("test-tag"), viewModel.uiState.value.tags)
        assertEquals("", viewModel.uiState.value.tagInput)

        viewModel.removeTag("test-tag")
        assertTrue(viewModel.uiState.value.tags.isEmpty())
    }

    @Test
    fun `duplicate tags not added`() = runTest {
        val viewModel = createViewModel()

        viewModel.updateTagInput("tag1")
        viewModel.addTag()
        viewModel.updateTagInput("tag1")
        viewModel.addTag()

        assertEquals(1, viewModel.uiState.value.tags.size)
    }

    @Test
    fun `save new note calls createNoteUseCase`() = runTest {
        coEvery { createNoteUseCase(any()) } returns Result.Success(testNote)
        val viewModel = createViewModel()

        viewModel.updateTitle("New Note")
        viewModel.save()
        advanceUntilIdle()

        coVerify { createNoteUseCase(any()) }
    }

    @Test
    fun `save existing note calls updateNoteUseCase`() = runTest {
        coEvery { getNoteUseCase("1") } returns Result.Success(testNote)
        coEvery { updateNoteUseCase(any()) } returns Result.Success(testNote)
        val viewModel = createViewModel(noteId = "1")
        advanceUntilIdle()

        viewModel.updateTitle("Updated")
        viewModel.save()
        advanceUntilIdle()

        coVerify { updateNoteUseCase(any()) }
    }

    @Test
    fun `save empty note navigates back without saving`() = runTest {
        val viewModel = createViewModel()

        viewModel.navigateBack.test {
            viewModel.save()
            advanceUntilIdle()
            assertEquals(Unit, awaitItem())
        }

        coVerify(exactly = 0) { createNoteUseCase(any()) }
    }

    @Test
    fun `update color changes state`() = runTest {
        val viewModel = createViewModel()

        viewModel.updateColor(NoteColor.RED)
        assertEquals(NoteColor.RED, viewModel.uiState.value.color)
        assertTrue(viewModel.uiState.value.hasChanges)
    }

    @Test
    fun `todo item operations work correctly`() = runTest {
        val viewModel = createViewModel()
        viewModel.toggleTodoList()

        val initialId = viewModel.uiState.value.todoItems[0].id
        viewModel.updateTodoItem(0, "Buy milk")
        assertEquals("Buy milk", viewModel.uiState.value.todoItems[0].text)

        viewModel.toggleTodoItemCompleted(0)
        assertTrue(viewModel.uiState.value.todoItems[0].isCompleted)

        viewModel.addTodoItem()
        assertEquals(2, viewModel.uiState.value.todoItems.size)

        viewModel.removeTodoItem(1)
        assertEquals(1, viewModel.uiState.value.todoItems.size)
    }

    @Test
    fun `save failure surfaces mapped error message`() = runTest {
        coEvery { getNoteUseCase("1") } returns Result.Success(testNote)
        coEvery { updateNoteUseCase(any()) } returns Result.Error("Updating note failed (HTTP 500)")
        val viewModel = createViewModel(noteId = "1")
        advanceUntilIdle()

        viewModel.updateTitle("Updated")
        viewModel.save()
        // runCurrent, not advanceUntilIdle: full advancement would also fire
        // the 4s auto-clear job, and the message would already be gone.
        runCurrent()

        assertEquals("Updating note failed (HTTP 500)", viewModel.uiState.value.errorMessage)
    }

    @Test
    fun `error message clears itself after four seconds`() = runTest {
        coEvery { getNoteUseCase("1") } returns Result.Success(testNote)
        coEvery { updateNoteUseCase(any()) } returns Result.Error("boom")
        val viewModel = createViewModel(noteId = "1")
        advanceUntilIdle()

        viewModel.updateTitle("Updated")
        viewModel.save()
        // runCurrent only: advanceUntilIdle would run the 4s clear job too.
        runCurrent()
        assertNotNull(viewModel.uiState.value.errorMessage)

        advanceTimeBy(4001)
        runCurrent()
        assertNull(viewModel.uiState.value.errorMessage)
    }

    @Test
    fun `loaded note keeps its optimistic locking base`() = runTest {
        val base = Instant.parse("2026-09-06T10:00:00Z")
        coEvery { getNoteUseCase("1") } returns Result.Success(testNote.copy(baseUpdatedAt = base))
        val viewModel = createViewModel(noteId = "1")
        advanceUntilIdle()

        assertEquals(base, viewModel.uiState.value.baseUpdatedAt)

        coEvery { updateNoteUseCase(any()) } returns Result.Success(testNote)
        viewModel.updateTitle("Updated")
        viewModel.save()
        advanceUntilIdle()

        coVerify {
            updateNoteUseCase(match { it.baseUpdatedAt == base })
        }
    }

    // --- media: images & dictation ---

    @Test
    fun `append transcription separates with blank line`() {
        assertEquals("Text", appendTranscription("", "Text"))
        assertEquals("Text", appendTranscription("   ", "Text"))
        assertEquals("One\n\nTwo", appendTranscription("One ", "Two"))
        assertEquals("Keep", appendTranscription("Keep", "   "))
    }

    @Test
    fun `picking images for unsaved note only shows hint`() = runTest {
        val viewModel = createViewModel()
        viewModel.onImagesPicked(listOf(mockk()))

        assertNotNull(viewModel.uiState.value.mediaHint)
        coVerify(exactly = 0) { mediaRepository.uploadImages(any(), any()) }
    }

    @Test
    fun `image upload updates images from server response`() = runTest {
        val images = listOf(
            NoteImage(filename = "a.webp", url = "/uploads/images/a.webp", thumbnailUrl = "/uploads/images/a_t.webp")
        )
        coEvery { getNoteUseCase("1") } returns Result.Success(testNote)
        coEvery { mediaRepository.uploadImages("1", any()) } returns Result.Success(testNote.copy(images = images))
        val viewModel = createViewModel(noteId = "1")
        advanceUntilIdle()

        viewModel.onImagesPicked(listOf(mockk()))
        advanceUntilIdle()

        assertEquals(images, viewModel.uiState.value.images)
        assertEquals(0, viewModel.uiState.value.uploadingImageCount)
    }

    @Test
    fun `image selection beyond per-note limit is clamped with hint`() = runTest {
        val existing = (1..23).map { NoteImage(filename = "i$it", url = "/uploads/images/i$it") }
        coEvery { getNoteUseCase("1") } returns Result.Success(testNote.copy(images = existing))
        coEvery { mediaRepository.uploadImages("1", any()) } returns Result.Success(testNote.copy(images = existing))
        val viewModel = createViewModel(noteId = "1")
        advanceUntilIdle()

        viewModel.onImagesPicked(List(5) { mockk() })
        advanceUntilIdle()

        assertNotNull(viewModel.uiState.value.mediaHint)
        coVerify { mediaRepository.uploadImages("1", match { uris -> uris.size == 2 }) }
    }

    @Test
    fun `image limit reached uploads nothing`() = runTest {
        val existing = (1..25).map { NoteImage(filename = "i$it", url = "/uploads/images/i$it") }
        coEvery { getNoteUseCase("1") } returns Result.Success(testNote.copy(images = existing))
        val viewModel = createViewModel(noteId = "1")
        advanceUntilIdle()

        viewModel.onImagesPicked(List(3) { mockk() })
        advanceUntilIdle()

        coVerify(exactly = 0) { mediaRepository.uploadImages(any(), any()) }
    }

    @Test
    fun `offline upload failure shows offline hint`() = runTest {
        coEvery { getNoteUseCase("1") } returns Result.Success(testNote)
        coEvery { mediaRepository.uploadImages("1", any()) } returns
            Result.Error("Unable to resolve host", java.io.IOException())
        val viewModel = createViewModel(noteId = "1")
        advanceUntilIdle()

        viewModel.onImagesPicked(listOf(mockk()))
        // runCurrent only — advanceUntilIdle would fire the 4s error auto-clear.
        runCurrent()

        assertEquals("Bilder können nur online hochgeladen werden", viewModel.uiState.value.errorMessage)
        assertEquals(0, viewModel.uiState.value.uploadingImageCount)
    }

    @Test
    fun `delete image updates note images`() = runTest {
        val images = listOf(NoteImage(filename = "a.webp", url = "/uploads/images/a.webp"))
        coEvery { getNoteUseCase("1") } returns Result.Success(testNote.copy(images = images))
        coEvery { mediaRepository.deleteImage("1", "a.webp") } returns Result.Success(testNote.copy(images = emptyList()))
        val viewModel = createViewModel(noteId = "1")
        advanceUntilIdle()

        viewModel.deleteImage(images.first())
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.images.isEmpty())
    }

    @Test
    fun `mic on unsaved note shows save-first hint`() = runTest {
        val viewModel = createViewModel()

        viewModel.onMicClicked()

        assertNotNull(viewModel.uiState.value.mediaHint)
        assertFalse(viewModel.uiState.value.isRecording)
        assertFalse(viewModel.uiState.value.isTranscribing)
    }

    @Test
    fun `mic on offline note shows save-first hint`() = runTest {
        coEvery { getNoteUseCase("offline_1") } returns Result.Success(testNote.copy(id = "offline_1"))
        val viewModel = createViewModel(noteId = "offline_1")
        advanceUntilIdle()

        viewModel.onMicClicked()

        assertNotNull(viewModel.uiState.value.mediaHint)
    }

    @Test
    fun `recording permission denial shows hint`() = runTest {
        val viewModel = createViewModel()

        viewModel.onRecordingPermissionDenied()

        assertNotNull(viewModel.uiState.value.mediaHint)
    }
}
