package com.keeplocal.android.ui.notes

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.domain.usecase.notes.UpdateNoteUseCase
import com.keeplocal.android.reminder.ReminderScheduler
import com.keeplocal.android.util.Result
import com.keeplocal.android.util.UiState
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.time.Instant
import javax.inject.Inject

data class UpcomingRemindersState(
    val notes: UiState<List<Note>> = UiState.Loading,
    /** Note whose reminder is being moved right now (row spinner). */
    val workingNoteId: String? = null
)

/**
 * "Anstehende Erinnerungen" (v1.9.0 Nr. 5): every note with a reminder still
 * in the future, soonest first. Snooze/done go through the normal note update
 * path, so the alarm reschedules itself and the edit survives offline.
 */
@HiltViewModel
class UpcomingRemindersViewModel @Inject constructor(
    private val noteRepository: NoteRepository,
    private val updateNoteUseCase: UpdateNoteUseCase
) : ViewModel() {

    private val _uiState = MutableStateFlow(UpcomingRemindersState())
    val uiState = _uiState.asStateFlow()

    private val _message = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val message = _message.asSharedFlow()

    init {
        load()
    }

    fun load() {
        viewModelScope.launch {
            _uiState.update { it.copy(notes = UiState.Loading) }
            val result = noteRepository.getUpcomingReminders()
            val data = result.getOrNull()
            _uiState.update {
                it.copy(
                    notes = when {
                        data != null && data.isEmpty() -> UiState.Empty
                        data != null -> UiState.Success(data)
                        else -> UiState.Error(
                            (result as? Result.Error)?.message ?: "Failed to load reminders"
                        )
                    }
                )
            }
        }
    }

    /** Pushes one reminder to tomorrow 9 am (the notification keeps 5 min/1 h). */
    fun snoozeUntilMorning(note: Note) = moveReminder(note, ReminderScheduler.nextMorningMillis())

    /** Marks the reminder handled: clears remindAt, alarm included. */
    fun markDone(note: Note) = moveReminder(note, null)

    private fun moveReminder(note: Note, atEpochMillis: Long?) {
        if (_uiState.value.workingNoteId != null) return
        viewModelScope.launch {
            _uiState.update { it.copy(workingNoteId = note.id) }
            val newRemindAt = atEpochMillis?.let { Instant.ofEpochMilli(it) }
            val result = updateNoteUseCase(note.copy(remindAt = newRemindAt))
            _uiState.update { it.copy(workingNoteId = null) }
            if (result is Result.Error) {
                _message.tryEmit(result.message)
            }
            load()
        }
    }
}
