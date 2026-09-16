package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class DeleteNoteUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(id: String): Result<Unit> =
        noteRepository.deleteNote(id)
}
