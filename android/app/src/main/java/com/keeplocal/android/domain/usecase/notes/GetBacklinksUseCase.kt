package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

/**
 * "Erwähnt in" (v1.10.0): every live note whose content contains
 * [[title]] — the backlink side of the wiki links, resolved locally out of
 * the Room cache.
 */
class GetBacklinksUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(title: String, excludeId: String): Result<List<Note>> =
        noteRepository.getBacklinks(title, excludeId)
}
