package com.keeplocal.android.ui.admin

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.keeplocal.android.domain.model.AdminSettings
import com.keeplocal.android.domain.model.AdminStats
import com.keeplocal.android.domain.model.User
import com.keeplocal.android.domain.repository.AdminRepository
import com.keeplocal.android.util.UiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AdminUiState(
    val stats: UiState<AdminStats> = UiState.Loading,
    val users: UiState<List<User>> = UiState.Loading,
    val settings: AdminSettings? = null,
    val showCreateUserDialog: Boolean = false,
    val newUsername: String = "",
    val newPassword: String = "",
    val message: String? = null
)

@HiltViewModel
class AdminViewModel @Inject constructor(
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
