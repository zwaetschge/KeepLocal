package com.keeplocal.android.util

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteColor
import com.keeplocal.android.domain.model.TodoItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class PdfNoteFormatterTest {

    private fun note(
        title: String = "Titel",
        content: String = "Erste Zeile",
        tags: List<String> = emptyList(),
        isTodoList: Boolean = false,
        todoItems: List<TodoItem> = emptyList(),
        remindAt: Instant? = null
    ) = Note(
        id = "n1",
        title = title,
        content = content,
        color = NoteColor.DEFAULT,
        isPinned = false,
        isArchived = false,
        isTodoList = isTodoList,
        todoItems = todoItems,
        tags = tags,
        sharedWith = emptyList(),
        owner = "user",
        position = 0,
        createdAt = Instant.parse("2026-01-01T10:00:00Z"),
        updatedAt = Instant.parse("2026-02-02T12:00:00Z"),
        remindAt = remindAt
    )

    @Test
    fun `text note renders title tags body and footer in order`() {
        val text = PdfNoteFormatter.documentText(
            note(title = "Packliste", content = "Socken", tags = listOf("urlaub", "sommer"))
        )
        val lines = text.lines()
        assertEquals("Packliste", lines[0])
        assertEquals("#urlaub #sommer", lines[1])
        assertEquals("", lines[2])
        assertEquals("Socken", lines[3])
        assertTrue(lines.last().startsWith("— "))
        assertTrue(lines.last().contains("Erinnerung") == false)
    }

    @Test
    fun `reminder lands in the footer`() {
        val text = PdfNoteFormatter.documentText(
            note(remindAt = Instant.parse("2026-03-03T09:00:00Z"))
        )
        assertTrue(text.contains("Erinnerung:"))
    }

    @Test
    fun `checklist renders done and open markers`() {
        val text = PdfNoteFormatter.documentText(
            note(
                isTodoList = true,
                content = "wird nicht ausgegeben",
                todoItems = listOf(
                    TodoItem("a", "Ladekabel", true, 0),
                    TodoItem("b", "Socken", false, 1)
                )
            )
        )
        val lines = text.lines().filter { it.isNotBlank() }
        assertTrue(lines.contains("[x] Ladekabel"))
        assertTrue(lines.contains("[ ] Socken"))
        assertTrue(!lines.contains("wird nicht ausgegeben"))
    }

    @Test
    fun `note without title starts directly with the body`() {
        val text = PdfNoteFormatter.documentText(note(title = "", content = "Nur Text"))
        assertEquals("Nur Text", text.lines().first())
    }

    @Test
    fun `completely empty note produces empty text`() {
        val text = PdfNoteFormatter.documentText(note(title = "", content = ""))
        // Only the metadata footer remains.
        assertEquals(1, text.lines().size)
        assertTrue(text.startsWith("— "))
    }
}
