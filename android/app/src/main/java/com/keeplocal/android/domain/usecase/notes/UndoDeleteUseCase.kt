package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class UndoDeleteUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    /** [note] is the snapshot from the moment of deletion. */
    suspend operator fun invoke(note: Note): Result<Unit> =
        noteRepository.undoDelete(note)
}
