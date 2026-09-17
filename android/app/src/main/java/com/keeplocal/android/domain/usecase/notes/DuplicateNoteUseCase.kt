package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

/**
 * Creates a detached copy of a note (v1.8.0 Nr. 8): "(Kopie)" title suffix,
 * unpinned, no shares. The copy goes through the normal create path, so it
 * also works offline via the pending-operation queue.
 */
class DuplicateNoteUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(noteId: String, copyLabel: String): Result<Note> =
        noteRepository.duplicateNote(noteId, copyLabel)
}
