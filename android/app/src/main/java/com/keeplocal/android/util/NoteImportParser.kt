package com.keeplocal.android.util

import com.keeplocal.android.domain.model.TodoItem
import com.squareup.moshi.Moshi
import com.squareup.moshi.Types
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import java.time.Instant

/**
 * Reads a KeepLocal JSON export back into creatable notes (v1.8.0 Nr. 1).
 * The format is the exact shape NoteExportFormatter.json() writes — the
 * restore path is the export path mirrored. Lenient by design: a field with
 * the wrong type falls back to its default instead of failing the whole
 * import; images/sharedWith are ignored (their files live on the server and
 * cannot be re-created via the note API).
 */
object NoteImportParser {

    data class ParsedNote(
        val title: String,
        val content: String,
        val colorHex: String,
        val isPinned: Boolean,
        val isArchived: Boolean,
        val isTodoList: Boolean,
        val todoItems: List<TodoItem>,
        val tags: List<String>,
        val remindAt: Instant?
    )

    sealed interface Result {
        data class Success(val notes: List<ParsedNote>) : Result
        data class Invalid(val reason: String) : Result
    }

    private const val MAX_NOTES = 1000

    private val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
    private val mapAdapter = moshi.adapter<Map<String, Any?>>(
        Types.newParameterizedType(Map::class.java, String::class.java, Any::class.java)
    )

    fun parse(json: String): Result {
        val root = runCatching { mapAdapter.fromJson(json) }.getOrNull()
            ?: return Result.Invalid("kein JSON-Objekt")
        val rawNotes = root["notes"] as? List<*>
            ?: return Result.Invalid("Feld 'notes' fehlt")
        if (rawNotes.isEmpty()) return Result.Invalid("Export enthält keine Notizen")

        val notes = rawNotes.mapNotNull { entry -> (entry as? Map<*, *>)?.let(::parseNote) }
        if (notes.isEmpty()) return Result.Invalid("keine lesbaren Notizen")
        return Result.Success(notes.take(MAX_NOTES))
    }

    @Suppress("UNCHECKED_CAST")
    private fun parseNote(raw: Map<*, *>): ParsedNote? {
        val str = { key: String -> (raw[key] as? String)?.takeIf { it.isNotBlank() } }
        val todoItems = (raw["todoItems"] as? List<*>).orEmpty().mapNotNull { item ->
            (item as? Map<*, *>)?.let {
                val text = (it["text"] as? String).orEmpty()
                if (text.isBlank()) return@let null
                TodoItem(
                    id = "",
                    text = text.take(500),
                    isCompleted = it["completed"] as? Boolean ?: false,
                    position = (it["position"] as? Double)?.toInt() ?: 0
                )
            }
        }
        val tags = (raw["tags"] as? List<*>).orEmpty()
            .filterIsInstance<String>()
            .map { it.trim() }
            .filter { it.isNotEmpty() }
            .take(50)
        val isTodoList = raw["isTodoList"] as? Boolean ?: (todoItems.isNotEmpty() && str("content") == null)
        val title = (raw["title"] as? String).orEmpty().take(200)
        val content = (raw["content"] as? String).orEmpty().take(10000)

        // A note must carry something to show — the server rejects empty ones.
        if (title.isBlank() && content.isBlank() && todoItems.isEmpty()) return null

        return ParsedNote(
            title = title,
            content = if (isTodoList) "" else content,
            colorHex = str("color") ?: "#ffffff",
            isPinned = raw["isPinned"] as? Boolean ?: false,
            isArchived = raw["isArchived"] as? Boolean ?: false,
            isTodoList = isTodoList,
            todoItems = todoItems.take(200),
            tags = tags,
            remindAt = str("remindAt")?.let { runCatching { Instant.parse(it) }.getOrNull() }
        )
    }
}
