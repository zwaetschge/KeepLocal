package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.model.FolderScope
import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteTypeFilter
import com.keeplocal.android.domain.model.SortMode
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
        archived: Boolean = false,
        sortMode: SortMode = SortMode.MANUAL,
        limit: Int? = null,
        filter: NoteTypeFilter = NoteTypeFilter.ALL,
        scope: FolderScope = FolderScope.All
    ): Flow<Result<List<Note>>> =
        noteRepository.getNotes(
            search = search, tag = tag, archived = archived,
            sortMode = sortMode, limit = limit, filter = filter, scope = scope
        )

    /** Room-only re-read for sort switches and "load more" — no network. */
    fun invokeCached(
        search: String? = null,
        archived: Boolean = false,
        sortMode: SortMode = SortMode.MANUAL,
        limit: Int? = null,
        filter: NoteTypeFilter = NoteTypeFilter.ALL,
        scope: FolderScope = FolderScope.All
    ): Flow<Result<List<Note>>> =
        noteRepository.getCachedNotes(
            search = search, archived = archived,
            sortMode = sortMode, limit = limit, filter = filter, scope = scope
        )
}
