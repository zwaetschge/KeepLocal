package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

/**
 * Journal (v1.10.0): opens today's note — titled with the ISO date inside the
 * configured journal folder — and creates it on the first access of the day.
 * Backed by the "Heute" action, the calendar and the quick-settings tile.
 */
class FindOrCreateTodayNoteUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(): Result<Note> = noteRepository.findOrCreateTodayNote()
}
