package com.keeplocal.android.util

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteColor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class NoteImportParserTest {

    private fun note(
        title: String,
        content: String = "",
        isTodoList: Boolean = false,
        remindAt: Instant? = null
    ): Note {
        val now = Instant.now()
        return Note(
            id = "n-$title", title = title, content = content,
            color = NoteColor.BLUE, isPinned = false, isArchived = false,
            isTodoList = isTodoList,
            todoItems = if (isTodoList) listOf(
                com.keeplocal.android.domain.model.TodoItem("t1", "Milch", true, 0),
                com.keeplocal.android.domain.model.TodoItem("t2", "Brot", false, 1)
            ) else emptyList(),
            tags = listOf("einkauf"), sharedWith = emptyList(), owner = "me",
            position = 0, createdAt = now, updatedAt = now, remindAt = remindAt
        )
    }

    @Test
    fun `round trip through the export format preserves the note`() {
        val remindAt = Instant.parse("2026-12-24T08:00:00Z")
        val export = NoteExportFormatter.json(
            listOf(note("Einkauf", isTodoList = true, remindAt = remindAt)),
            Instant.now()
        )

        val parsed = NoteImportParser.parse(export)

        assertTrue(parsed is NoteImportParser.Result.Success)
        val imported = (parsed as NoteImportParser.Result.Success).notes.single()
        assertEquals("Einkauf", imported.title)
        assertEquals(NoteColor.BLUE.hex, imported.colorHex)
        assertTrue(imported.isTodoList)
        assertEquals(2, imported.todoItems.size)
        assertEquals("Milch", imported.todoItems[0].text)
        assertTrue(imported.todoItems[0].isCompleted)
        assertEquals(listOf("einkauf"), imported.tags)
        assertEquals(remindAt, imported.remindAt)
    }

    @Test
    fun `text note round trip keeps content`() {
        val export = NoteExportFormatter.json(listOf(note("Rezept", content = "3 Eier")), Instant.now())
        val imported = (NoteImportParser.parse(export) as NoteImportParser.Result.Success).notes.single()

        assertEquals("Rezept", imported.title)
        assertEquals("3 Eier", imported.content)
        assertNull(imported.remindAt)
    }

    @Test
    fun `missing notes field is invalid`() {
        val result = NoteImportParser.parse("{\"exportedAt\":\"2026-01-01T00:00:00Z\"}")

        assertTrue(result is NoteImportParser.Result.Invalid)
    }

    @Test
    fun `empty notes array is invalid`() {
        val result = NoteImportParser.parse("{\"notes\":[]}")

        assertTrue(result is NoteImportParser.Result.Invalid)
    }

    @Test
    fun `garbage json is invalid`() {
        assertTrue(NoteImportParser.parse("nicht json") is NoteImportParser.Result.Invalid)
    }

    @Test
    fun `completely empty note is skipped instead of failing the import`() {
        val json = """
            {"notes":[{"id":"1"},{"title":"Bleibt","content":"steht"}]}
        """.trimIndent()

        val result = NoteImportParser.parse(json)

        val imported = (result as NoteImportParser.Result.Success).notes
        assertEquals(1, imported.size)
        assertEquals("Bleibt", imported[0].title)
    }

    @Test
    fun `wrong field types fall back to defaults`() {
        val json = """
            {"notes":[{"title":123,"isPinned":"ja","tags":"kein-array"}]}
        """.trimIndent()

        val result = NoteImportParser.parse(json)

        // title is unparseable → blank; content blank → note skipped, not crashed
        assertTrue(result is NoteImportParser.Result.Invalid)
    }
}
