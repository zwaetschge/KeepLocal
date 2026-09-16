package com.keeplocal.android.ui.friends

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.keeplocal.android.domain.model.Friend
import com.keeplocal.android.domain.model.FriendRequest
import com.keeplocal.android.domain.repository.FriendRepository
import com.keeplocal.android.util.UiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class FriendsUiState(
    val friends: UiState<List<Friend>> = UiState.Loading,
    val requests: List<FriendRequest> = emptyList(),
    val searchQuery: String = "",
    val searchResults: List<Friend> = emptyList(),
    val isSearching: Boolean = false,
    val message: String? = null
)

@HiltViewModel
class FriendsViewModel @Inject constructor(
    private val friendRepository: FriendRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(FriendsUiState())
    val uiState = _uiState.asStateFlow()

    init {
        loadFriends()
        loadRequests()
    }

    fun loadFriends() {
        viewModelScope.launch {
            _uiState.update { it.copy(friends = UiState.Loading) }
            val result = friendRepository.getFriends()
            val data = result.getOrNull()
            _uiState.update {
                it.copy(
                    friends = when {
                        data == null -> UiState.Error("Failed to load friends")
                        data.isEmpty() -> UiState.Empty
                        else -> UiState.Success(data)
                    }
                )
            }
        }
    }

    private fun loadRequests() {
        viewModelScope.launch {
            val result = friendRepository.getRequests()
            result.getOrNull()?.let { requests ->
                _uiState.update { it.copy(requests = requests) }
            }
        }
    }

    fun onSearchQueryChanged(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        if (query.length >= 2) {
            searchUsers(query)
        } else {
            _uiState.update { it.copy(searchResults = emptyList()) }
        }
    }

    private fun searchUsers(query: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSearching = true) }
            val result = friendRepository.searchUsers(query)
            _uiState.update {
                it.copy(
                    searchResults = result.getOrNull() ?: emptyList(),
                    isSearching = false
                )
            }
        }
    }

    fun sendRequest(username: String) {
        viewModelScope.launch {
            val result = friendRepository.sendRequest(username)
            if (result.isSuccess) {
                _uiState.update { it.copy(message = "Friend request sent", searchQuery = "", searchResults = emptyList()) }
                loadRequests()
            }
        }
    }

    fun acceptRequest(id: String) {
        viewModelScope.launch {
            friendRepository.acceptRequest(id)
            loadFriends()
            loadRequests()
        }
    }

    fun rejectRequest(id: String) {
        viewModelScope.launch {
            friendRepository.rejectRequest(id)
            loadRequests()
        }
    }

    fun removeFriend(id: String) {
        viewModelScope.launch {
            friendRepository.removeFriend(id)
            loadFriends()
        }
    }

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }
}
