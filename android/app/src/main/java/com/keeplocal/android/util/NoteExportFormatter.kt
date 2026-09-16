package com.keeplocal.android.util

import com.keeplocal.android.domain.model.Note
import java.time.Instant
import java.time.format.DateTimeFormatter

/**
 * Renders notes for the user-triggered export (v1.6.0 Nr. 7) — pure string
 * building, unit-tested, no Android dependencies. Two formats:
 *
 *  - JSON: full fidelity backup (ids, todos, images, sharing) so nothing is
 *    lost even though the server has no import yet — re-import tooling can
 *    be built against this shape later.
 *  - Markdown: readable archive a user can open anywhere; content and todos
 *    verbatim, metadata as a subtitle line.
 */
object NoteExportFormatter {

    private val iso: DateTimeFormatter = DateTimeFormatter.ISO_INSTANT

    const val UNTITLED = "Ohne Titel"

    fun markdown(notes: List<Note>, generatedAt: Instant): String = buildString {
        appendLine("# KeepLocal Export")
        appendLine()
        appendLine("${notes.size} Notizen · exportiert ${iso.format(generatedAt)}")
        appendLine()
        notes.forEachIndexed { index, note ->
            if (index > 0) {
                appendLine()
                appendLine("---")
                appendLine()
            }
            appendMarkdownNote(note)
        }
    }

    private fun StringBuilder.appendMarkdownNote(note: Note) {
        appendLine("## " + note.title.ifBlank { UNTITLED }.replace('\n', ' '))
        val meta = buildList {
            add("aktualisiert ${iso.format(note.updatedAt)}")
            if (note.isPinned) add("angeheftet")
            if (note.isArchived) add("archiviert")
            note.deletedAt?.let { add("im Papierkorb") }
        }
        appendLine("_" + meta.joinToString(" · ") + "_")
        if (note.tags.isNotEmpty()) {
            appendLine(note.tags.joinToString(" ") { "#$it" })
        }
        appendLine()
        if (note.content.isNotBlank()) {
            appendLine(note.content.trimEnd())
            appendLine()
        }
        if (note.todoItems.isNotEmpty()) {
            note.todoItems.forEach { item ->
                appendLine(if (item.isCompleted) "- [x] ${item.text}" else "- [ ] ${item.text}")
            }
            appendLine()
        }
        if (note.images.isNotEmpty()) {
            appendLine("_Bilder: " + note.images.joinToString(", ") { it.originalName ?: it.filename } + "_")
            appendLine()
        }
    }

    fun json(notes: List<Note>, generatedAt: Instant): String = buildString {
        append("{\"exportedAt\":\"").append(iso.format(generatedAt)).append("\",\"notes\":[")
        notes.forEachIndexed { index, note ->
            if (index > 0) append(',')
            appendJsonNote(note)
        }
        append("]}")
    }

    private fun StringBuilder.appendJsonNote(note: Note) {
        append("{\"id\":").append(jsonString(note.id))
        append(",\"title\":").append(jsonString(note.title))
        append(",\"content\":").append(jsonString(note.content))
        append(",\"color\":").append(jsonString(note.color.hex))
        append(",\"isPinned\":").append(note.isPinned)
        append(",\"isArchived\":").append(note.isArchived)
        append(",\"isTodoList\":").append(note.isTodoList)
        append(",\"tags\":[")
        note.tags.forEachIndexed { index, tag ->
            if (index > 0) append(',')
            append(jsonString(tag))
        }
        append("],\"todoItems\":[")
        note.todoItems.forEachIndexed { index, item ->
            if (index > 0) append(',')
            append("{\"text\":").append(jsonString(item.text))
                .append(",\"completed\":").append(item.isCompleted)
                .append(",\"position\":").append(item.position)
                .append('}')
        }
        append("],\"createdAt\":\"").append(iso.format(note.createdAt))
            .append("\",\"updatedAt\":\"").append(iso.format(note.updatedAt)).append('"')
        note.deletedAt?.let {
            append(",\"deletedAt\":\"").append(iso.format(it)).append('"')
        }
        if (note.images.isNotEmpty()) {
            append(",\"images\":[")
            note.images.forEachIndexed { index, image ->
                if (index > 0) append(',')
                append("{\"filename\":").append(jsonString(image.filename))
                    .append(",\"originalName\":").append(jsonString(image.originalName ?: image.filename))
                    .append(",\"url\":").append(jsonString(image.url))
                    .append('}')
            }
            append("]")
        }
        if (note.sharedWith.isNotEmpty()) {
            append(",\"sharedWith\":[")
            note.sharedWith.forEachIndexed { index, user ->
                if (index > 0) append(',')
                append(jsonString(user.username))
            }
            append("]")
        }
        append('}')
    }

    private fun jsonString(value: String): String = "\"" + escapeJson(value) + "\""

    /** Minimal RFC 8259 escaping — quotes, backslash, named controls, other C0. */
    internal fun escapeJson(value: String): String = buildString(value.length + 2) {
        value.forEach { c ->
            when (c) {
                '\\' -> append("\\\\")
                '"' -> append("\\\"")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                else -> if (c < ' ') append("\\u%04x".format(c.code)) else append(c)
            }
        }
    }
}
