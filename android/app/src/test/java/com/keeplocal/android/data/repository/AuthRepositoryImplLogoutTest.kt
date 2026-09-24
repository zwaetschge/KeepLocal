package com.keeplocal.android.data.repository

import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.data.local.TokenManager
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.dao.PendingOperationDao
import com.keeplocal.android.util.FileLogger
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.coVerifyOrder
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * v1.18.0-Review: Der Logout wischt die lokalen Daten des Kontos. Die drei
 * Schritte sind bewusst unabhängig — EIN fehlgeschlagener Room-Call darf die
 * anderen nicht überspringen, und die Queue geht zuerst: Ihre Ops dürfen nie
 * unter dem NÄCHSTEN Konto abspielen.
 */
class AuthRepositoryImplLogoutTest {

    private fun repository(
        noteDao: NoteDao,
        pendingDao: PendingOperationDao,
        settings: SettingsDataStore
    ): AuthRepositoryImpl = AuthRepositoryImpl(
        api = mockk(relaxed = true),      // logout() toleriert ein totes Netz
        tokenManager = mockk(relaxed = true),
        settingsDataStore = settings,
        okHttpClient = mockk(relaxed = true),
        cookieJar = mockk(relaxed = true),
        noteDao = noteDao,
        pendingOperationDao = pendingDao,
        fileLogger = mockk(relaxed = true)
    )

    @Test
    fun `logout wipes the queue first, then the cache, then the sync cursor`() = runTest {
        val noteDao = mockk<NoteDao>(relaxed = true)
        val pendingDao = mockk<PendingOperationDao>(relaxed = true)
        val settings = mockk<SettingsDataStore>(relaxed = true)
        val repo = repository(noteDao, pendingDao, settings)

        val result = repo.logout()

        assertTrue(result.isSuccess)
        coVerifyOrder {
            pendingDao.deleteAll()
            noteDao.deleteAll()
            settings.setSyncSignature(SettingsDataStore.SYNC_SIGNATURE_WIPED)
            settings.setSyncSince("")
        }
    }

    @Test
    fun `a failing note wipe still resets the sync cursor`() = runTest {
        val noteDao = mockk<NoteDao>(relaxed = true)
        coEvery { noteDao.deleteAll() } throws RuntimeException("db locked")
        val settings = mockk<SettingsDataStore>(relaxed = true)
        val repo = repository(noteDao, mockk(relaxed = true), settings)

        val result = repo.logout()

        // Logout scheitert NICHT an der Datenbank — und der Cursor-Reset
        // erzwingt den vollen Pull, der Stable-Reihen auch fremde Rows nimmt.
        assertTrue(result.isSuccess)
        coVerify(exactly = 1) { settings.setSyncSignature(SettingsDataStore.SYNC_SIGNATURE_WIPED) }
        coVerify(exactly = 1) { settings.setSyncSince("") }
    }

    @Test
    fun `a failing queue wipe still clears the note cache`() = runTest {
        val pendingDao = mockk<PendingOperationDao>(relaxed = true)
        coEvery { pendingDao.deleteAll() } throws RuntimeException("disk full")
        val noteDao = mockk<NoteDao>(relaxed = true)
        val repo = repository(noteDao, pendingDao, mockk(relaxed = true))

        val result = repo.logout()

        assertTrue(result.isSuccess)
        coVerify(exactly = 1) { noteDao.deleteAll() }
    }
}
