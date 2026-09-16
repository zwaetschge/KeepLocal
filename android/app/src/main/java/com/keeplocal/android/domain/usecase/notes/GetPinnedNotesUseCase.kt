package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class GetPinnedNotesUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    /** Local cache only — the widget must render instantly and offline. */
    suspend operator fun invoke(maxCount: Int = 4): Result<List<Note>> =
        noteRepository.getPinnedNotes(maxCount)
}
