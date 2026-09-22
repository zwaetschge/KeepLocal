package com.keeplocal.android.data.api

import com.keeplocal.android.data.api.dto.buildMarkdownImportItems
import com.keeplocal.android.domain.model.TodoItem
import com.keeplocal.android.util.MarkdownNoteParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Wire format of the v1.16.0 bulk import: the server's
 * POST /api/notes/import/markdown rebuilds the tree from the paths, so the
 * mapper's path/isFolderIndex contract has to be exact — a wrong path puts a
 * note into the wrong folder (or the root) without any error.
 */
class MarkdownBulkImportMapperTest {

    private fun todo(text: String, done: Boolean, position: Int) = TodoItem(
        id = "", text = text, isCompleted = done, position = position
    )

    @Test
    fun `folders become _index paths with isFolderIndex and default content`() {
        val parsed = MarkdownNoteParser.ParsedImport(
            dirs = listOf(
                MarkdownNoteParser.ParsedDir(
                    dirPath = "projekt/notizen",
                    title = "Notizen",
                    parentPath = "projekt",
                    indexContent = null
                )
            ),
            files = emptyList()
        )

        val items = buildMarkdownImportItems(parsed)

        assertEquals(1, items.size)
        assertEquals("projekt/notizen/_index.md", items[0].path)
        assertEquals("Notizen", items[0].title)
        assertEquals("Ohne _index gibt der Ordner sich selbst eine Überschrift", "# Notizen", items[0].content)
        assertEquals(true, items[0].isFolderIndex)
    }

    @Test
    fun `folder index content travels in the body and never as a tag list`() {
        val parsed = MarkdownNoteParser.ParsedImport(
            dirs = listOf(
                MarkdownNoteParser.ParsedDir(
                    dirPath = "projekt",
                    title = "Projekt",
                    parentPath = null,
                    indexContent = "Der aus _index.md stammende Ordnerkörper."
                )
            ),
            files = emptyList()
        )

        val items = buildMarkdownImportItems(parsed)

        assertEquals("Der aus _index.md stammende Ordnerkörper.", items[0].content)
        assertNull("Ordner tragen nie Tags", items[0].tags)
    }

    @Test
    fun `plain files map one to one and omit empty tags`() {
        val parsed = MarkdownNoteParser.ParsedImport(
            dirs = emptyList(),
            files = listOf(
                MarkdownNoteParser.ParsedFile(
                    title = "Einkaufsliste",
                    content = "Milch",
                    tags = emptyList(),
                    isTodoList = false,
                    todoItems = emptyList(),
                    parentPath = null,
                    path = "einkaufsliste.md"
                )
            )
        )

        val items = buildMarkdownImportItems(parsed)

        assertEquals(1, items.size)
        assertEquals("einkaufsliste.md", items[0].path)
        assertEquals("Einkaufsliste", items[0].title)
        assertEquals("Milch", items[0].content)
        assertNull("leere Tags bleiben weg — null statt []", items[0].tags)
        assertNull(items[0].isFolderIndex)
    }

    @Test
    fun `tagged files carry their tags`() {
        val parsed = MarkdownNoteParser.ParsedImport(
            dirs = emptyList(),
            files = listOf(
                MarkdownNoteParser.ParsedFile(
                    title = "Rezept",
                    content = "Butterbraten",
                    tags = listOf("kochen", "wochenende"),
                    isTodoList = false,
                    todoItems = emptyList(),
                    parentPath = null,
                    path = "kochen/rezept.md"
                )
            )
        )

        val items = buildMarkdownImportItems(parsed)

        assertEquals(listOf("kochen", "wochenende"), items[0].tags)
    }

    @Test
    fun `todo files serialize as isTodoList frontmatter plus checkbox markdown`() {
        val parsed = MarkdownNoteParser.ParsedImport(
            dirs = emptyList(),
            files = listOf(
                MarkdownNoteParser.ParsedFile(
                    title = "Packliste",
                    content = "",
                    tags = emptyList(),
                    isTodoList = true,
                    todoItems = listOf(
                        todo("Socken", done = true, position = 0),
                        todo("Zahnbürste", done = false, position = 1)
                    ),
                    parentPath = null,
                    path = "packliste.md"
                )
            )
        )

        val items = buildMarkdownImportItems(parsed)

        assertEquals(
            "---\nisTodoList: true\n---\n- [x] Socken\n- [ ] Zahnbürste",
            items[0].content
        )
    }

    @Test
    fun `folders come before files so the server can create the parents first`() {
        val parsed = MarkdownNoteParser.ParsedImport(
            dirs = listOf(
                MarkdownNoteParser.ParsedDir("ordner", "Ordner", null, null)
            ),
            files = listOf(
                MarkdownNoteParser.ParsedFile(
                    title = "Kind", content = "Inhalt", tags = emptyList(),
                    isTodoList = false, todoItems = emptyList(),
                    parentPath = "ordner", path = "ordner/kind.md"
                )
            )
        )

        val items = buildMarkdownImportItems(parsed)

        assertEquals(listOf("ordner/_index.md", "ordner/kind.md"), items.map { it.path })
    }

    /** End-to-end: the parser must hand every file its normalized path so the
     *  mapper can address it — the tree on the server IS these paths. */
    @Test
    fun `parse carries normalized paths through to the import items`() {
        val files = listOf(
            MarkdownNoteParser.FileEntry("projekt/_index.md", "# Projekt"),
            MarkdownNoteParser.FileEntry("projekt/notizen/idee.md", "# Idee\n#idee\nEin Gedankenblitz")
        )
        val parsed = (MarkdownNoteParser.parse(files) as MarkdownNoteParser.Result.Success).import

        val items = buildMarkdownImportItems(parsed)

        assertEquals(
            listOf("projekt/_index.md", "projekt/notizen/_index.md", "projekt/notizen/idee.md"),
            items.map { it.path }
        )
        assertEquals(true, items[0].isFolderIndex)
        assertEquals(true, items[1].isFolderIndex)
        assertEquals("Stub-Ordner ohne eigenen Index bekommen eine Überschrift", "# notizen", items[1].content)
        assertNull(items[2].isFolderIndex)
        assertEquals("Idee", items[2].title)
        assertEquals(listOf("idee"), items[2].tags)
    }
}
