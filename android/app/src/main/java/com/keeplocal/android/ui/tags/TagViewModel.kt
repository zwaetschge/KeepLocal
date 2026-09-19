package com.keeplocal.android.ui.tags

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.domain.repository.AuthRepository
import com.keeplocal.android.domain.usecase.tags.DeleteTagUseCase
import com.keeplocal.android.domain.usecase.tags.GetTagsUseCase
import com.keeplocal.android.domain.usecase.tags.MergeTagsUseCase
import com.keeplocal.android.domain.usecase.tags.RenameTagUseCase
import com.keeplocal.android.domain.usecase.tags.TagOverview
import com.keeplocal.android.util.UiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

/** Which dialog (if any) sits on top of the tag list. */
sealed interface TagDialog {
    object None : TagDialog
    data class Rename(val tag: String) : TagDialog
    data class Merge(val tag: String) : TagDialog
    data class Delete(val tag: String) : TagDialog
}

data class TagsUiState(
    val tags: UiState<List<TagOverview>> = UiState.Loading,
    val dialog: TagDialog = TagDialog.None,
    val renameInput: String = "",
    val mergeTarget: String = "",
    /** Count of notes touched by the last action, for the snackbar. */
    val affectedCount: Int? = null,
    val isWorking: Boolean = false,
    /** Tag palette (v1.10.0): tag name → hex; synced via the account prefs. */
    val tagColors: Map<String, String> = emptyMap(),
    /** Tag whose color palette dialog is open; null = closed. */
    val colorPickerFor: String? = null
)

@HiltViewModel
class TagViewModel @Inject constructor(
    private val getTagsUseCase: GetTagsUseCase,
    private val renameTagUseCase: RenameTagUseCase,
    private val mergeTagsUseCase: MergeTagsUseCase,
    private val deleteTagUseCase: DeleteTagUseCase,
    private val settingsDataStore: SettingsDataStore,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(TagsUiState())
    val uiState = _uiState.asStateFlow()

    /** Result of the last rename/merge/delete: tag + how many notes moved. */
    data class TagActionDone(val tag: String, val count: Int)

    private val _message = MutableSharedFlow<TagActionDone>(extraBufferCapacity = 1)
    val message = _message.asSharedFlow()

    private val _error = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val error = _error.asSharedFlow()

    init {
        load()
        viewModelScope.launch {
            settingsDataStore.tagColors.collect { colors ->
                _uiState.update { it.copy(tagColors = colors) }
            }
        }
    }

    /** Opens the palette for [tag] (v1.10.0). */
    fun openColorPicker(tag: String) {
        _uiState.update { it.copy(colorPickerFor = tag) }
    }

    fun closeColorPicker() {
        _uiState.update { it.copy(colorPickerFor = null) }
    }

    /**
     * Sets or clears (null) a tag's color. Optimistically stored, then pushed
     * through the preferences endpoint; a failed push keeps the local pick —
     * the colors are cosmetic, not worth blocking on.
     */
    fun setTagColor(tag: String, hex: String?) {
        val updated = _uiState.value.tagColors.toMutableMap()
        if (hex == null) updated.remove(tag) else updated[tag] = hex
        _uiState.update { it.copy(tagColors = updated) }
        viewModelScope.launch {
            settingsDataStore.setTagColors(updated)
            authRepository.pushTagColors(updated)
        }
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(tags = UiState.Loading) }
            val result = getTagsUseCase()
            val data = result.getOrNull()
            _uiState.update {
                it.copy(
                    tags = when {
                        data != null && data.isEmpty() -> UiState.Empty
                        data != null -> UiState.Success(data)
                        else -> UiState.Error(
                            (result as? com.keeplocal.android.util.Result.Error)?.message
                                ?: "Failed to load tags"
                        )
                    }
                )
            }
        }
    }

    fun openRename(tag: String) {
        _uiState.update { it.copy(dialog = TagDialog.Rename(tag), renameInput = tag) }
    }

    fun openMerge(tag: String) {
        // Preselect the first other tag so "Merge" is one tap, not two.
        _uiState.update {
            it.copy(dialog = TagDialog.Merge(tag), mergeTarget = mergeTargets(tag).firstOrNull() ?: "")
        }
    }

    fun openDelete(tag: String) {
        _uiState.update { it.copy(dialog = TagDialog.Delete(tag)) }
    }

    fun closeDialog() {
        _uiState.update { it.copy(dialog = TagDialog.None, renameInput = "", mergeTarget = "") }
    }

    fun updateRenameInput(value: String) {
        _uiState.update { it.copy(renameInput = value) }
    }

    fun updateMergeTarget(value: String) {
        _uiState.update { it.copy(mergeTarget = value) }
    }

    /** Rename = rewrite the tag on every note that carries it. */
    fun submitRename() {
        val dialog = _uiState.value.dialog as? TagDialog.Rename ?: return
        val target = _uiState.value.renameInput.trim()
        viewModelScope.launch {
            _uiState.update { it.copy(isWorking = true) }
            val result = renameTagUseCase(dialog.tag, target)
            val error = (result as? com.keeplocal.android.util.Result.Error)?.message
            val count = result.getOrNull()
            _uiState.update { it.copy(isWorking = false, dialog = TagDialog.None, renameInput = "") }
            if (count != null) {
                _message.tryEmit(TagActionDone(target, count))
                load()
            } else if (error != null) {
                _error.tryEmit(error)
            }
        }
    }

    /** Merge moves every note from the source tag onto the target tag. */
    fun submitMerge() {
        val dialog = _uiState.value.dialog as? TagDialog.Merge ?: return
        val target = _uiState.value.mergeTarget.trim()
        viewModelScope.launch {
            _uiState.update { it.copy(isWorking = true) }
            val result = mergeTagsUseCase(listOf(dialog.tag), target)
            val error = (result as? com.keeplocal.android.util.Result.Error)?.message
            val count = result.getOrNull()
            _uiState.update { it.copy(isWorking = false, dialog = TagDialog.None, mergeTarget = "") }
            if (count != null) {
                _message.tryEmit(TagActionDone(target, count))
                load()
            } else if (error != null) {
                _error.tryEmit(error)
            }
        }
    }

    /** Delete drops the tag from all notes; the notes themselves stay. */
    fun submitDelete() {
        val dialog = _uiState.value.dialog as? TagDialog.Delete ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isWorking = true) }
            val result = deleteTagUseCase(dialog.tag)
            val error = (result as? com.keeplocal.android.util.Result.Error)?.message
            val count = result.getOrNull()
            _uiState.update { it.copy(isWorking = false, dialog = TagDialog.None) }
            if (count != null) {
                _message.tryEmit(TagActionDone(dialog.tag, count))
                load()
            } else if (error != null) {
                _error.tryEmit(error)
            }
        }
    }

    /** All tags except [exclude] — the merge dialog's target choices. */
    fun mergeTargets(exclude: String): List<String> =
        ((_uiState.value.tags as? UiState.Success)?.data ?: emptyList())
            .map { it.tag }
            .filter { it != exclude }
}
