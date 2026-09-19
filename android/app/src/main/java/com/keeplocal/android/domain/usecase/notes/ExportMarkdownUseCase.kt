package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import java.io.OutputStream
import javax.inject.Inject

/**
 * Markdown export (v1.10.0): streams the server-built ZIP into the stream the
 * caller opened (SAF CreateDocument gives it for Downloads/picked targets).
 * Returns the byte count for the toast. Offline edits are pushed first so
 * the archive contains them.
 */
class ExportMarkdownUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(output: OutputStream): Result<Long> =
        noteRepository.exportMarkdownTo(output)
}
