package com.keeplocal.android.util

import com.keeplocal.android.domain.model.FolderScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MarkdownNoteParserTest {

    @Test
    fun `heading becomes the title and is dropped from the body`() {
        val result = MarkdownNoteParser.parse(
            listOf(MarkdownNoteParser.FileEntry("einkauf.md", "# Einkauf\n\nMilch und Brot"))
        ) as MarkdownNoteParser.Result.Success

        val file = result.import.files.single()
        assertEquals("Einkauf", file.title)
        assertEquals("Milch und Brot", file.content)
    }

    @Test
    fun `without a heading the file name is the title`() {
        val result = MarkdownNoteParser.parse(
            listOf(MarkdownNoteParser.FileEntry("meine_notizen.md", "nur Text"))
        ) as MarkdownNoteParser.Result.Success

        assertEquals("meine notizen", result.import.files.single().title)
    }

    @Test
    fun `yaml frontmatter is skipped`() {
        val result = MarkdownNoteParser.parse(
            listOf(
                MarkdownNoteParser.FileEntry(
                    "a.md",
                    "---\ntitle: egal\ntags: [x]\n---\n\n# Real\nBody"
                )
            )
        ) as MarkdownNoteParser.Result.Success

        assertEquals("Real", result.import.files.single().title)
        assertEquals("Body", result.import.files.single().content)
    }

    @Test
    fun `standalone hashtag lines become tags not headings`() {
        val result = MarkdownNoteParser.parse(
            listOf(MarkdownNoteParser.FileEntry("a.md", "# Titel\n#arbeit\n#projekt\n\nText"))
        ) as MarkdownNoteParser.Result.Success

        val file = result.import.files.single()
        assertEquals(listOf("arbeit", "projekt"), file.tags)
        assertEquals("Text", file.content)
    }

    @Test
    fun `checkbox lines become a todo list`() {
        val result = MarkdownNoteParser.parse(
            listOf(MarkdownNoteParser.FileEntry("a.md", "# Liste\n- [ ] Milch\n* [x] Brot\n\nRest"))
        ) as MarkdownNoteParser.Result.Success

        val file = result.import.files.single()
        assertTrue(file.isTodoList)
        assertEquals(2, file.todoItems.size)
        assertEquals("Milch", file.todoItems[0].text)
        assertTrue(!file.todoItems[0].isCompleted)
        assertEquals("Brot", file.todoItems[1].text)
        assertTrue(file.todoItems[1].isCompleted)
        assertEquals("Rest", file.content)
    }

    @Test
    fun `directories become folder notes parents first`() {
        val result = MarkdownNoteParser.parse(
            listOf(
                MarkdownNoteParser.FileEntry("Projekte/_index.md", "# Projekte\n#arbeit"),
                MarkdownNoteParser.FileEntry("Projekte/ideen.md", "# Ideen\nText"),
                MarkdownNoteParser.FileEntry("Projekte/2026/plan.md", "# Plan\nText"),
                MarkdownNoteParser.FileEntry("wurzel.md", "Text ohne Heading")
            )
        ) as MarkdownNoteParser.Result.Success

        val dirs = result.import.dirs
        assertEquals(listOf("Projekte", "Projekte/2026"), dirs.map { it.dirPath })
        assertNull(dirs[0].parentPath)
        assertEquals("Projekte", dirs[1].parentPath)
        // _index.md decorates its folder instead of importing as a child:
        // its heading became the folder title, its (blank) body fell back to
        // the title so the server never sees an empty note.
        assertEquals("Projekte", dirs[0].title)
        assertEquals("Projekte", dirs[0].indexContent)
        assertNull(dirs[1].indexContent)
        val files = result.import.files
        assertEquals(3, files.size)
        assertEquals("Projekte", files.first { it.title == "Ideen" }.parentPath)
        assertEquals("Projekte/2026", files.first { it.title == "Plan" }.parentPath)
        assertNull(files.first { it.title == "wurzel" }.parentPath)
    }

    @Test
    fun `a folder without index keeps a non-blank body`() {
        val result = MarkdownNoteParser.parse(
            listOf(MarkdownNoteParser.FileEntry("Leer/irgendwas.md", "# N\nText"))
        ) as MarkdownNoteParser.Result.Success

        val dir = result.import.dirs.single()
        assertNull(dir.indexContent) // importer substitutes "# Leer" for this
        assertEquals("Leer", dir.title)
    }

    @Test
    fun `index at the picked root imports as a plain root note`() {
        val result = MarkdownNoteParser.parse(
            listOf(MarkdownNoteParser.FileEntry("_index.md", "# Sammlung\nText"))
        ) as MarkdownNoteParser.Result.Success

        assertEquals(0, result.import.dirs.size)
        val file = result.import.files.single()
        assertEquals("Sammlung", file.title)
        assertNull(file.parentPath)
    }

    @Test
    fun `non-markdown files are ignored`() {
        val result = MarkdownNoteParser.parse(
            listOf(
                MarkdownNoteParser.FileEntry("bild.png", "binary"),
                MarkdownNoteParser.FileEntry("notiz.md", "# N")
            )
        ) as MarkdownNoteParser.Result.Success

        assertEquals(1, result.import.files.size)
    }

    @Test
    fun `no markdown files is invalid`() {
        val result = MarkdownNoteParser.parse(listOf(MarkdownNoteParser.FileEntry("x.txt", "Text")))
        assertTrue(result is MarkdownNoteParser.Result.Invalid)
    }

    @Test
    fun `parentOf walks the chain and stops at the root`() {
        assertNull(MarkdownNoteParser.parentOf(""))
        assertEquals("", MarkdownNoteParser.parentOf("Projekte"))
        assertEquals("Projekte", MarkdownNoteParser.parentOf("Projekte/2026"))
    }

    @Test
    fun `folder scope tri-state matches like the SQL clause`() {
        assertTrue(FolderScope.All.matches("irgendwas"))
        assertTrue(FolderScope.All.matches(null))
        assertTrue(FolderScope.Root.matches(null))
        assertTrue(!FolderScope.Root.matches("p1"))
        assertTrue(FolderScope.Node("p1").matches("p1"))
        assertTrue(!FolderScope.Node("p1").matches("p2"))
        assertTrue(!FolderScope.Node("p1").matches(null))
    }
}
