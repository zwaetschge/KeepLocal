package com.keeplocal.android.domain.repository

import com.keeplocal.android.domain.model.AuthState
import com.keeplocal.android.domain.model.OAuthProviders
import com.keeplocal.android.domain.model.SavedSearch
import com.keeplocal.android.domain.model.User
import com.keeplocal.android.util.Result
import kotlinx.coroutines.flow.Flow

interface AuthRepository {
    val authState: Flow<AuthState>
    suspend fun checkServerConnection(serverUrl: String): Result<Boolean>
    suspend fun isAutheliaPresent(serverUrl: String): Result<Boolean>
    suspend fun getCsrfToken(): Result<String>
    suspend fun login(email: String, password: String): Result<User>
    suspend fun logout(): Result<Unit>
    suspend fun getCurrentUser(): Result<User>
    /**
     * Registers an account. On an empty server the API marks the first account
     * as admin, which is how the WebUI performs initial setup too.
     */
    suspend fun register(username: String, email: String, password: String): Result<User>
    /**
     * Pushes account-wide preferences (PUT /api/auth/preferences, Top-30
     * Nr. 17): theme, UI language, and the Whisper language hint follow the
     * account, not the device. Only the fields that are non-null are sent —
     * the server applies exactly those.
     */
    suspend fun pushPreferences(
        theme: String? = null,
        language: String? = null,
        transcriptionLanguage: String? = null,
        voiceTranscription: Boolean? = null,
        renderMarkdown: Boolean? = null
    ): Result<Unit>
    /**
     * Pushes the account-wide tag colors (v1.10.0, same endpoint): tag name
     * to palette hex. The map is sent whole — removing a color means pushing
     * the map without it.
     */
    suspend fun pushTagColors(colors: Map<String, String>): Result<Unit>
    /**
     * Pushes the account-wide saved searches / smart folders (v1.10.0). The
     * list is sent whole, same whole-state contract as the tag colors.
     */
    suspend fun pushSavedSearches(searches: List<SavedSearch>): Result<Unit>
    /**
     * Sets or clears the journal root note (v1.10.0): null moves future
     * "Heute"-Notizen back to the tree's root level.
     */
    suspend fun pushJournalFolderId(folderId: String?): Result<Unit>
    fun saveAutheliaCookies(cookies: String)
    fun getServerUrl(): String?
    suspend fun setServerUrl(url: String)
    /** Which OAuth providers the deployment has configured. */
    suspend fun getOAuthProviders(): Result<OAuthProviders>
    /**
     * Changes the account password (POST /api/auth/change-password). The
     * server bumps the session version, which invalidates all other sessions.
     */
    suspend fun changePassword(currentPassword: String, newPassword: String): Result<Unit>
    /**
     * Redeems an admin-issued one-time token for a new password
     * (POST /api/auth/reset-password, 15 min validity, no session needed).
     * On success every existing session is gone — the next step is a login.
     */
    suspend fun resetPassword(token: String, newPassword: String): Result<Unit>
    /**
     * Starts a session on the public demo account (POST /api/auth/demo).
     * Servers without DEMO_MODE answer 404 — surface that as a clear
     * message instead of a generic login failure.
     */
    suspend fun demoLogin(): Result<User>
}
