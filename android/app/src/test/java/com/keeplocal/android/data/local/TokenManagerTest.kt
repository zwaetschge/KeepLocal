package com.keeplocal.android.data.local

import android.content.Context
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Tests the credential round-trip against an in-memory fake, because the
 * real EncryptedCredentialsStore needs a keystore-backed Android device.
 * Token accessors are not covered here — they go through the same encrypted
 * prefs and are exercised by the integration build.
 */
class TokenManagerTest {

    private class FakeCredentialsStore : CredentialsStore {
        val data = mutableMapOf<String, String>()

        override fun save(email: String, password: String) {
            data["email"] = email
            data["password"] = password
        }

        override fun load(): SavedCredentials? {
            val email = data["email"] ?: return null
            val password = data["password"] ?: return null
            if (email.isBlank() || password.isBlank()) return null
            return SavedCredentials(email, password)
        }

        override fun clear() {
            data.remove("email")
            data.remove("password")
        }
    }

    private lateinit var store: FakeCredentialsStore
    private lateinit var tokenManager: TokenManager

    @Before
    fun setup() {
        store = FakeCredentialsStore()
        tokenManager = TokenManager(mockk(), store)
    }

    @Test
    fun `save and load credentials roundtrip`() {
        tokenManager.saveCredentials("user@example.com", "s3cret-password")

        val loaded = tokenManager.getSavedCredentials()
        assertNotNull(loaded)
        assertEquals("user@example.com", loaded?.email)
        assertEquals("s3cret-password", loaded?.password)
    }

    @Test
    fun `save trims the email`() {
        tokenManager.saveCredentials("  user@example.com  ", "s3cret-password")

        assertEquals("user@example.com", tokenManager.getSavedCredentials()?.email)
    }

    @Test
    fun `blank email is not stored`() {
        tokenManager.saveCredentials("   ", "s3cret-password")

        assertNull(tokenManager.getSavedCredentials())
    }

    @Test
    fun `blank password keeps the previously stored credentials`() {
        tokenManager.saveCredentials("user@example.com", "s3cret-password")
        tokenManager.saveCredentials("user@example.com", "")

        val loaded = tokenManager.getSavedCredentials()
        assertNotNull(loaded)
        assertEquals("s3cret-password", loaded?.password)
    }

    @Test
    fun `clear credentials removes the pair`() {
        tokenManager.saveCredentials("user@example.com", "s3cret-password")
        tokenManager.clearCredentials()

        assertNull(tokenManager.getSavedCredentials())
        assertTrue(store.data.isEmpty())
    }

    @Test
    fun `no credentials stored returns null`() {
        assertNull(tokenManager.getSavedCredentials())
    }
}
