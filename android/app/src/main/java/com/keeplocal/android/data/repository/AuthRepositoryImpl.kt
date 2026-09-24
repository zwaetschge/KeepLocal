package com.keeplocal.android.data.repository

import com.keeplocal.android.data.api.KeepLocalApi
import com.keeplocal.android.data.api.NullableString
import com.keeplocal.android.data.api.SessionCookieJar
import com.keeplocal.android.data.api.dto.ChangePasswordDto
import com.keeplocal.android.data.api.dto.LoginRequestDto
import com.keeplocal.android.data.api.dto.RegisterRequestDto
import com.keeplocal.android.data.api.dto.ResetPasswordDto
import com.keeplocal.android.data.api.dto.UpdateAiFeaturesDto
import com.keeplocal.android.data.api.dto.UpdatePreferencesDto
import com.keeplocal.android.data.api.dto.UserPreferencesDto
import com.keeplocal.android.data.api.dto.toDomain
import com.keeplocal.android.data.api.dto.toDto
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.data.local.TokenManager
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.dao.PendingOperationDao
import com.keeplocal.android.domain.model.AuthState
import com.keeplocal.android.domain.model.OAuthProviders
import com.keeplocal.android.domain.model.SavedSearch
import com.keeplocal.android.domain.model.User
import com.keeplocal.android.domain.repository.AuthRepository
import com.keeplocal.android.util.FileLogger
import com.keeplocal.android.util.Result
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import javax.inject.Inject

