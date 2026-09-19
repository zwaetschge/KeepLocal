package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.model.NoteTreeNode
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

/**
 * The whole live note tree out of the Room cache (v1.10.0) — the sidebar
 * panel's source. A note with children is a folder; there is no separate
 * folder type to fetch.
 */
class GetNoteTreeUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(): Result<List<NoteTreeNode>> = noteRepository.getNoteTree()
}
