package com.keeplocal.android.ui.admin

import android.content.Context
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.keeplocal.android.R
import com.keeplocal.android.domain.model.AdminSettings
import com.keeplocal.android.domain.model.AdminStats
import com.keeplocal.android.domain.model.User
import com.keeplocal.android.domain.repository.AdminRepository
import com.keeplocal.android.util.UiState
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Reset token freshly minted for a user — shown once, then gone. */
data class ResetTokenResult(val username: String, val token: String)

data class AdminUiState(
    val stats: UiState<AdminStats> = UiState.Loading,
    val users: UiState<List<User>> = UiState.Loading,
    val settings: AdminSettings? = null,
    val showCreateUserDialog: Boolean = false,
    val newUsername: String = "",
    val newPassword: String = "",
    val resetToken: ResetTokenResult? = null,
    val message: String? = null
)

@HiltViewModel
class AdminViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val adminRepository: AdminRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AdminUiState())
    val uiState = _uiState.asStateFlow()

    init {
        loadStats()
        loadUsers()
        loadSettings()
    }

    fun loadStats() {
        viewModelScope.launch {
            _uiState.update { it.copy(stats = UiState.Loading) }
            val result = adminRepository.getStats()
            val data = result.getOrNull()
            _uiState.update {
                it.copy(stats = if (data != null) UiState.Success(data) else UiState.Error("Failed to load stats"))
            }
        }
    }

    fun loadUsers() {
        viewModelScope.launch {
            _uiState.update { it.copy(users = UiState.Loading) }
            val result = adminRepository.getUsers()
            val data = result.getOrNull()
            _uiState.update {
                it.copy(
                    users = when {
                        data == null -> UiState.Error("Failed to load users")
                        data.isEmpty() -> UiState.Empty
                        else -> UiState.Success(data)
                    }
                )
            }
        }
    }

    private fun loadSettings() {
        viewModelScope.launch {
            val result = adminRepository.getSettings()
            result.getOrNull()?.let { settings ->
                _uiState.update { it.copy(settings = settings) }
            }
        }
    }

    fun toggleRegistration() {
        viewModelScope.launch {
            val current = _uiState.value.settings ?: return@launch
            val updated = current.copy(registrationEnabled = !current.registrationEnabled)
            val result = adminRepository.updateSettings(updated)
            if (result.isSuccess) {
                _uiState.update { it.copy(settings = updated) }
            }
        }
    }

    fun showCreateUserDialog() {
        _uiState.update { it.copy(showCreateUserDialog = true, newUsername = "", newPassword = "") }
    }

    fun hideCreateUserDialog() {
        _uiState.update { it.copy(showCreateUserDialog = false) }
    }

    fun updateNewUsername(username: String) {
        _uiState.update { it.copy(newUsername = username) }
    }

    fun updateNewPassword(password: String) {
        _uiState.update { it.copy(newPassword = password) }
    }

    fun createUser() {
        viewModelScope.launch {
            val state = _uiState.value
            if (state.newUsername.isBlank() || state.newPassword.isBlank()) return@launch
            val result = adminRepository.createUser(state.newUsername, state.newPassword)
            if (result.isSuccess) {
                _uiState.update { it.copy(showCreateUserDialog = false, message = "User created") }
                loadUsers()
            }
        }
    }

    /** Mints a one-time reset token and shows it in a dialog (v1.9.0 Nr. 6). */
    fun createResetToken(user: User) {
        viewModelScope.launch {
            val result = adminRepository.createPasswordResetToken(user.id)
            val token = result.getOrNull()
            if (token != null) {
                _uiState.update { it.copy(resetToken = ResetTokenResult(user.username, token)) }
            } else {
                val error = (result as? com.keeplocal.android.util.Result.Error)?.message
                _uiState.update { it.copy(message = error ?: context.getString(R.string.admin_reset_token_failed)) }
            }
        }
    }

    fun dismissResetToken() {
        _uiState.update { it.copy(resetToken = null) }
    }

    fun deleteUser(id: String) {
        viewModelScope.launch {
            adminRepository.deleteUser(id)
            loadUsers()
        }
    }

    fun toggleAdmin(id: String) {
        viewModelScope.launch {
            adminRepository.toggleAdmin(id)
            loadUsers()
        }
    }

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }
}
