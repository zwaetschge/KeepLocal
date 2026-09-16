package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class ShareNoteUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(noteId: String, userId: String): Result<Unit> =
        noteRepository.shareNote(noteId, userId)

    suspend fun unshare(noteId: String, userId: String): Result<Unit> =
        noteRepository.unshareNote(noteId, userId)
}
