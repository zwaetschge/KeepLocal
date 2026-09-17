package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.NoteImportParser
import com.keeplocal.android.util.Result
import javax.inject.Inject

/**
 * Restores notes from a KeepLocal JSON export (v1.8.0 Nr. 1). Every entry
 * becomes a NEW note — nothing is ever merged onto or over an existing one —
 * and the creates route through the offline queue when the server is away.
 */
class ImportNotesUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(notes: List<NoteImportParser.ParsedNote>): Result<Int> =
        noteRepository.importNotes(notes)
}
