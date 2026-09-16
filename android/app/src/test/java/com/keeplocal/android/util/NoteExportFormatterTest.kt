package com.keeplocal.android.util

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteColor
import com.keeplocal.android.domain.model.NoteImage
import com.keeplocal.android.domain.model.SharedUser
import com.keeplocal.android.domain.model.TodoItem
import com.squareup.moshi.Moshi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class NoteExportFormatterTest {

    private val generatedAt: Instant = Instant.parse("2026-09-14T10:00:00Z")

    private fun note(
        id: String,
        title: String = "",
        content: String = "",
        isPinned: Boolean = false,
        isArchived: Boolean = false,
        tags: List<String> = emptyList(),
        todoItems: List<TodoItem> = emptyList(),
        images: List<NoteImage> = emptyList(),
        sharedWith: List<SharedUser> = emptyList()
    ): Note = Note(
        id = id,
        title = title,
        content = content,
        color = NoteColor.BLUE,
        isPinned = isPinned,
        isArchived = isArchived,
        isTodoList = todoItems.isNotEmpty(),
        todoItems = todoItems,
        tags = tags,
        sharedWith = sharedWith,
        owner = "user-1",
        position = 0,
        createdAt = Instant.parse("2026-01-01T00:00:00Z"),
        updatedAt = Instant.parse("2026-09-13T08:30:00Z"),
        images = images
    )

    /* --------------------------------- markdown --------------------------------- */

    @Test
    fun `markdown has header with count and timestamp`() {
        val md = NoteExportFormatter.markdown(listOf(note("1"), note("2")), generatedAt)
        assertTrue(md.startsWith("# KeepLocal Export"))
        assertTrue(md.contains("2 Notizen"))
        assertTrue(md.contains("2026-09-14T10:00:00Z"))
    }

    @Test
    fun `blank title falls back to untitled`() {
        val md = NoteExportFormatter.markdown(listOf(note("1", title = "  ")), generatedAt)
        assertTrue(md.contains("## " + NoteExportFormatter.UNTITLED))
    }

    @Test
    fun `multiline title collapses to one heading line`() {
        val md = NoteExportFormatter.markdown(listOf(note("1", title = "Erste\nZeile")), generatedAt)
        assertTrue(md.contains("## Erste Zeile"))
        assertFalse(md.contains("## Erste\n"))
    }

    @Test
    fun `meta line reflects pin archive and update time`() {
        val md = NoteExportFormatter.markdown(
            listOf(note("1", isPinned = true, isArchived = true)),
            generatedAt
        )
        assertTrue(md.contains("aktualisiert 2026-09-13T08:30:00Z"))
        assertTrue(md.contains("angeheftet"))
        assertTrue(md.contains("archiviert"))
    }

    @Test
    fun `tags render as hashtags`() {
        val md = NoteExportFormatter.markdown(listOf(note("1", tags = listOf("work", "home"))), generatedAt)
        assertTrue(md.contains("#work #home"))
    }

    @Test
    fun `todos render as github checkboxes`() {
        val md = NoteExportFormatter.markdown(
            listOf(
                note(
                    "1",
                    todoItems = listOf(
                        TodoItem("t1", "offen", false, 0),
                        TodoItem("t2", "erledigt", true, 1)
                    )
                )
            ),
            generatedAt
        )
        assertTrue(md.contains("- [ ] offen"))
        assertTrue(md.contains("- [x] erledigt"))
    }

    @Test
    fun `images render as filename list`() {
        val md = NoteExportFormatter.markdown(
            listOf(
                note(
                    "1",
                    images = listOf(NoteImage("a.webp", "/uploads/images/a.webp", originalName = "Urlaub.jpg"))
                )
            ),
            generatedAt
        )
        assertTrue(md.contains("Bilder: Urlaub.jpg"))
    }

    @Test
    fun `notes are separated by a rule`() {
        val md = NoteExportFormatter.markdown(listOf(note("1", title = "A"), note("2", title = "B")), generatedAt)
        assertTrue(md.contains("## A"))
        assertTrue(md.contains("## B"))
        assertTrue(md.contains("\n---\n"))
    }

    /* ----------------------------------- json ----------------------------------- */

    @Test
    fun `json output is valid parseable json`() {
        val json = NoteExportFormatter.json(
            listOf(
                note("1", title = "Einkauf", content = "Milch\nButter", tags = listOf("list")),
                note("2", title = "quote \" and \\ backslash")
            ),
            generatedAt
        )
        // Moshi's Any-adapter is a real JSON parser: if escaping were broken
        // this would throw instead of fail an assertion.
        val parsed = Moshi.Builder().build().adapter(Any::class.java).fromJson(json) as Map<*, *>
        assertEquals("2026-09-14T10:00:00Z", parsed["exportedAt"])
        val notes = parsed["notes"] as List<*>
        assertEquals(2, notes.size)
        val first = notes[0] as Map<*, *>
        assertEquals("Einkauf", first["title"])
        assertEquals("Milch\nButter", first["content"])
        assertEquals(listOf("list"), first["tags"])
    }

    @Test
    fun `json carries todos images and sharing`() {
        val json = NoteExportFormatter.json(
            listOf(
                note(
                    "1",
                    todoItems = listOf(TodoItem("t1", "kaffee", true, 0)),
                    images = listOf(NoteImage("a.webp", "/uploads/images/a.webp")),
                    sharedWith = listOf(SharedUser("u2", "anna"))
                )
            ),
            generatedAt
        )
        val parsed = Moshi.Builder().build().adapter(Any::class.java).fromJson(json) as Map<*, *>
        val note = (parsed["notes"] as List<*>)[0] as Map<*, *>
        val todo = (note["todoItems"] as List<*>)[0] as Map<*, *>
        assertEquals("kaffee", todo["text"])
        assertEquals(true, todo["completed"])
        assertEquals(0.0, todo["position"])
        val image = (note["images"] as List<*>)[0] as Map<*, *>
        assertEquals("a.webp", image["filename"])
        assertEquals(listOf("anna"), note["sharedWith"])
    }

    @Test
    fun `empty export produces an empty notes array`() {
        val json = NoteExportFormatter.json(emptyList(), generatedAt)
        val parsed = Moshi.Builder().build().adapter(Any::class.java).fromJson(json) as Map<*, *>
        assertEquals(0, (parsed["notes"] as List<*>).size)
    }

    /* -------------------------------- escaping -------------------------------- */

    @Test
    fun `escapeJson handles quotes backslash and named controls`() {
        assertEquals("\\\" \\\\ \\n \\r \\t", NoteExportFormatter.escapeJson("\" \\ " + "\n \r \t"))
    }

    @Test
    fun `escapeJson escapes backspace and form feed`() {
        assertEquals("\\b", NoteExportFormatter.escapeJson("\b"))
        assertEquals("\\f", NoteExportFormatter.escapeJson("\u000C"))
    }

    @Test
    fun `other control characters become unicode escapes`() {
        assertEquals("\\u0001", NoteExportFormatter.escapeJson("\u0001"))
        assertEquals("\\u001f", NoteExportFormatter.escapeJson("\u001F"))
    }

    @Test
    fun `plain text passes through unchanged`() {
        assertEquals("Hallo Welt 123 äöü", NoteExportFormatter.escapeJson("Hallo Welt 123 äöü"))
    }
}
