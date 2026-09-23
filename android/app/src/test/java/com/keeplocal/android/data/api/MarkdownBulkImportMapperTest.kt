package com.keeplocal.android.data.api

import com.keeplocal.android.data.api.dto.buildMarkdownImportItems
import com.keeplocal.android.domain.model.TodoItem
import com.keeplocal.android.util.MarkdownNoteParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Wire format of the v1.16.0 bulk import, pinned against the SERVER source
 * (notesService.importMarkdownNotes), not against the mapper itself:
 *  - a FILE item's `path` is the PARENT FOLDER path, no file name — the
 *    server builds its folder set from the path's segment prefixes and hangs
 *    the note under folderIdByPath[path];
 *  - a folder index item's `path` is the BARE folder path with
 *    isFolderIndex=true — the server merges its title/content/tags into the
 *    folder note instead of creating an empty duplicate plus a child.
 * A wrong path puts a note into the wrong folder (or the root) without any
 * error — this suite exists so that never silently regresses.
 */
class MarkdownBulkImportMapperTest {

    private fun todo(text: String, done: Boolean, position: Int) = TodoItem(
        id = "", text = text, isCompleted = done, position = position
    )

    @Test
    fun `folders become bare dir paths with isFolderIndex and default content`() {
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
        assertEquals("projekt/notizen", items[0].path)
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

        assertEquals("projekt", items[0].path)
        assertEquals("Der aus _index.md stammende Ordnerkörper.", items[0].content)
        assertNull("Ordner tragen nie Tags", items[0].tags)
    }

    @Test
    fun `file path is the parent folder - never the file name`() {
        // The regression this pins: sending "kochen/rezept.md" made the
        // server create a phantom folder "rezept.md" and nest the note
        // inside it.
        val parsed = MarkdownNoteParser.ParsedImport(
            dirs = emptyList(),
            files = listOf(
                MarkdownNoteParser.ParsedFile(
                    title = "Rezept",
                    content = "Butterbraten",
                    tags = emptyList(),
                    isTodoList = false,
                    todoItems = emptyList(),
                    parentPath = "kochen",
                    path = "kochen/rezept.md"
                )
            )
        )

        val items = buildMarkdownImportItems(parsed)

        assertEquals("kochen", items[0].path)
    }

    @Test
    fun `root level files send an empty path`() {
        // path "" → segments [] → root note, same as the web client's
        // top-level files (folderPath of "einkaufsliste.md" is "").
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
        assertEquals("", items[0].path)
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
    fun `index and file of the same folder share the bare path`() {
        // Index item (merges INTO the folder note) and child file (hangs
        // UNDER it) both address the folder as "ordner" — distinguished only
        // by isFolderIndex.
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

        assertEquals(listOf("ordner", "ordner"), items.map { it.path })
        assertEquals(listOf(true, null), items.map { it.isFolderIndex })
    }

    /** End-to-end: the parser must hand every file its normalized parent
     *  path so the mapper can address it — the tree on the server IS these
     *  paths. */
    @Test
    fun `parse carries normalized paths through to the import items`() {
        val files = listOf(
            MarkdownNoteParser.FileEntry("projekt/_index.md", "# Projekt"),
            MarkdownNoteParser.FileEntry("projekt/notizen/idee.md", "# Idee\n#idee\nEin Gedankenblitz")
        )
        val parsed = (MarkdownNoteParser.parse(files) as MarkdownNoteParser.Result.Success).import

        val items = buildMarkdownImportItems(parsed)

        assertEquals(
            listOf("projekt", "projekt/notizen", "projekt/notizen"),
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
