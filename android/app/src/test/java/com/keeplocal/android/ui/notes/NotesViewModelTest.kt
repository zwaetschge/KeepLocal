package com.keeplocal.android.ui.notes

import app.cash.turbine.test
import android.content.Context
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.data.local.SyncManager
import com.keeplocal.android.data.local.SyncResult
import com.keeplocal.android.data.local.SyncStatus
import com.keeplocal.android.domain.model.Friend
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteColor
import com.keeplocal.android.domain.model.NoteTreeNode
import com.keeplocal.android.domain.usecase.auth.GetCurrentUserUseCase
import com.keeplocal.android.domain.usecase.friends.GetFriendsUseCase
import com.keeplocal.android.domain.usecase.notes.DeleteNoteUseCase
import com.keeplocal.android.domain.usecase.notes.DuplicateNoteUseCase
import com.keeplocal.android.domain.usecase.notes.FindOrCreateTodayNoteUseCase
import com.keeplocal.android.domain.usecase.notes.GetNoteTreeUseCase
import com.keeplocal.android.domain.usecase.notes.GetNotesUseCase
import com.keeplocal.android.domain.usecase.notes.MoveNoteUseCase
import com.keeplocal.android.domain.usecase.notes.ReorderNotesUseCase
import com.keeplocal.android.domain.usecase.notes.ToggleArchiveUseCase
import com.keeplocal.android.domain.usecase.notes.TogglePinUseCase
import com.keeplocal.android.domain.usecase.notes.UndoDeleteUseCase
import com.keeplocal.android.domain.usecase.notes.UpdateNoteUseCase
import com.keeplocal.android.util.Result
import com.keeplocal.android.util.UiState
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flow
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Instant

