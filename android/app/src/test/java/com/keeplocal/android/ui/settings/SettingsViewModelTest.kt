package com.keeplocal.android.ui.settings

import android.content.Context
import com.keeplocal.android.R
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.data.local.TokenManager
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.dao.PendingOperationDao
import com.keeplocal.android.data.repository.ApiKeyRepository
import com.keeplocal.android.domain.repository.AuthRepository
import com.keeplocal.android.domain.usecase.auth.ChangePasswordUseCase
import com.keeplocal.android.domain.usecase.notes.ExportNotesUseCase
import com.keeplocal.android.util.FileLogger
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class SettingsViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private lateinit var settingsDataStore: SettingsDataStore
    private lateinit var authRepository: AuthRepository
    private lateinit var tokenManager: TokenManager
    private lateinit var noteDao: NoteDao
    private lateinit var pendingOperationDao: PendingOperationDao
    private lateinit var apiKeyRepository: ApiKeyRepository
    private lateinit var changePasswordUseCase: ChangePasswordUseCase
    private lateinit var exportNotesUseCase: ExportNotesUseCase
    private lateinit var fileLogger: FileLogger
    private lateinit var context: Context

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        settingsDataStore = mockk(relaxed = true) {
            every { serverUrl } returns flowOf("")
            every { themeMode } returns flowOf("system")
            every { language } returns flowOf("en")
            every { rememberCredentials } returns flowOf(false)
            every { autheliaEnabled } returns flowOf(false)
            every { biometricLock } returns flowOf(false)
            every { backgroundSync } returns flowOf(true)
            every { noteViewMode } returns flowOf("grid")
            every { voiceTranscription } returns flowOf(true)
            every { materialYou } returns flowOf(false)
        }
        authRepository = mockk()
        tokenManager = mockk(relaxed = true)
        noteDao = mockk(relaxed = true)
        pendingOperationDao = mockk(relaxed = true)
        apiKeyRepository = mockk()
        changePasswordUseCase = mockk()
        exportNotesUseCase = mockk()
        fileLogger = mockk(relaxed = true)
        // getString is only used to build user-facing messages. Matched with
        // concrete values: matchers on Android's vararg overload do not match
        // reliably, which used to drop the call into the error path.
        context = mockk {
            every { getString(any()) } answers { firstArg<Int>().toString() }
        }
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun createViewModel(): SettingsViewModel =
        SettingsViewModel(
            context, settingsDataStore, authRepository, tokenManager, noteDao,
            pendingOperationDao, apiKeyRepository, changePasswordUseCase,
            exportNotesUseCase, fileLogger
        )

    @Test
    fun `clear cache deletes only synced notes and reports kept offline notes`() = runTest {
        coEvery { noteDao.countPendingNoteIds() } returns 5
        every { context.getString(R.string.settings_cache_cleared_kept, 5) } returns "kept 5 offline notes"
        val viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.clearCache()
        advanceUntilIdle()

        coVerify(exactly = 1) { noteDao.deleteSyncedNotes() }
        coVerify(exactly = 0) { noteDao.deleteAll() }
        coVerify(exactly = 1) { fileLogger.clear() }

        val message = viewModel.uiState.value.message
        assertNotNull(message)
        assertTrue(message!!.contains("5"))
    }

    @Test
    fun `clear cache with nothing pending still avoids deleteAll`() = runTest {
        coEvery { noteDao.countPendingNoteIds() } returns 0
        every { context.getString(R.string.settings_cache_cleared_kept, 0) } returns "kept 0 offline notes"
        val viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.clearCache()
        advanceUntilIdle()

        coVerify(exactly = 1) { noteDao.deleteSyncedNotes() }
        coVerify(exactly = 0) { noteDao.deleteAll() }

        val message = viewModel.uiState.value.message
        assertNotNull(message)
        assertTrue(message!!.contains("0"))
    }

    @Test
    fun `clear cache failure shows generic error and deletes nothing`() = runTest {
        coEvery { noteDao.countPendingNoteIds() } returns 3
        coEvery { noteDao.deleteSyncedNotes() } throws RuntimeException("db locked")
        val viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.clearCache()
        advanceUntilIdle()

        coVerify(exactly = 0) { noteDao.deleteAll() }
        coVerify(exactly = 0) { fileLogger.clear() }
        assertNotNull(viewModel.uiState.value.message)
    }

    @Test
    fun `disabling remember credentials clears stored credentials`() = runTest {
        val viewModel = createViewModel()
        advanceUntilIdle()

        viewModel.toggleRememberCredentials() // off -> on
        viewModel.toggleRememberCredentials() // on -> off: forget secrets
        advanceUntilIdle()

        coVerify(atLeast = 1) { tokenManager.clearCredentials() }
    }
}
