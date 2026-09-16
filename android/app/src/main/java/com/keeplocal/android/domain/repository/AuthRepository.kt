package com.keeplocal.android.domain.repository

import com.keeplocal.android.domain.model.AuthState
import com.keeplocal.android.domain.model.OAuthProviders
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
        voiceTranscription: Boolean? = null
    ): Result<Unit>
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
}
