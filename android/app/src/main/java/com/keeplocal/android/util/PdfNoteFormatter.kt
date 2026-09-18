package com.keeplocal.android.util

import com.keeplocal.android.domain.model.Note
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle

/**
 * Turns a note into the plain document text for "note as PDF"
 * (v1.9.0 Nr. 8) — title, tags, body or checklist, and a metadata footer.
 * Pure string logic so the layout is unit-testable; [PdfNoteRenderer] only
 * draws what this produces.
 */
object PdfNoteFormatter {

    private val DATE_FORMAT: DateTimeFormatter =
        DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM, FormatStyle.SHORT)

    /**
     * The document as one string with explicit line breaks. Blank sections
     * collapse: a text note without tags simply starts with its body.
     */
    fun documentText(note: Note): String {
        val lines = mutableListOf<String>()

        if (note.title.isNotBlank()) lines += note.title
        if (note.tags.isNotEmpty()) lines += note.tags.joinToString(" ") { "#$it" }
        if (note.isTodoList) {
            if (lines.isNotEmpty()) lines += ""
            note.todoItems.forEach { item ->
                lines += (if (item.isCompleted) "[x] " else "[ ] ") + item.text
            }
        } else if (note.content.isNotBlank()) {
            if (lines.isNotEmpty()) lines += ""
            lines += note.content
        }

        val footer = buildString {
            append(formatTime(note.updatedAt))
            if (note.remindAt != null) {
                if (isNotEmpty()) append(" · ")
                append("Erinnerung: ").append(formatTime(note.remindAt))
            }
        }
        if (footer.isNotBlank()) {
            if (lines.isNotEmpty()) lines += ""
            lines += "— $footer"
        }
        return lines.joinToString("\n")
    }

    /** Localized formatters need zone fields a bare Instant does not carry. */
    private fun formatTime(instant: java.time.Instant): String =
        DATE_FORMAT.format(instant.atZone(ZoneId.systemDefault()))
}