class AuthRepositoryImpl @Inject constructor(
    private val api: KeepLocalApi,
    private val tokenManager: TokenManager,
    private val settingsDataStore: SettingsDataStore,
    private val okHttpClient: OkHttpClient,
    private val cookieJar: SessionCookieJar,
    private val noteDao: NoteDao,
    private val pendingOperationDao: PendingOperationDao,
    private val fileLogger: FileLogger
) : AuthRepository {

    private val _authState = MutableStateFlow<AuthState>(AuthState.Unauthenticated)
    override val authState: Flow<AuthState> = _authState.asStateFlow()

    override suspend fun checkServerConnection(serverUrl: String): Result<Boolean> = Result.catching {
        withContext(Dispatchers.IO) {
            val normalizedUrl = normalizeUrl(serverUrl)
            fileLogger.log("AuthRepo", "checkServerConnection: $normalizedUrl")
            val client = OkHttpClient.Builder()
                .followRedirects(false)
                .followSslRedirects(false)
                .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                .build()
            val request = Request.Builder()
                .url(normalizedUrl.trimEnd('/') + "/api/csrf-token")
                .get()
                .build()
            val response = client.newCall(request).execute()
            val code = response.code
            response.close()
            fileLogger.log("AuthRepo", "checkServerConnection response: code=$code")
            code in 200..499
        }
    }

    override suspend fun isAutheliaPresent(serverUrl: String): Result<Boolean> = Result.catching {
        withContext(Dispatchers.IO) {
            val normalizedUrl = normalizeUrl(serverUrl)
            fileLogger.log("AuthRepo", "isAutheliaPresent: $normalizedUrl")
            val client = OkHttpClient.Builder()
                .followRedirects(false)
                .followSslRedirects(false)
                .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                .readTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
                .build()
            val request = Request.Builder()
                .url(normalizedUrl.trimEnd('/'))
                .get()
                .build()
            val response = client.newCall(request).execute()
            response.use {
                val code = it.code
                val location = it.header("Location") ?: ""
                fileLogger.log("AuthRepo", "isAutheliaPresent response: code=$code location=$location")
                location.isNotEmpty() && (location.contains("authelia") || location.contains("auth"))
            }
        }
    }

    private fun normalizeUrl(url: String): String {
        val trimmed = url.trim()
        if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed
        return "https://$trimmed"
    }

    override suspend fun getCsrfToken(): Result<String> = Result.catching {
        fileLogger.log("AuthRepo", "getCsrfToken: calling api.getCsrfToken()")
        val response = api.getCsrfToken()
        fileLogger.log("AuthRepo", "getCsrfToken response: code=${response.code()}")
        if (response.isSuccessful) {
            val token = response.body()?.csrfToken ?: throw Exception("No CSRF token in response")
            tokenManager.saveCsrfToken(token)
            fileLogger.log("AuthRepo", "getCsrfToken success")
            token
        } else {
            val code = response.code()
            val location = response.headers()["Location"] ?: ""
            val body = try { response.errorBody()?.string()?.take(500) } catch (_: Exception) { "unreadable" }
            fileLogger.error("AuthRepo", "getCsrfToken failed: code=$code location=$location body=$body")
            if (code in 301..303 && (location.contains("auth") || location.contains("authelia"))) {
                throw Exception("Authelia session expired. Please authenticate via Authelia first.")
            }
            // AuthInterceptor synthesizes 401 with JSON body for Authelia blocks
            if (code == 401 && (body?.contains("authelia") == true || body?.contains("Authelia") == true || body?.contains("auth.") == true)) {
                throw Exception("Authelia session expired. Please authenticate via Authelia first.")
            }
            throw Exception("Failed to get CSRF token: $code body=$body")
        }
    }

    override suspend fun login(email: String, password: String): Result<User> = Result.catching {
        fileLogger.log("AuthRepo", "login: email=${FileLogger.redactEmail(email)}")
        val csrfResult = getCsrfToken()
        if (csrfResult.isError) {
            val msg = (csrfResult as Result.Error).message
            fileLogger.error("AuthRepo", "login: CSRF fetch failed: $msg")
            throw Exception("Failed to get CSRF token: $msg")
        }

        fileLogger.log("AuthRepo", "login: calling api.login()")
        val response = api.login(LoginRequestDto(email, password))
        fileLogger.log("AuthRepo", "login response: code=${response.code()}")
        if (response.isSuccessful) {
            val authResponse = response.body() ?: throw Exception("Empty response")
            authResponse.token?.let { tokenManager.saveJwtToken(it) }
            val user = authResponse.user?.toDomain() ?: throw Exception("No user data")
            fileLogger.log("AuthRepo", "login success: userId=${user.id}")
            _authState.value = AuthState.Authenticated(user)
            applyServerPreferences(authResponse.user?.preferences)
            user
        } else {
            val code = response.code()
            val location = response.headers()["Location"] ?: ""
            val body = try { response.errorBody()?.string()?.take(500) } catch (_: Exception) { "unreadable" }
            fileLogger.error("AuthRepo", "login failed: code=$code location=$location body=$body")
            if (code in 301..303 && (location.contains("auth") || location.contains("authelia"))) {
                throw Exception("Authelia session expired. Please authenticate via Authelia first.")
            }
            throw Exception(serverMessage(body) ?: "Login failed (HTTP $code)")
        }
    }

    override suspend fun logout(): Result<Unit> = Result.catching {
        try { api.logout() } catch (_: Exception) {}
        // Drop the in-memory session cookies too; without this the next
        // login in the same process would silently reuse this session.
        cookieJar.clear()
        tokenManager.clearCredentials()
        tokenManager.clearAll()
        // The notes cache, the offline queue and the delta-sync cursor all
        // belong to the account that just left — wipe them BEFORE the auth
        // state flips, so the next login on this device starts from an empty
        // cache instead of seeing the previous account's notes, and a kept
        // `since` never replays a foreign delta into it.
        // Review v1.18.0: jeder Schritt im eigenen try — EIN fehlgeschlagener
        // Room-Call darf den Rest nicht überspringen. Die Queue geht zuerst
        // (der schlimmste Leak: ihre Ops würden unter dem NÄCHSTEN Konto
        // abspielen); der Cursor-Reset läuft zuletzt und bedingungslos.
        runCatching { pendingOperationDao.deleteAll() }
            .onFailure { fileLogger.error("AuthRepo", "logout: wiping offline queue failed", it) }
        runCatching { noteDao.deleteAll() }
            .onFailure { fileLogger.error("AuthRepo", "logout: wiping note cache failed", it) }
        runCatching {
            // Wipe-Marker statt "": Ein Pull, der gerade während des Logouts
            // läuft, erkennt daran, dass er seinen Cursor NICHT mehr
            // zurückschreiben darf (SyncManager). since = "" bedeutet wie
            // bisher „noch nie gezogen" → nächstes Konto zieht komplett.
            settingsDataStore.setSyncSignature(SettingsDataStore.SYNC_SIGNATURE_WIPED)
            settingsDataStore.setSyncSince("")
        }.onFailure { fileLogger.error("AuthRepo", "logout: resetting sync cursor failed", it) }
        // Residual race (documented, not fixed): a drain or delta pull that
        // is already in flight still holds the old token in its request
        // headers and can write rows back after this clear — SyncManager has
        // no identity concept to gate on. The next account's first clean
        // pull removes such foreign rows via the tree reconciliation.
        _authState.value = AuthState.Unauthenticated
    }

    override suspend fun pushPreferences(
        theme: String?,
        language: String?,
        transcriptionLanguage: String?,
        voiceTranscription: Boolean?,
        renderMarkdown: Boolean?
    ): Result<Unit> = Result.catching {
        if (theme == null && language == null && transcriptionLanguage == null && voiceTranscription == null && renderMarkdown == null) return@catching
        fileLogger.log("AuthRepo", "pushPreferences: theme=$theme language=$language transcription=$transcriptionLanguage voice=$voiceTranscription markdown=$renderMarkdown")
        val response = api.updatePreferences(
            UpdatePreferencesDto(
                theme = theme,
                language = language,
                transcriptionLanguage = transcriptionLanguage,
                aiFeatures = voiceTranscription?.let { UpdateAiFeaturesDto(voiceTranscription = it) },
                renderMarkdown = renderMarkdown
            )
        )
        if (!response.isSuccessful) {
            val body = try { response.errorBody()?.string()?.take(200) } catch (_: Exception) { null }
            fileLogger.error("AuthRepo", "pushPreferences failed: code=${response.code()} body=$body")
            throw Exception(serverMessage(body) ?: "Preferences not saved (HTTP ${response.code()})")
        }
    }

    override suspend fun pushTagColors(colors: Map<String, String>): Result<Unit> = Result.catching {
        fileLogger.log("AuthRepo", "pushTagColors: ${colors.size} tags")
        val response = api.updatePreferences(UpdatePreferencesDto(tagColors = colors))
        if (!response.isSuccessful) {
            val body = try { response.errorBody()?.string()?.take(200) } catch (_: Exception) { null }
            fileLogger.error("AuthRepo", "pushTagColors failed: code=${response.code()} body=$body")
            throw Exception(serverMessage(body) ?: "Tag colors not saved (HTTP ${response.code()})")
        }
        // Keep the device in step even when this device's login pull is stale.
        settingsDataStore.setTagColors(colors)
    }

    override suspend fun pushSavedSearches(searches: List<SavedSearch>): Result<Unit> =
        Result.catching {
            fileLogger.log("AuthRepo", "pushSavedSearches: ${searches.size} entries")
            val response = api.updatePreferences(
                UpdatePreferencesDto(savedSearches = searches.map { it.toDto() })
            )
            if (!response.isSuccessful) {
                val body = try { response.errorBody()?.string()?.take(200) } catch (_: Exception) { null }
                fileLogger.error("AuthRepo", "pushSavedSearches failed: code=${response.code()} body=$body")
                throw Exception(serverMessage(body) ?: "Saved searches not saved (HTTP ${response.code()})")
            }
            settingsDataStore.setSavedSearches(searches)
        }

    override suspend fun pushJournalFolderId(folderId: String?): Result<Unit> = Result.catching {
        fileLogger.log("AuthRepo", "pushJournalFolderId: ${if (folderId == null) "clear" else "set"}")
        // NullableString: an explicit JSON null is the only way to clear the
        // journal root — an absent field would leave it untouched.
        val response = api.updatePreferences(
            UpdatePreferencesDto(journalFolderId = NullableString(folderId))
        )
        if (!response.isSuccessful) {
            val body = try { response.errorBody()?.string()?.take(200) } catch (_: Exception) { null }
            fileLogger.error("AuthRepo", "pushJournalFolderId failed: code=${response.code()} body=$body")
            throw Exception(serverMessage(body) ?: "Journal folder not saved (HTTP ${response.code()})")
        }
        settingsDataStore.setJournalFolderId(folderId)
    }

    /**
     * Login response pull (Top-30 Nr. 17): theme, language and the Whisper
     * hint travel with the account. The server stores themes as
     * light/dark/oled/eink/doodle; the local keys only differ in `e_ink`.
     */
    private suspend fun applyServerPreferences(preferences: UserPreferencesDto?) {
        if (preferences == null) return
        runCatching {
            preferences.theme?.let { serverTheme ->
                val localKey = when (serverTheme) {
                    "light", "dark", "oled", "doodle" -> serverTheme
                    "eink" -> "e_ink"
                    else -> null
                }
                localKey?.let { settingsDataStore.setThemeMode(it) }
            }
            preferences.language
                ?.takeIf { it == "de" || it == "en" }
                ?.let { settingsDataStore.setLanguage(it) }
            preferences.transcriptionLanguage
                ?.takeIf { it.isNotBlank() }
                ?.let { settingsDataStore.setTranscriptionLanguage(it) }
            preferences.aiFeatures?.voiceTranscription
                ?.let { settingsDataStore.setVoiceTranscription(it) }
            // v1.18.0: markdown rendering follows the account too; the server
            // always sends the key (auth.js: `!== false`), so null means the
            // payload predates it and the local value stays untouched.
            preferences.renderMarkdown
                ?.let { settingsDataStore.setRenderMarkdown(it) }
            // v1.10.0: tag colors, saved searches and the journal root follow
            // the account like theme and language. Null = the server has
            // never stored them — that must not clear a local edit mid-push.
            preferences.tagColors
                ?.takeIf { it.isNotEmpty() }
                ?.let { settingsDataStore.setTagColors(it) }
            preferences.savedSearches
                ?.takeIf { it.isNotEmpty() }
                ?.let { searches -> settingsDataStore.setSavedSearches(searches.map { it.toDomain() }) }
            preferences.journalFolderId
                ?.takeIf { it.isNotBlank() }
                ?.let { settingsDataStore.setJournalFolderId(it) }
        }.onFailure { fileLogger.error("AuthRepo", "applyServerPreferences failed", it) }
    }

    override suspend fun getCurrentUser(): Result<User> = Result.catching {
        val response = api.getCurrentUser()
        if (response.isSuccessful) {
            val user = response.body()?.toDomain() ?: throw Exception("No user data")
            _authState.value = AuthState.Authenticated(user)
            user
        } else {
            _authState.value = AuthState.Unauthenticated
            throw Exception("Not authenticated: ${response.code()}")
        }
    }

    override suspend fun register(username: String, email: String, password: String): Result<User> =
        Result.catching {
            val csrfResult = getCsrfToken()
            if (csrfResult.isError) {
                throw Exception("Failed to get CSRF token: ${(csrfResult as Result.Error).message}")
            }
            fileLogger.log("AuthRepo", "register: user=$username email=${FileLogger.redactEmail(email)}")
            val response = api.register(RegisterRequestDto(username, email, password))
            if (response.isSuccessful) {
                val authResponse = response.body() ?: throw Exception("Empty response")
                authResponse.token?.let { tokenManager.saveJwtToken(it) }
                val user = authResponse.user?.toDomain() ?: throw Exception("No user data")
                fileLogger.log("AuthRepo", "register success: userId=${user.id}")
                _authState.value = AuthState.Authenticated(user)
                user
            } else {
                val body = try {
                    response.errorBody()?.string()?.take(500)
                } catch (_: Exception) {
                    null
                }
                fileLogger.error("AuthRepo", "register failed: code=${response.code()} body=$body")
                throw Exception(serverMessage(body) ?: "Registration failed: ${response.code()}")
            }
        }

    /** Surfaces the API's own validation text instead of a bare status code. */
    private fun serverMessage(body: String?): String? {
        if (body.isNullOrBlank()) return null
        val detail = Regex("\"msg\"\\s*:\\s*\"([^\"]+)\"").find(body)?.groupValues?.getOrNull(1)
        if (detail != null) return detail
        return Regex("\"error\"\\s*:\\s*\"([^\"]+)\"").find(body)?.groupValues?.getOrNull(1)
    }

    override fun saveAutheliaCookies(cookies: String) {
        fileLogger.log("AuthRepo", "saveAutheliaCookies: ${if (cookies.isBlank()) "empty" else "present"}")
        tokenManager.saveAutheliaCookies(cookies)
    }

    override suspend fun getOAuthProviders(): Result<OAuthProviders> = Result.catching {
        val response = api.getOAuthProviders()
        if (!response.isSuccessful) {
            throw Exception("Providers not available (HTTP ${response.code()})")
        }
        val providers = response.body()?.providers
        OAuthProviders(
            google = providers?.google == true,
            github = providers?.github == true,
            demo = providers?.demo == true
        )
    }

    override suspend fun changePassword(currentPassword: String, newPassword: String): Result<Unit> =
        Result.catching {
            val csrfResult = getCsrfToken()
            if (csrfResult.isError) {
                throw Exception("Failed to get CSRF token: ${(csrfResult as Result.Error).message}")
            }
            fileLogger.log("AuthRepo", "changePassword: calling api")
            val response = api.changePassword(ChangePasswordDto(currentPassword, newPassword))
            if (!response.isSuccessful) {
                val body = try { response.errorBody()?.string()?.take(300) } catch (_: Exception) { null }
                fileLogger.error("AuthRepo", "changePassword failed: code=${response.code()}")
                throw Exception(serverMessage(body) ?: "Password change failed (HTTP ${response.code()})")
            }
            fileLogger.log("AuthRepo", "changePassword success")
        }

    override suspend fun resetPassword(token: String, newPassword: String): Result<Unit> =
        Result.catching {
            val csrfResult = getCsrfToken()
            if (csrfResult.isError) {
                throw Exception("Failed to get CSRF token: ${(csrfResult as Result.Error).message}")
            }
            fileLogger.log("AuthRepo", "resetPassword: calling api")
            val response = api.resetPassword(ResetPasswordDto(token, newPassword))
            if (!response.isSuccessful) {
                val body = try { response.errorBody()?.string()?.take(300) } catch (_: Exception) { null }
                fileLogger.error("AuthRepo", "resetPassword failed: code=${response.code()}")
                throw Exception(serverMessage(body) ?: "Passwort-Reset fehlgeschlagen (HTTP ${response.code()})")
            }
            // Every session died with the old password — the demo of that is
            // this client's own state, so clear it like logout would.
            _authState.value = AuthState.Unauthenticated
            fileLogger.log("AuthRepo", "resetPassword success")
        }

    override suspend fun demoLogin(): Result<User> = Result.catching {
        val csrfResult = getCsrfToken()
        if (csrfResult.isError) {
            throw Exception("Failed to get CSRF token: ${(csrfResult as Result.Error).message}")
        }
        fileLogger.log("AuthRepo", "demoLogin: calling api")
        val response = api.demoLogin()
        fileLogger.log("AuthRepo", "demoLogin response: code=${response.code()}")
        if (response.isSuccessful) {
            val authResponse = response.body() ?: throw Exception("Empty response")
            authResponse.token?.let { tokenManager.saveJwtToken(it) }
            val user = authResponse.user?.toDomain() ?: throw Exception("No user data")
            _authState.value = AuthState.Authenticated(user)
            applyServerPreferences(authResponse.user?.preferences)
            user
        } else {
            val code = response.code()
            val body = try { response.errorBody()?.string()?.take(300) } catch (_: Exception) { null }
            fileLogger.error("AuthRepo", "demoLogin failed: code=$code")
            if (code == 404) {
                throw Exception("Demo ist auf diesem Server nicht aktiviert")
            }
            throw Exception(serverMessage(body) ?: "Demo-Login fehlgeschlagen (HTTP $code)")
        }
    }

    override fun getServerUrl(): String? = null

    override suspend fun setServerUrl(url: String) {
        settingsDataStore.setServerUrl(url)
    }
}
