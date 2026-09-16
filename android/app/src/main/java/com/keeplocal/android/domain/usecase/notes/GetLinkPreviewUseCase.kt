package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.model.LinkPreview
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import javax.inject.Inject

class GetLinkPreviewUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(url: String): Result<LinkPreview> =
        noteRepository.getLinkPreview(url)
}
