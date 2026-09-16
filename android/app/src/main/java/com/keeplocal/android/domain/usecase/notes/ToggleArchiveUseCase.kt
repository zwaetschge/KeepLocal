package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class ToggleArchiveUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(id: String): Result<Note> =
        noteRepository.toggleArchive(id)
}
