package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import kotlinx.coroutines.flow.Flow
import javax.inject.Inject

class GetNotesUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    operator fun invoke(
        search: String? = null,
        tag: String? = null,
        archived: Boolean = false
    ): Flow<Result<List<Note>>> =
        noteRepository.getNotes(search = search, tag = tag, archived = archived)
}
