package com.keeplocal.android.ui.auth

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.keeplocal.android.R
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.data.local.TokenManager
import com.keeplocal.android.domain.model.AuthState
import com.keeplocal.android.domain.model.OAuthProviders
import com.keeplocal.android.domain.model.User
import com.keeplocal.android.domain.repository.AuthRepository
import com.keeplocal.android.domain.usecase.auth.CheckAutheliaUseCase
import com.keeplocal.android.domain.usecase.auth.CheckServerConnectionUseCase
import com.keeplocal.android.domain.usecase.auth.GetCurrentUserUseCase
import com.keeplocal.android.domain.usecase.auth.GetOAuthProvidersUseCase
import com.keeplocal.android.domain.usecase.auth.LoginUseCase
import com.keeplocal.android.util.FileLogger
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import javax.inject.Inject

data class SetupUiState(
    val serverUrl: String = "",
    val username: String = "",
    val email: String = "",
    val password: String = "",
    val confirmPassword: String = "",
    val isLoading: Boolean = false,
    val connectionStatus: ConnectionStatus = ConnectionStatus.UNKNOWN,
    val autheliaDetected: Boolean = false,
    val showAutheliaWebView: Boolean = false,
    /** OAuth: providers configured server-side, "google"/"github" while a
     *  provider login WebView is showing. */
    val oauthProviders: OAuthProviders = OAuthProviders(),
    val showOAuthWebView: Boolean = false,
    val oauthProvider: String? = null,
    val errorMessage: String? = null,
    val isAuthenticated: Boolean = false,
    val currentUser: User? = null,
    val isRegisterMode: Boolean = false,
    val rememberCredentials: Boolean = false,
    // v1.9.0 Nr. 6: token-based password reset + demo account.
    val showResetDialog: Boolean = false,
    val resetToken: String = "",
    val resetNewPassword: String = "",
    /** Non-error feedback ("Passwort gesetzt — bitte einloggen."). */
    val infoMessage: String? = null
)

enum class ConnectionStatus { UNKNOWN, TESTING, CONNECTED, ERROR }

