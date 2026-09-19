package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

/**
 * Moves a note to another folder note (v1.10.0). null as [parentId] puts it
 * back on the root level. Cycle checks run in the repository before anything
 * is sent; the move itself is an offline-capable note update.
 */
class MoveNoteUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(id: String, parentId: String?): Result<Note> =
        noteRepository.moveNote(id, parentId)
}
