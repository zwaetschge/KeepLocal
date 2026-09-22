package com.keeplocal.android.domain.usecase.tags

import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import kotlinx.coroutines.flow.first
import javax.inject.Inject

/**
 * Tag management (v1.9.0 Nr. 3; v1.14.0 Nr. 4): overview, rename, merge,
 * delete. Tags live on the notes — there is no separate tag entity on the
 * server. Seit Server v1.11.0 gibt es PATCH /api/notes/tags: eine Operation
 * über alle Notizen statt einem Request pro Notiz (100 Notizen = 1 statt 100
 * Requests). Offline fällt das Repository auf den alten updateNote-Pfad
 * zurück, der weiterhin offline queued.
 */
data class TagOverview(val tag: String, val noteCount: Int)

/** All tags over live + archived notes, biggest first. Local cache only. */
class GetTagsUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(): Result<List<TagOverview>> {
        val live = (noteRepository.getCachedNotes(archived = false).first() as? Result.Success)?.data
            ?: emptyList()
        val archived = (noteRepository.getCachedNotes(archived = true).first() as? Result.Success)?.data
            ?: emptyList()
        return Result.Success(
            (live + archived)
                .flatMap { it.tags }
                .groupingBy { it }
                .eachCount()
                .map { (tag, count) -> TagOverview(tag, count) }
                .sortedWith(compareByDescending<TagOverview> { it.noteCount }.thenBy { it.tag.lowercase() })
        )
    }
}

/**
 * Renames a tag on every note carrying it — one server-side updateMany.
 * Renaming onto an existing tag keeps a single tag per note (setUnion auf
 * dem Server), no special case needed.
 */
class RenameTagUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(oldName: String, newName: String): Result<Int> {
        val oldTag = oldName.trim()
        val newTag = newName.trim()
        if (oldTag.isEmpty()) return Result.Error("Der alte Tag darf nicht leer sein")
        if (newTag.isEmpty()) return Result.Error("Der neue Tag darf nicht leer sein")
        if (oldTag == newTag) return Result.Error("Alter und neuer Tag sind identisch")
        return noteRepository.applyTagOperation(action = "rename", from = listOf(oldTag), to = newTag)
    }
}

/**
 * Collapses several tags into one — the cleanup path for „einkauf“ /
 * „Einkauf“ / „shopping“. Der Server nimmt ALLE Quell-Tags in einem Request
 * (setUnion + filter), das Ziel darf selbst unter den Quellen sein.
 */
class MergeTagsUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(sources: List<String>, target: String): Result<Int> {
        val toTag = target.trim()
        val fromTags = sources.map { it.trim() }.filter { it.isNotEmpty() }.distinct()
        if (toTag.isEmpty()) return Result.Error("Der Ziel-Tag darf nicht leer sein")
        if (fromTags.isEmpty()) return Result.Error("Keine Tags zum Zusammenführen übrig")
        return noteRepository.applyTagOperation(action = "merge", from = fromTags, to = toTag)
    }
}

/** Removes a tag from every note — the notes themselves stay untouched. */
class DeleteTagUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(tag: String): Result<Int> {
        val cleanTag = tag.trim()
        if (cleanTag.isEmpty()) return Result.Error("Der Tag darf nicht leer sein")
        return noteRepository.applyTagOperation(action = "delete", from = listOf(cleanTag), to = null)
    }
}
