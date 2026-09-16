package com.keeplocal.android.domain.usecase.notes

import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.NoteExportFormatter
import com.keeplocal.android.util.Result
import java.time.Instant
import javax.inject.Inject

/**
 * User-triggered export (v1.6.0 Nr. 7): renders every live note (active +
 * archived, offline cache as fallback) as a JSON backup or a readable
 * Markdown archive. The caller owns writing the string to the SAF document.
 */
class ExportNotesUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    enum class Format { JSON, MARKDOWN }

    suspend operator fun invoke(format: Format): Result<String> {
        val notes = noteRepository.getAllNotesForExport().getOrNull()
            ?: return Result.Error("Notizen konnten nicht geladen werden")
        val generatedAt = Instant.now()
        return Result.Success(
            when (format) {
                Format.JSON -> NoteExportFormatter.json(notes, generatedAt)
                Format.MARKDOWN -> NoteExportFormatter.markdown(notes, generatedAt)
            }
        )
    }
}