@HiltViewModel
class SetupViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val checkServerConnection: CheckServerConnectionUseCase,
    private val checkAuthelia: CheckAutheliaUseCase,
    private val loginUseCase: LoginUseCase,
    private val getCurrentUser: GetCurrentUserUseCase,
    private val getOAuthProviders: GetOAuthProvidersUseCase,
    private val authRepository: AuthRepository,
    private val settingsDataStore: SettingsDataStore,
    private val tokenManager: TokenManager,
    private val fileLogger: FileLogger
) : ViewModel() {

    private val _uiState = MutableStateFlow(SetupUiState())
    val uiState = _uiState.asStateFlow()

    private val _navigateToMain = MutableSharedFlow<Unit>()
    val navigateToMain = _navigateToMain.asSharedFlow()

    init {
        viewModelScope.launch {
            try {
                val remember = settingsDataStore.rememberCredentials.first()
                val savedUrl = settingsDataStore.serverUrl.first()
                if (savedUrl.isNotBlank()) {
                    // Prefill the saved email so a failed auto-login still
                    // leaves a usable login form.
                    val savedEmail = tokenManager.getSavedCredentials()?.email ?: ""
                    _uiState.update {
                        it.copy(serverUrl = savedUrl, rememberCredentials = remember, email = savedEmail)
                    }
                    tryAutoLogin()
                } else {
                    _uiState.update { it.copy(rememberCredentials = remember) }
                }
            } catch (_: Exception) {}
        }
    }

    private suspend fun tryAutoLogin() {
        _uiState.update { it.copy(isLoading = true) }
        try {
            fileLogger.log("SetupVM", "Attempting auto-login with existing token...")
            val result = getCurrentUser()
            val user = result.getOrNull()
            if (result.isSuccess && user != null) {
                fileLogger.log("SetupVM", "Auto-login via token succeeded: userId=${user.id}")
                _uiState.update { it.copy(isLoading = false, isAuthenticated = true, currentUser = user) }
                _navigateToMain.emit(Unit)
                return
            }
            fileLogger.log("SetupVM", "Token-based auto-login failed, trying saved credentials...")
        } catch (e: Exception) {
            fileLogger.error("SetupVM", "Token auto-login exception", e)
        }

        // Token expired or invalid — re-login with the saved credentials.
        // The API authenticates by email, so the saved email is the login name.
        try {
            val rememberCreds = settingsDataStore.rememberCredentials.first()
            val savedCredentials = tokenManager.getSavedCredentials()
            if (rememberCreds && savedCredentials != null) {
                fileLogger.log("SetupVM", "Re-authenticating with saved credentials for ${FileLogger.redactEmail(savedCredentials.email)}")
                val loginResult = loginUseCase(savedCredentials.email, savedCredentials.password)
                val user = loginResult.getOrNull()
                if (loginResult.isSuccess && user != null) {
                    fileLogger.log("SetupVM", "Re-login with saved credentials succeeded: userId=${user.id}")
                    _uiState.update { it.copy(isLoading = false, isAuthenticated = true, currentUser = user) }
                    _navigateToMain.emit(Unit)
                    return
                } else {
                    fileLogger.log("SetupVM", "Re-login with saved credentials failed")
                }
            } else {
                fileLogger.log("SetupVM", "No saved credentials available (remember=$rememberCreds)")
            }
        } catch (e: Exception) {
            fileLogger.error("SetupVM", "Saved credentials re-login exception", e)
        }

        _uiState.update { it.copy(isLoading = false) }
    }

    fun updateServerUrl(url: String) {
        _uiState.update { it.copy(serverUrl = url, connectionStatus = ConnectionStatus.UNKNOWN, errorMessage = null) }
    }

    fun updateUsername(username: String) {
        _uiState.update { it.copy(username = username, errorMessage = null) }
    }

    fun updateEmail(email: String) {
        _uiState.update { it.copy(email = email.trim(), errorMessage = null) }
    }

    fun updatePassword(password: String) {
        _uiState.update { it.copy(password = password, errorMessage = null, infoMessage = null) }
    }

    fun updateConfirmPassword(password: String) {
        _uiState.update { it.copy(confirmPassword = password, errorMessage = null) }
    }

    fun openResetDialog() {
        _uiState.update {
            it.copy(showResetDialog = true, resetToken = "", resetNewPassword = "", errorMessage = null, infoMessage = null)
        }
    }

    fun closeResetDialog() {
        _uiState.update { it.copy(showResetDialog = false) }
    }

    fun updateResetToken(token: String) {
        _uiState.update { it.copy(resetToken = token, errorMessage = null) }
    }

    fun updateResetNewPassword(password: String) {
        _uiState.update { it.copy(resetNewPassword = password, errorMessage = null) }
    }

    /** Redeems an admin-issued one-time token (15 min) for a new password. */
    fun submitResetPassword() {
        viewModelScope.launch {
            val state = _uiState.value
            if (state.resetToken.isBlank() || state.resetNewPassword.length < 8) {
                _uiState.update { it.copy(errorMessage = context.getString(R.string.auth_password_too_short)) }
                return@launch
            }
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val result = authRepository.resetPassword(state.resetToken.trim(), state.resetNewPassword)
            if (result.isSuccess) {
                fileLogger.log("SetupVM", "Password reset via token succeeded")
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        showResetDialog = false,
                        resetToken = "",
                        resetNewPassword = "",
                        infoMessage = context.getString(R.string.login_reset_success)
                    )
                }
            } else {
                val detail = (result as? com.keeplocal.android.util.Result.Error)?.message
                fileLogger.error("SetupVM", "Password reset failed: $detail")
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = context.getString(R.string.auth_login_failed_detail, detail ?: "")
                    )
                }
            }
        }
    }

    /**
     * Demo account (v1.9.0 Nr. 6): server creates/reuses the demo user and
     * hands back a session. Nothing is persisted — "Remember credentials"
     * stays untouched.
     */
    fun demoLogin() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val result = authRepository.demoLogin()
            val user = result.getOrNull()
            if (result.isSuccess && user != null) {
                fileLogger.log("SetupVM", "Demo login success: userId=${user.id}")
                settingsDataStore.setServerUrl(_uiState.value.serverUrl)
                _uiState.update { it.copy(isLoading = false, isAuthenticated = true, currentUser = user) }
                _navigateToMain.emit(Unit)
            } else {
                val detail = (result as? com.keeplocal.android.util.Result.Error)?.message
                fileLogger.error("SetupVM", "Demo login failed: $detail")
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        errorMessage = context.getString(R.string.auth_login_failed_detail, detail ?: "")
                    )
                }
            }
        }
    }

    fun dismissInfoMessage() {
        _uiState.update { it.copy(infoMessage = null) }
    }

    fun setRegisterMode(register: Boolean) {
        _uiState.update { it.copy(isRegisterMode = register, errorMessage = null, confirmPassword = "") }
    }

    /**
     * "Remember credentials" decides whether email and password are stored
     * (encrypted) for the next silent re-login. Switching it off forgets
     * whatever was stored before.
     */
    fun toggleRememberCredentials() {
        val newValue = !_uiState.value.rememberCredentials
        _uiState.update { it.copy(rememberCredentials = newValue) }
        viewModelScope.launch {
            settingsDataStore.setRememberCredentials(newValue)
            if (!newValue) {
                tokenManager.clearCredentials()
            }
        }
    }

    fun testConnection() {
        viewModelScope.launch {
            var url = _uiState.value.serverUrl.trim()
            if (url.isBlank()) {
                _uiState.update { it.copy(errorMessage = context.getString(R.string.setup_enter_url)) }
                return@launch
            }

            if (!url.startsWith("http://") && !url.startsWith("https://")) {
                url = "https://$url"
                _uiState.update { it.copy(serverUrl = url) }
            }

            if (url.toHttpUrlOrNull() == null) {
                _uiState.update { it.copy(
                    connectionStatus = ConnectionStatus.ERROR,
                    errorMessage = context.getString(R.string.setup_invalid_url)
                ) }
                return@launch
            }

            _uiState.update { it.copy(connectionStatus = ConnectionStatus.TESTING, errorMessage = null) }

            authRepository.setServerUrl(url)
            delay(150)

            try {
                fileLogger.log("SetupVM", "Testing connection to $url")
                val result = checkServerConnection(url)
                if (result.isSuccess && result.getOrNull() == true) {
                    fileLogger.log("SetupVM", "Server reachable, checking Authelia...")
                    val autheliaResult = checkAuthelia(url)
                    val hasAuthelia = autheliaResult.getOrNull() == true
                    fileLogger.log("SetupVM", "Authelia detected: $hasAuthelia")
                    _uiState.update {
                        it.copy(
                            connectionStatus = ConnectionStatus.CONNECTED,
                            autheliaDetected = hasAuthelia
                        )
                    }
                    if (hasAuthelia) {
                        settingsDataStore.setAutheliaEnabled(true)
                    }
                    loadOAuthProviders()
                } else {
                    fileLogger.log("SetupVM", "Server not reachable: ${result}")
                    _uiState.update { it.copy(
                        connectionStatus = ConnectionStatus.ERROR,
                        errorMessage = context.getString(R.string.setup_connection_failed)
                    ) }
                }
            } catch (e: Exception) {
                fileLogger.error("SetupVM", "Connection test failed", e)
                _uiState.update { it.copy(
                    connectionStatus = ConnectionStatus.ERROR,
                    errorMessage = e.message ?: context.getString(R.string.setup_connection_failed)
                ) }
            }
        }
    }

    fun openAutheliaWebView() {
        _uiState.update { it.copy(showAutheliaWebView = true) }
    }

    fun onAutheliaComplete(cookies: String) {
        fileLogger.log("SetupVM", "onAutheliaComplete: cookies=${if (cookies.isBlank()) "empty" else "present"}")
        authRepository.saveAutheliaCookies(cookies)
        _uiState.update { it.copy(showAutheliaWebView = false) }
    }

    fun onAutheliaDismissed() {
        _uiState.update { it.copy(showAutheliaWebView = false) }
    }

    /** Which OAuth buttons to offer — only providers the server configured. */
    private fun loadOAuthProviders() {
        viewModelScope.launch {
            val result = getOAuthProviders()
            val providers = result.getOrNull()
            if (result.isSuccess && providers != null) {
                fileLogger.log("SetupVM", "OAuth providers: google=${providers.google} github=${providers.github}")
                _uiState.update { it.copy(oauthProviders = providers) }
            } else {
                fileLogger.log("SetupVM", "OAuth providers unavailable — hiding buttons")
            }
        }
    }

    /** Opens the provider login inside the hardened in-app WebView. */
    fun startOAuth(provider: String) {
        _uiState.update { it.copy(showOAuthWebView = true, oauthProvider = provider, errorMessage = null) }
    }

    fun onOAuthWebViewDismissed() {
        _uiState.update { it.copy(showOAuthWebView = false, oauthProvider = null) }
    }

    /**
     * Provider login finished and the server redirected back to the app with
     * a fresh session cookie: adopt the cookies, then pull the user through
     * the API to confirm the session actually works.
     */
    fun onOAuthComplete(cookies: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, showOAuthWebView = false) }
            authRepository.saveAutheliaCookies(cookies)
            val result = getCurrentUser()
            val user = result.getOrNull()
            if (result.isSuccess && user != null) {
                fileLogger.log("SetupVM", "OAuth login success: userId=${user.id}")
                settingsDataStore.setServerUrl(_uiState.value.serverUrl)
                _uiState.update {
                    it.copy(isLoading = false, isAuthenticated = true, currentUser = user, oauthProvider = null)
                }
                _navigateToMain.emit(Unit)
            } else {
                fileLogger.error("SetupVM", "OAuth session did not validate")
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        oauthProvider = null,
                        errorMessage = context.getString(R.string.auth_oauth_failed)
                    )
                }
            }
        }
    }

    fun login() {
        viewModelScope.launch {
            val state = _uiState.value
            if (state.email.isBlank() || state.password.isBlank()) {
                _uiState.update { it.copy(errorMessage = context.getString(R.string.auth_enter_email_password)) }
                return@launch
            }
            if (!EMAIL_PATTERN.matches(state.email)) {
                _uiState.update { it.copy(errorMessage = context.getString(R.string.auth_invalid_email)) }
                return@launch
            }
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }

            try {
                fileLogger.log("SetupVM", "Attempting login for email=${FileLogger.redactEmail(state.email)} serverUrl=${state.serverUrl}")
                fileLogger.log("SetupVM", "Current cookies: ${if (tokenManager.getAutheliaCookies().isNullOrBlank()) "none" else "present"}")
                val result = loginUseCase(state.email, state.password)
                val user = result.getOrNull()
                if (result.isSuccess && user != null) {
                    fileLogger.log("SetupVM", "Login success! userId=${user.id}")
                    persistCredentialsIfWanted()
                    settingsDataStore.setServerUrl(state.serverUrl)
                    _uiState.update { it.copy(isLoading = false, isAuthenticated = true, currentUser = user) }
                    _navigateToMain.emit(Unit)
                } else {
                    val errorDetail = if (result is com.keeplocal.android.util.Result.Error) result.message else null
                    fileLogger.error("SetupVM", "Login failed: $errorDetail")
                    // Auto-reopen Authelia WebView if session expired
                    if (errorDetail != null && (errorDetail.contains("Authelia session expired") || errorDetail.contains("authelia", ignoreCase = true))) {
                        fileLogger.log("SetupVM", "Authelia session expired during login, reopening WebView")
                        tokenManager.saveAutheliaCookies("")
                        _uiState.update {
                            it.copy(isLoading = false, errorMessage = context.getString(R.string.auth_session_expired), showAutheliaWebView = true)
                        }
                    } else {
                        _uiState.update {
                            it.copy(
                                isLoading = false,
                                errorMessage = context.getString(
                                    R.string.auth_login_failed_detail,
                                    errorDetail ?: context.getString(R.string.error_generic)
                                )
                            )
                        }
                    }
                }
            } catch (e: Exception) {
                fileLogger.error("SetupVM", "Login exception", e)
                val msg = e.message ?: ""
                if (msg.contains("Authelia session expired") || msg.contains("authelia", ignoreCase = true)) {
                    fileLogger.log("SetupVM", "Authelia session expired (exception), reopening WebView")
                    tokenManager.saveAutheliaCookies("")
                    _uiState.update {
                        it.copy(isLoading = false, errorMessage = context.getString(R.string.auth_session_expired), showAutheliaWebView = true)
                    }
                } else {
                    _uiState.update {
                        it.copy(isLoading = false, errorMessage = context.getString(R.string.error_with_reason, e.message ?: ""))
                    }
                }
            }
        }
    }

    fun register() {
        viewModelScope.launch {
            val state = _uiState.value
            if (state.username.isBlank() || state.email.isBlank() || state.password.isBlank()) {
                _uiState.update {
                    it.copy(errorMessage = context.getString(R.string.auth_enter_all_fields))
                }
                return@launch
            }
            if (!EMAIL_PATTERN.matches(state.email)) {
                _uiState.update { it.copy(errorMessage = context.getString(R.string.auth_invalid_email)) }
                return@launch
            }
            if (state.password != state.confirmPassword) {
                _uiState.update { it.copy(errorMessage = context.getString(R.string.auth_passwords_no_match)) }
                return@launch
            }
            if (state.password.length < 8) {
                _uiState.update { it.copy(errorMessage = context.getString(R.string.auth_password_too_short)) }
                return@launch
            }

            _uiState.update { it.copy(isLoading = true, errorMessage = null) }

            try {
                fileLogger.log("SetupVM", "Attempting registration for user=${state.username} email=${FileLogger.redactEmail(state.email)}")
                val result = authRepository.register(state.username, state.email, state.password)
                val user = result.getOrNull()
                if (result.isSuccess && user != null) {
                    fileLogger.log("SetupVM", "Registration success! userId=${user.id}")
                    persistCredentialsIfWanted()
                    settingsDataStore.setServerUrl(state.serverUrl)
                    _uiState.update { it.copy(isLoading = false, isAuthenticated = true, currentUser = user) }
                    _navigateToMain.emit(Unit)
                } else {
                    val errorDetail = if (result is com.keeplocal.android.util.Result.Error) result.message else null
                    fileLogger.error("SetupVM", "Registration failed: $errorDetail")
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = errorDetail?.let { detail ->
                                context.getString(R.string.auth_register_failed_detail, detail)
                            } ?: context.getString(R.string.auth_register_failed)
                        )
                    }
                }
            } catch (e: Exception) {
                fileLogger.error("SetupVM", "Registration exception", e)
                _uiState.update {
                    it.copy(isLoading = false, errorMessage = context.getString(R.string.error_with_reason, e.message ?: ""))
                }
            }
        }
    }

    /** Stores (or forgets) the credentials according to the toggle. */
    private suspend fun persistCredentialsIfWanted() {
        val state = _uiState.value
        if (state.rememberCredentials) {
            tokenManager.saveCredentials(state.email, state.password)
        } else {
            tokenManager.clearCredentials()
        }
    }

    private companion object {
        // Deliberately permissive: the server is the authority, this only stops
        // the obvious "typed my username into the email field" mistake.
        val EMAIL_PATTERN = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")
    }
}