@OptIn(ExperimentalCoroutinesApi::class)
class NotesViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var getNotesUseCase: GetNotesUseCase
    private lateinit var togglePinUseCase: TogglePinUseCase
    private lateinit var toggleArchiveUseCase: ToggleArchiveUseCase
    private lateinit var deleteNoteUseCase: DeleteNoteUseCase
    private lateinit var updateNoteUseCase: UpdateNoteUseCase
    private lateinit var reorderNotesUseCase: ReorderNotesUseCase
    private lateinit var undoDeleteUseCase: UndoDeleteUseCase
    private lateinit var getCurrentUserUseCase: GetCurrentUserUseCase
    private lateinit var getFriendsUseCase: GetFriendsUseCase
    private lateinit var duplicateNoteUseCase: DuplicateNoteUseCase
    private lateinit var getNoteTreeUseCase: GetNoteTreeUseCase
    private lateinit var moveNoteUseCase: MoveNoteUseCase
    private lateinit var findOrCreateTodayNoteUseCase: FindOrCreateTodayNoteUseCase
    private lateinit var settingsDataStore: SettingsDataStore
    private lateinit var syncManager: SyncManager
    private lateinit var appContext: Context

    private val testNotes = listOf(
        Note(
            id = "1", title = "Test Note", content = "Content",
            color = NoteColor.DEFAULT, isPinned = false, isArchived = false,
            isTodoList = false, todoItems = emptyList(), tags = listOf("work"),
            sharedWith = emptyList(), owner = "user1", position = 0,
            createdAt = Instant.now(), updatedAt = Instant.now()
        ),
        Note(
            id = "2", title = "Pinned Note", content = "Pinned",
            color = NoteColor.BLUE, isPinned = true, isArchived = false,
            isTodoList = false, todoItems = emptyList(), tags = listOf("personal"),
            sharedWith = emptyList(), owner = "user1", position = 1,
            createdAt = Instant.now(), updatedAt = Instant.now()
        )
    )

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        getNotesUseCase = mockk()
        togglePinUseCase = mockk()
        toggleArchiveUseCase = mockk()
        deleteNoteUseCase = mockk()
        updateNoteUseCase = mockk()
        reorderNotesUseCase = mockk()
        undoDeleteUseCase = mockk()
        getCurrentUserUseCase = mockk()
        getFriendsUseCase = mockk()
        duplicateNoteUseCase = mockk()
        // v1.10.0 tree/move/journal plumbing; the empty tree keeps the
        // sidebar state at defaults.
        getNoteTreeUseCase = mockk()
        coEvery { getNoteTreeUseCase() } returns Result.Success(emptyList())
        moveNoteUseCase = mockk()
        findOrCreateTodayNoteUseCase = mockk()
        coEvery { getCurrentUserUseCase() } returns Result.Error("no session")
        coEvery { getFriendsUseCase() } returns Result.Success(emptyList<Friend>())
        settingsDataStore = mockk(relaxed = true) {
            every { noteViewMode } returns flowOf("grid")
            // Flows must be real: collecting a relaxed-mock Flow throws.
            every { sortMode } returns flowOf("manual")
            every { lastSyncAt } returns flowOf(0L)
            every { tagColors } returns flowOf(emptyMap())
            every { savedSearches } returns flowOf(emptyList())
        }
        syncManager = mockk {
            every { syncStatus } returns MutableStateFlow(SyncStatus())
        }
        // Only used inside runCatching for the widget refresh: a bare mock
        // makes Glance fail there, which the view model swallows by design.
        appContext = mockk()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel(): NotesViewModel {
        every { getNotesUseCase(any(), any(), any(), any(), any(), any(), any()) } returns flowOf(Result.Success(testNotes))
        return NotesViewModel(getNotesUseCase, togglePinUseCase, toggleArchiveUseCase, deleteNoteUseCase, updateNoteUseCase, reorderNotesUseCase, undoDeleteUseCase, getCurrentUserUseCase, getFriendsUseCase, duplicateNoteUseCase, getNoteTreeUseCase, moveNoteUseCase, findOrCreateTodayNoteUseCase, settingsDataStore, syncManager, appContext)
    }

    @Test
    fun `init loads notes successfully`() = runTest {
        val viewModel = createViewModel()
        advanceUntilIdle()

        val state = viewModel.uiState.value
        assertTrue(state.notes is UiState.Success)
        assertEquals(testNotes, (state.notes as UiState.Success).data)
    }

    @Test
    fun `init shows empty state when no notes`() = runTest {
        every { getNotesUseCase(any(), any(), any(), any(), any(), any(), any()) } returns flowOf(Result.Success(emptyList()))
        val viewModel = NotesViewModel(getNotesUseCase, togglePinUseCase, toggleArchiveUseCase, deleteNoteUseCase, updateNoteUseCase, reorderNotesUseCase, undoDeleteUseCase, getCurrentUserUseCase, getFriendsUseCase, duplicateNoteUseCase, getNoteTreeUseCase, moveNoteUseCase, findOrCreateTodayNoteUseCase, settingsDataStore, syncManager, appContext)
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.notes is UiState.Empty)
    }

    @Test
    fun `init shows error state on failure`() = runTest {
        every { getNotesUseCase(any(), any(), any(), any(), any(), any(), any()) } returns flowOf(Result.Error("Network error"))
        val viewModel = NotesViewModel(getNotesUseCase, togglePinUseCase, toggleArchiveUseCase, deleteNoteUseCase, updateNoteUseCase, reorderNotesUseCase, undoDeleteUseCase, getCurrentUserUseCase, getFriendsUseCase, duplicateNoteUseCase, getNoteTreeUseCase, moveNoteUseCase, findOrCreateTodayNoteUseCase, settingsDataStore, syncManager, appContext)
        advanceUntilIdle()

        assertTrue(viewModel.uiState.value.notes is UiState.Error)
    }

    @Test
    fun `search updates query and reloads`() = runTest {
        val viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.onSearchQueryChanged("test")
        advanceUntilIdle()
        assertEquals("test", viewModel.uiState.value.searchQuery)
    }

    @Test
    fun `rapid search input debounces into a single reload`() = runTest {
        val queries = mutableListOf<String?>()
        every { getNotesUseCase(any(), any(), any(), any(), any(), any(), any()) } answers {
            queries.add(firstArg())
            flowOf(Result.Success(testNotes))
        }
        // Constructed directly: createViewModel() would overwrite the
        // recording stub above with its default flowOf stub.
        val viewModel = NotesViewModel(getNotesUseCase, togglePinUseCase, toggleArchiveUseCase, deleteNoteUseCase, updateNoteUseCase, reorderNotesUseCase, undoDeleteUseCase, getCurrentUserUseCase, getFriendsUseCase, duplicateNoteUseCase, getNoteTreeUseCase, moveNoteUseCase, findOrCreateTodayNoteUseCase, settingsDataStore, syncManager, appContext)
        advanceUntilIdle()
        assertEquals(listOf<String?>(null), queries)

        viewModel.onSearchQueryChanged("a")
        advanceTimeBy(100)
        viewModel.onSearchQueryChanged("ab")
        advanceTimeBy(100)
        viewModel.onSearchQueryChanged("abc")

        // 299ms after the last keystroke: still only the initial load ran.
        advanceTimeBy(299)
        assertEquals(listOf<String?>(null), queries)

        advanceTimeBy(1)
        advanceUntilIdle()
        assertEquals("debounce must fire exactly once, with the final query", listOf<String?>(null, "abc"), queries)
    }

    @Test
    fun `stale load jobs are cancelled when a new one starts`() = runTest {
        var active = 0
        every { getNotesUseCase(any(), any(), any(), any(), any(), any(), any()) } answers {
            flow<Result<List<Note>>> {
                active++
                try {
                    kotlinx.coroutines.awaitCancellation()
                } finally {
                    active--
                }
            }
        }
        // Constructed directly, as above: the recording stub must survive
        // until the view model starts collecting.
        val viewModel = NotesViewModel(getNotesUseCase, togglePinUseCase, toggleArchiveUseCase, deleteNoteUseCase, updateNoteUseCase, reorderNotesUseCase, undoDeleteUseCase, getCurrentUserUseCase, getFriendsUseCase, duplicateNoteUseCase, getNoteTreeUseCase, moveNoteUseCase, findOrCreateTodayNoteUseCase, settingsDataStore, syncManager, appContext)
        advanceUntilIdle()
        assertEquals(1, active)

        viewModel.onTagSelected("work")
        runCurrent()
        assertEquals(1, active) // previous collector already released

        viewModel.toggleArchiveView(true)
        runCurrent()
        assertEquals("only the newest load may be collecting", 1, active)

        assertTrue(viewModel.uiState.value.notes is UiState.Loading)
    }

    @Test
    fun `failed sync status maps to the retry banner`() = runTest {
        every { syncManager.syncStatus } returns MutableStateFlow(SyncStatus(failedCount = 3))
        val viewModel = createViewModel()
        advanceUntilIdle()

        assertEquals(SyncBanner.Failed(3), viewModel.uiState.value.syncBanner)
    }

    @Test
    fun `pending offline changes map to the syncing banner`() = runTest {
        every { syncManager.syncStatus } returns MutableStateFlow(SyncStatus(pendingCount = 2))
        val viewModel = createViewModel()
        advanceUntilIdle()

        assertEquals(SyncBanner.Syncing(2), viewModel.uiState.value.syncBanner)
    }

    @Test
    fun `auth required status emits the relogin event once`() = runTest {
        val status = MutableStateFlow(SyncStatus())
        every { syncManager.syncStatus } returns status
        val viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.reloginEvent.test {
            status.value = SyncStatus(authRequired = true, failedCount = 1)
            assertEquals(Unit, awaitItem())

            // A re-emission of the same auth state must not re-trigger navigation.
            status.value = SyncStatus(authRequired = true, failedCount = 2)
            expectNoEvents()
        }
        assertEquals(SyncBanner.AuthRequired, viewModel.uiState.value.syncBanner)
    }

    @Test
    fun `retry sync runs the queue and reloads`() = runTest {
        coEvery { syncManager.syncPendingOperations() } returns SyncResult(1, 0)
        val viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.retrySync()
        advanceUntilIdle()

        coVerify(exactly = 1) { syncManager.syncPendingOperations() }
        verify(atLeast = 2) { getNotesUseCase(any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `toggle selection adds and removes notes`() = runTest {
        val viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.toggleNoteSelection("1")
        assertTrue(viewModel.uiState.value.isMultiSelectMode)
        assertTrue("1" in viewModel.uiState.value.selectedNoteIds)

        viewModel.toggleNoteSelection("1")
        assertFalse(viewModel.uiState.value.isMultiSelectMode)
        assertTrue(viewModel.uiState.value.selectedNoteIds.isEmpty())
    }

    @Test
    fun `clear selection resets multi-select mode`() = runTest {
        val viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.toggleNoteSelection("1")
        viewModel.toggleNoteSelection("2")
        assertTrue(viewModel.uiState.value.isMultiSelectMode)

        viewModel.clearSelection()
        assertFalse(viewModel.uiState.value.isMultiSelectMode)
        assertTrue(viewModel.uiState.value.selectedNoteIds.isEmpty())
    }

    @Test
    fun `toggle archive view switches between notes and archived`() = runTest {
        val viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.toggleArchiveView(true)
        assertTrue(viewModel.uiState.value.showArchived)

        viewModel.toggleArchiveView(false)
        assertFalse(viewModel.uiState.value.showArchived)
    }

    @Test
    fun `delete note calls use case`() = runTest {
        val viewModel = createViewModel()
        advanceUntilIdle()
        coEvery { deleteNoteUseCase(any()) } returns Result.Success(Unit)

        viewModel.deleteNote("1")
        advanceUntilIdle()

        coVerify { deleteNoteUseCase("1") }
    }

    @Test
    fun `available tags extracted from notes`() = runTest {
        val viewModel = createViewModel()
        advanceUntilIdle()

        val tags = viewModel.uiState.value.availableTags
        assertEquals(listOf("personal", "work"), tags)
    }

    @Test
    fun `available tags follow the whole tree`() = runTest {
        // v1.10.0: the sidebar lists the library's tags, not just the page.
        coEvery { getNoteTreeUseCase() } returns Result.Success(
            listOf(
                NoteTreeNode(testNotes[0], 0, emptyList()),
                NoteTreeNode(testNotes[1], 0, emptyList())
            )
        )
        val viewModel = createViewModel()
        advanceUntilIdle()

        assertEquals(listOf("personal", "work"), viewModel.uiState.value.availableTags)
    }

    @Test
    fun `tag selection filters notes`() = runTest {
        val viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.onTagSelected("work")
        assertEquals("work", viewModel.uiState.value.selectedTag)

        viewModel.onTagSelected(null)
        assertEquals(null, viewModel.uiState.value.selectedTag)
    }

    @Test
    fun `refresh sets isRefreshing then clears it`() = runTest {
        val viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.refresh()
        advanceUntilIdle()

        assertFalse(viewModel.uiState.value.isRefreshing)
    }
}
