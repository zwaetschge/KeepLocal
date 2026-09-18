package com.keeplocal.android.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GoogleKeepImportParserTest {

    private fun keepNoteJson(
        title: String = "Einkauf",
        textContent: String = "Milch und Brot",
        isTrashed: Boolean = false,
        isPinned: Boolean = false,
        isArchived: Boolean = false,
        color: String = "RED",
        labels: String = """[{"name":"Einkauf"}]""",
        extra: String = ""
    ) = """
        {"color":"$color","isTrashed":$isTrashed,"isPinned":$isPinned,"isArchived":$isArchived,
         "textContent":"$textContent","title":"$title","labels":$labels$extra}
    """.trimIndent()

    @Test
    fun `text note parses with color map and lowercase tags`() {
        val notes = GoogleKeepImportParser.parseFile(keepNoteJson())!!

        assertEquals(1, notes.size)
        val note = notes.first()
        assertEquals("Einkauf", note.title)
        assertEquals("Milch und Brot", note.content)
        assertEquals("#f28b82", note.colorHex) // Keep RED
        assertEquals(false, note.isPinned)
        assertEquals(listOf("einkauf"), note.tags)
        assertEquals(false, note.isTodoList)
        assertNull(note.remindAt)
    }

    @Test
    fun `unknown color falls back to white`() {
        val notes = GoogleKeepImportParser.parseFile(keepNoteJson(color = "RAINBOW"))!!
        assertEquals("#ffffff", notes.first().colorHex)
    }

    @Test
    fun `checklistItems become a todo list with running positions`() {
        val json = """
            {"color":"DEFAULT","isTrashed":false,"isPinned":false,"isArchived":false,
             "title":"Packliste","textContent":"wird ignoriert",
             "checklistItems":[{"text":"Ladekabel","isChecked":true},{"text":"Socken","isChecked":false}]}
        """.trimIndent()
        val note = GoogleKeepImportParser.parseFile(json)!!.first()

        assertTrue(note.isTodoList)
        assertEquals("", note.content) // checklist wins over text
        assertEquals(2, note.todoItems.size)
        assertEquals("Ladekabel", note.todoItems[0].text)
        assertEquals(true, note.todoItems[0].isCompleted)
        assertEquals(0, note.todoItems[0].position)
        assertEquals(false, note.todoItems[1].isCompleted)
        assertEquals(1, note.todoItems[1].position)
    }

    @Test
    fun `older listItems format parses identically`() {
        val json = """
            {"color":"DEFAULT","isTrashed":false,"isPinned":false,"isArchived":false,
             "title":"Alt","textContent":"",
             "listItems":[{"text":"Eintrag","isChecked":false}]}
        """.trimIndent()
        val note = GoogleKeepImportParser.parseFile(json)!!.first()

        assertTrue(note.isTodoList)
        assertEquals(listOf("Eintrag"), note.todoItems.map { it.text })
    }

    @Test
    fun `checklistItems win over listItems`() {
        val json = """
            {"color":"DEFAULT","isTrashed":false,"isPinned":false,"isArchived":false,
             "title":"","textContent":"",
             "checklistItems":[{"text":"neu","isChecked":false}],
             "listItems":[{"text":"alt","isChecked":false}]}
        """.trimIndent()
        assertEquals(listOf("neu"), GoogleKeepImportParser.parseFile(json)!!.first().todoItems.map { it.text })
    }

    @Test
    fun `blank checklist entries are dropped without shifting positions`() {
        val json = """
            {"color":"DEFAULT","isTrashed":false,"isPinned":false,"isArchived":false,
             "title":"","textContent":"",
             "checklistItems":[{"text":"","isChecked":false},{"text":"zweiter","isChecked":false}]}
        """.trimIndent()
        val items = GoogleKeepImportParser.parseFile(json)!!.first().todoItems
        assertEquals(1, items.size)
        // Position is the index in the export, not the surviving list.
        assertEquals(1, items.first().position)
    }

    @Test
    fun `trashed notes are skipped but not reported as invalid`() {
        val notes = GoogleKeepImportParser.parseFile(keepNoteJson(isTrashed = true))
        assertEquals(emptyList<Any>(), notes)
    }

    @Test
    fun `completely empty note yields no import`() {
        val json = """{"color":"DEFAULT","isTrashed":false,"isPinned":false,"isArchived":false,"title":"","textContent":""}"""
        assertEquals(emptyList<Any>(), GoogleKeepImportParser.parseFile(json))
    }

    @Test
    fun `non-Keep JSON returns null`() {
        // A KeepLocal export must not parse as one empty Keep note.
        assertNull(GoogleKeepImportParser.parseFile("""{"notes":[]}"""))
        assertNull(GoogleKeepImportParser.parseFile("nicht json"))
        assertNull(GoogleKeepImportParser.parseFile("""{"title":"kein Keep"}"""))
    }

    @Test
    fun `parseFiles flattens batches and dedups identical files`() {
        val a = keepNoteJson(title = "A")
        val b = keepNoteJson(title = "B")
        val parsed = GoogleKeepImportParser.parseFiles(listOf(a, a, b))
        assertEquals(listOf("A", "B"), parsed.map { it.title })
    }

    @Test
    fun `pinned and archived flags survive`() {
        val notes = GoogleKeepImportParser.parseFile(keepNoteJson(isPinned = true, isArchived = true))!!
        val note = notes.first()
        assertEquals(true, note.isPinned)
        assertEquals(true, note.isArchived)
    }
}
