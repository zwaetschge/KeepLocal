package com.keeplocal.android.util

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteColor
import com.keeplocal.android.domain.model.TodoItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class NoteShareFormatterTest {

    private fun note(
        title: String,
        content: String = "",
        todos: List<TodoItem> = emptyList(),
        tags: List<String> = emptyList()
    ): Note {
        val now = Instant.now()
        return Note(
            id = "1", title = title, content = content,
            color = NoteColor.DEFAULT, isPinned = false, isArchived = false,
            isTodoList = todos.isNotEmpty(), todoItems = todos, tags = tags,
            sharedWith = emptyList(), owner = "me", position = 0,
            createdAt = now, updatedAt = now
        )
    }

    @Test
    fun `plain text contains title content todos and tags`() {
        val text = NoteShareFormatter.plainText(
            note(
                "Einkauf",
                content = "bitte bald",
                todos = listOf(TodoItem("a", "Milch", true, 0), TodoItem("b", "Brot", false, 1)),
                tags = listOf("liste")
            ),
            appLabel = "KeepLocal"
        )

        assertTrue(text.startsWith("Einkauf"))
        assertTrue(text.contains("bitte bald"))
        assertTrue(text.contains("[x] Milch"))
        assertTrue(text.contains("[ ] Brot"))
        assertTrue(text.contains("#liste"))
        assertTrue(text.trim().endsWith("KeepLocal"))
    }

    @Test
    fun `untitled note shares with fallback title`() {
        val text = NoteShareFormatter.plainText(note("", content = "nur inhalt"), appLabel = "KeepLocal")

        assertTrue(text.startsWith(NoteExportFormatter.UNTITLED))
    }

    @Test
    fun `duplicateTitle appends the copy label`() {
        assertEquals("Einkauf (Kopie)", NoteShareFormatter.duplicateTitle("Einkauf", "Kopie"))
    }

    @Test
    fun `untitled note stays untitled when duplicated`() {
        assertEquals("", NoteShareFormatter.duplicateTitle("", "Kopie"))
    }
}
