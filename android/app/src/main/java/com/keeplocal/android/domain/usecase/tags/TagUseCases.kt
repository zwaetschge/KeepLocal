package com.keeplocal.android.domain.usecase.tags

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.Result
import kotlinx.coroutines.flow.first
import javax.inject.Inject

/**
 * Tag management (v1.9.0 Nr. 3): overview, rename, merge, delete. Tags live
 * on the notes — there is no separate tag entity on the server — so every
 * operation rewrites the tag list of each affected note through the normal
 * updateNote path. That gives offline behaviour for free: a failing update
 * lands in the offline queue and syncs later.
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
 * Renames a tag on every note carrying it. Renaming onto an existing tag
 * keeps a single tag per note (distinct) — which is exactly the merge
 * outcome, no special case needed.
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
        return rewriteTag(from = oldTag, to = newTag)
    }

    private suspend fun rewriteTag(from: String, to: String): Result<Int> {
        val notes = notesWithTag(from)
            ?: return Result.Error("Notizen für „$from“ konnten nicht geladen werden")
        var updated = 0
        for (note in notes) {
            val result = noteRepository.updateNote(note.copy(tags = (note.tags - from + to).distinct()))
            if (result is Result.Success) updated++
        }
        return Result.Success(updated)
    }

    /** Server-side tag search with the offline cache as fallback. */
    private suspend fun notesWithTag(tag: String): List<Note>? =
        (noteRepository.getNotes(tag = tag).first() as? Result.Success)?.data
}

/**
 * Collapses several tags into one — the cleanup path for „einkauf“ /
 * „Einkauf“ / „shopping“. The target may itself be among the sources.
 */
class MergeTagsUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(sources: List<String>, target: String): Result<Int> {
        val toTag = target.trim()
        val fromTags = sources.map { it.trim() }.filter { it.isNotEmpty() && it != toTag }.distinct()
        if (toTag.isEmpty()) return Result.Error("Der Ziel-Tag darf nicht leer sein")
        if (fromTags.isEmpty()) return Result.Error("Keine Tags zum Zusammenführen übrig")

        // Collect affected notes across all source tags before writing, so
        // a note carrying two source tags ends up with exactly one target
        // tag no matter in which order the notes arrive.
        val affected = LinkedHashMap<String, Note>()
        for (tag in fromTags) {
            (noteRepository.getNotes(tag = tag).first() as? Result.Success)?.data?.forEach { note ->
                if (tag in note.tags) affected[note.id] = note
            }
        }
        if (affected.isEmpty()) return Result.Error("Keine Notizen mit diesen Tags gefunden")

        var updated = 0
        for (note in affected.values) {
            val newTags = (note.tags - fromTags.toSet() + toTag).distinct()
            if (newTags == note.tags) continue
            val result = noteRepository.updateNote(note.copy(tags = newTags))
            if (result is Result.Success) updated++
        }
        return Result.Success(updated)
    }
}

/** Removes a tag from every note — the notes themselves stay untouched. */
class DeleteTagUseCase @Inject constructor(
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(tag: String): Result<Int> {
        val cleanTag = tag.trim()
        if (cleanTag.isEmpty()) return Result.Error("Der Tag darf nicht leer sein")
        val notes = (noteRepository.getNotes(tag = cleanTag).first() as? Result.Success)?.data
            ?: return Result.Error("Notizen für „$cleanTag“ konnten nicht geladen werden")
        var updated = 0
        for (note in notes) {
            if (cleanTag !in note.tags) continue
            val result = noteRepository.updateNote(note.copy(tags = note.tags - cleanTag))
            if (result is Result.Success) updated++
        }
        return Result.Success(updated)
    }
}
