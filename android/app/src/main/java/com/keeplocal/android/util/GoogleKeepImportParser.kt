package com.keeplocal.android.util

import com.keeplocal.android.domain.model.TodoItem
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory

/**
 * Reads Google Keep Takeout JSON into the same ParsedNote shape the KeepLocal
 * import pipeline consumes (v1.9.0 Nr. 1) — every note becomes a new copy via
 * the offline-queueing create path, nothing is merged.
 *
 * Takeout exports one JSON object per note (one file per note inside the
 * Takeout/Keep folder), so the
 * settings screen feeds this parser every selected file and the whole batch
 * in one import. Two list formats exist in the wild: `checklistItems` (newer)
 * and `listItems` (older); both are read, checklist first.
 *
 * Deliberately ignored: attachments (image files cannot be re-created via the
 * note API), annotations (link metadata the server refetches itself),
 * userEditedTimestampUsec (the server stamps every created note itself — a
 * client timestamp would be overwritten on first sync anyway) and trashed
 * notes (they are deleted in Keep, importing them would resurrect garbage).
 */
object GoogleKeepImportParser {

    /** Keep color names (both casing variants seen in exports) → KeepLocal hex. */
    private val COLOR_MAP: Map<String, String> = mapOf(
        "DEFAULT" to "#ffffff",
        "RED" to "#f28b82",
        "ORANGE" to "#fbbc04",
        "YELLOW" to "#fff475",
        "GREEN" to "#ccff90",
        "TEAL" to "#a7ffeb",
        "BLUE" to "#cbf0f8",
        "CERULEAN" to "#aecbfa",
        "PURPLE" to "#d7aefb",
        "PINK" to "#fdcfe8",
        "BROWN" to "#e6c9a8",
        "GRAY" to "#e8eaed"
    )

    private const val MAX_NOTES = 1000

    private val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
    private val mapAdapter = moshi.adapter<Map<String, Any?>>(
        Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
    )

    /**
     * @return the parsed notes of this file (empty when the file is a trashed
     *         note or carries nothing importable) — or null when the file is
     *         not a Keep note at all, so the caller can report it as skipped.
     */
    fun parseFile(json: String): List<NoteImportParser.ParsedNote>? {
        val root = runCatching { mapAdapter.fromJson(json) }.getOrNull() ?: return null
        // A Keep note is recognizable by its marker fields; a KeepLocal export
        // ({"notes": [...]}) must not silently parse as one empty Keep note.
        val isKeepNote = root.containsKey("isPinned") &&
            (root.containsKey("textContent") || root.containsKey("checklistItems") || root.containsKey("listItems"))
        if (!isKeepNote) return null

        val note = parseNote(root) ?: return emptyList()
        return listOf(note)
    }

    /** Flattens a batch of files, de-duplicating identical file content. */
    fun parseFiles(jsons: List<String>): List<NoteImportParser.ParsedNote> {
        val seen = HashSet<Int>()
        val notes = mutableListOf<NoteImportParser.ParsedNote>()
        for (json in jsons) {
            val parsed = parseFile(json) ?: continue
            // Takeout occasionally contains the same note twice; the raw JSON
            // hash is a good enough identity for byte-identical duplicates.
            if (seen.add(json.hashCode())) {
                notes.addAll(parsed)
            }
        }
        return notes.take(MAX_NOTES)
    }

    private fun parseNote(raw: Map<String, Any?>): NoteImportParser.ParsedNote? {
        if (raw["isTrashed"] as? Boolean == true) return null

        val title = (raw["title"] as? String).orEmpty().take(200)
        val textContent = (raw["textContent"] as? String).orEmpty().take(10000)
        val checklist = rawListItems(raw, "checklistItems").ifEmpty { rawListItems(raw, "listItems") }

        // Keep notes are either text or list; if both exist the list wins
        // because checkbox state is the richer structure.
        val isTodoList = checklist.isNotEmpty()
        if (title.isBlank() && textContent.isBlank() && checklist.isEmpty()) return null

        val tags = (raw["labels"] as? List<*>).orEmpty()
            .mapNotNull { (it as? Map<*, *>)?.get("name") as? String }
            .map { it.trim().lowercase() }
            .filter { it.isNotEmpty() }
            .take(50)

        val colorName = (raw["color"] as? String)?.uppercase()
        val colorHex = COLOR_MAP[colorName] ?: "#ffffff"

        return NoteImportParser.ParsedNote(
            title = title,
            content = if (isTodoList) "" else textContent,
            colorHex = colorHex,
            isPinned = raw["isPinned"] as? Boolean ?: false,
            isArchived = raw["isArchived"] as? Boolean ?: false,
            isTodoList = isTodoList,
            todoItems = checklist.take(200),
            tags = tags,
            remindAt = null // Keep has no server-side reminders in Takeout
        )
    }

    private fun rawListItems(raw: Map<String, Any?>, key: String): List<TodoItem> {
        val items = raw[key] as? List<*> ?: return emptyList()
        return items.mapIndexedNotNull { index, entry ->
            (entry as? Map<*, *>)?.let {
                val text = (it["text"] as? String).orEmpty()
                if (text.isBlank()) return@let null
                TodoItem(
                    id = "",
                    text = text.take(500),
                    isCompleted = it["isChecked"] as? Boolean ?: false,
                    position = index
                )
            }
        }
    }
}
