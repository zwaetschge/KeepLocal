package com.keeplocal.android.ui.trash

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import com.keeplocal.android.util.UiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class TrashUiState(
    val notes: UiState<List<Note>> = UiState.Loading,
    /** True while a restore/purge/empty call is in flight (disables actions). */
    val isMutating: Boolean = false,
    val message: String? = null
)

/**
 * Trash screen (WebUI parity): the server keeps deleted notes for 30 days
 * before its janitor purges them. This screen lists them live from the API —
 * trashed notes never enter the offline cache — and offers restore,
 * permanent delete, and "empty trash".
 */
@HiltViewModel
class TrashViewModel @Inject constructor(
    private val noteRepository: NoteRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(TrashUiState())
    val uiState = _uiState.asStateFlow()

    init {
        loadTrash()
    }

    fun loadTrash() {
        viewModelScope.launch {
            _uiState.update { it.copy(notes = UiState.Loading) }
            val result = noteRepository.getTrashedNotes()
            val data = result.getOrNull()
            _uiState.update {
                it.copy(
                    notes = when {
                        data == null -> UiState.Error("Papierkorb konnte nicht geladen werden")
                        data.isEmpty() -> UiState.Empty
                        else -> UiState.Success(data)
                    }
                )
            }
        }
    }

    fun restoreNote(id: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isMutating = true) }
            val result = noteRepository.restoreNote(id)
            val failure = (result as? Result.Error)?.message
            _uiState.update {
                it.copy(
                    isMutating = false,
                    message = failure ?: "Notiz wiederhergestellt"
                )
            }
            if (result.isSuccess) removeFromList(id)
        }
    }

    fun purgeNote(id: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isMutating = true) }
            val result = noteRepository.purgeNote(id)
            val failure = (result as? Result.Error)?.message
            _uiState.update {
                it.copy(
                    isMutating = false,
                    message = failure ?: "Notiz endgültig gelöscht"
                )
            }
            if (result.isSuccess) removeFromList(id)
        }
    }

    fun emptyTrash() {
        viewModelScope.launch {
            _uiState.update { it.copy(isMutating = true) }
            val result = noteRepository.emptyTrash()
            val removed = result.getOrNull()
            val failure = (result as? Result.Error)?.message
            _uiState.update { state ->
                state.copy(
                    isMutating = false,
                    notes = if (removed != null) UiState.Empty else state.notes,
                    message = failure ?: "$removed Notizen endgültig gelöscht"
                )
            }
        }
    }

    fun clearMessage() {
        _uiState.update { it.copy(message = null) }
    }

    private fun removeFromList(id: String) {
        val current = (_uiState.value.notes as? UiState.Success)?.data ?: return
        val remaining = current.filterNot { it.id == id }
        _uiState.update {
            it.copy(notes = if (remaining.isEmpty()) UiState.Empty else UiState.Success(remaining))
        }
    }
}
