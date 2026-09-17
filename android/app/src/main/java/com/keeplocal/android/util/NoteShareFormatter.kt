package com.keeplocal.android.util

import com.keeplocal.android.domain.model.Note

/**
 * Plain-text rendering for the Android share sheet (v1.8.0 Nr. 8) and the
 * title helper for "duplicate". Pure string building, unit-tested.
 */
object NoteShareFormatter {

    /** Header line for shared notes ("KeepLocal" + note title). */
    fun plainText(note: Note, appLabel: String): String = buildString {
        append(note.title.ifBlank { NoteExportFormatter.UNTITLED })
        append("\n\n")
        if (note.content.isNotBlank()) {
            append(note.content.trimEnd())
            append("\n\n")
        }
        note.todoItems.forEach { item ->
            appendLine(if (item.isCompleted) "[x] ${item.text}" else "[ ] ${item.text}")
        }
        if (note.todoItems.isNotEmpty()) appendLine()
        if (note.tags.isNotEmpty()) {
            appendLine(note.tags.joinToString(" ") { "#$it" })
        }
        append("— $appLabel")
    }

    /** Title for a duplicate: "Einkauf (Kopie)"; an untitled note stays untitled. */
    fun duplicateTitle(title: String, copyLabel: String): String =
        if (title.isBlank()) title else "$title ($copyLabel)"
}
