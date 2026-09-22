package com.keeplocal.android.util

import com.keeplocal.android.domain.model.TodoItem

/**
 * Turns traversed markdown files into creatable notes (v1.10.0) — the
 * Trilium/Obsidian-style import. Directories become folder notes; `_index.md`
 * (or `index.md`) supplies a folder note's title and content and is not
 * imported as a child. Pure text transformation, no Android dependencies, so
 * the traversal (SAF) and the parsing stay independently testable.
 *
 * Per-file rules, mirroring NoteImportParser's caps:
 *  - the first heading (`# …`) becomes the title and is dropped from the body;
 *    without one the file name is the title (`_` read as a space)
 *  - a YAML frontmatter block (`---` … `---`) is skipped
 *  - stand-alone `#tag` lines become note tags
 *  - `- [ ]` / `- [x]` checkbox lines become todo items; a file that has any
 *    becomes a list note (remaining text is kept as its content)
 */
object MarkdownNoteParser {

    /** One traversed .md file: '/'-separated path relative to the picked root. */
    data class FileEntry(val path: String, val content: String)

    /** A directory that needs a folder note, parents-before-children order. */
    data class ParsedDir(
        val dirPath: String,
        val title: String,
        val parentPath: String?, // null = hangs directly off the root level
        val indexContent: String? // parsed body of the dir's _index.md, if any
    )

    data class ParsedFile(
        val title: String,
        val content: String,
        val tags: List<String>,
        val isTodoList: Boolean,
        val todoItems: List<TodoItem>,
        val parentPath: String?, // null = root level
        /** Normalized full file path ("ordner/datei.md") — v1.16.0: needed to
         *  hand the parsed tree to the server's bulk import endpoint, which
         *  rebuilds the structure from exactly these paths. */
        val path: String = ""
    )

    data class ParsedImport(val dirs: List<ParsedDir>, val files: List<ParsedFile>)

    sealed interface Result {
        data class Success(val import: ParsedImport) : Result
        data class Invalid(val reason: String) : Result
    }

    private const val MAX_FILES = 1000

    private val HEADING = Regex("^#{1,6}\\s+(.*)$")
    private val CHECKBOX = Regex("^\\s*[-*]\\s+\\[([ xX])]\\s*(.*)$")
    // Single-word tags only: "#arbeit" is a tag, "# Arbeit" a heading, and
    // "#arbeit extra" stays body text (a spaced tag would fail validation).
    private val TAG_LINE = Regex("^#(\\S+)$")

    fun parse(files: List<FileEntry>): Result {
        val markdown = files
            .asSequence()
            .map { FileEntry(normalize(it.path), it.content) }
            .filter { it.path.isNotEmpty() && it.path.endsWith(".md", ignoreCase = true) }
            .take(MAX_FILES)
            .toList()
        if (markdown.isEmpty()) return Result.Invalid("keine Markdown-Dateien gefunden")

        val dirs = linkedMapOf<String, ParsedDir>() // insertion order = first-seen depth order
        val indexBodies = mutableMapOf<String, ParsedFile>()
        val outFiles = mutableListOf<ParsedFile>()

        for (entry in markdown) {
            val dirPath = parentOf(entry.path) ?: ""
            ensureDirChain(dirPath, dirs)
            val stem = stemOf(entry.path)
            if (stem.equals("_index", ignoreCase = true) || stem.equals("index", ignoreCase = true)) {
                // First index wins; a second one in the same folder is ignored.
                val parsed = parseFile(stem, entry.content)
                indexBodies.putIfAbsent(dirPath, parsed)
                if (dirPath.isNotEmpty()) continue // folder note, not a child note
                // An _index.md at the picked root has no folder to decorate —
                // it imports as a plain root-level note instead.
            }
            outFiles += parseFile(stem, entry.content).let {
                it.copy(path = entry.path, parentPath = dirPath.ifEmpty { null })
            }
        }

        // Merge the _index.md bodies into their folders and sort by depth so
        // the importer can create every parent before its children.
        val merged = dirs.values.map { dir ->
            val index = indexBodies[dir.dirPath]
            if (index == null) dir
            else dir.copy(title = index.title.ifBlank { dir.title }, indexContent = index.content.ifBlank { null })
        }.sortedBy { it.dirPath.count { c -> c == '/' } + 1 }

        return Result.Success(ParsedImport(dirs = merged, files = outFiles))
    }

    /** Parent directory of a path segment list; null when already at the root. */
    fun parentOf(dirPath: String): String? {
        if (dirPath.isEmpty()) return null
        val cut = dirPath.lastIndexOf('/')
        return if (cut <= 0) "" else dirPath.substring(0, cut)
    }

    // --- internals ---

    /** Registers [dirPath] and every missing ancestor as folder stubs. */
    private fun ensureDirChain(dirPath: String, dirs: MutableMap<String, ParsedDir>) {
        if (dirPath.isEmpty() || dirs.containsKey(dirPath)) return
        var path: String? = dirPath
        // Register deepest-last: walk up to the shallowest missing ancestor,
        // then put() back down so parents land in the map first.
        val missing = mutableListOf<String>()
        while (path != null && path.isNotEmpty() && !dirs.containsKey(path)) {
            missing += path
            path = parentOf(path)
        }
        missing.asReversed().forEach { dirs[it] = dirStub(it) }
    }

    private fun dirStub(dirPath: String): ParsedDir {
        val name = dirPath.substringAfterLast('/')
        return ParsedDir(
            dirPath = dirPath,
            title = stemTitle(name),
            parentPath = parentOf(dirPath)?.ifEmpty { null },
            indexContent = null
        )
    }

    private fun parseFile(stem: String, rawContent: String): ParsedFile {
        val lines = stripFrontmatter(rawContent).split('\n').toMutableList()

        // The first non-blank line becomes the title when it is a heading —
        // the universal "# Title" convention; "#tag" lines never match (they
        // have no space after the hash), deeper headings stay body text.
        var title = ""
        val firstBody = lines.indexOfFirst { it.isNotBlank() }
        if (firstBody >= 0) {
            val heading = HEADING.find(lines[firstBody].trim())?.groupValues?.getOrNull(1)?.trim()
            if (!heading.isNullOrBlank()) {
                title = heading
                lines.removeAt(firstBody)
            }
        }
        if (title.isBlank()) title = stemTitle(stem)

        // Stand-alone #tag lines become tags (a heading always has a space
        // after the hashes, a tag line never does).
        val tags = mutableListOf<String>()
        lines.removeAll { line ->
            val tag = TAG_LINE.find(line.trim())?.groupValues?.getOrNull(1)?.trim()
            if (!tag.isNullOrEmpty() && tags.size < 50) {
                tags += tag.take(30)
                true
            } else {
                false
            }
        }

        // Checkbox lines become todo items; the note becomes a list note.
        val todoItems = mutableListOf<TodoItem>()
        lines.removeAll { line ->
            val match = CHECKBOX.find(line) ?: return@removeAll false
            if (todoItems.size < 200) {
                todoItems += TodoItem(
                    id = "",
                    text = match.groupValues[2].trim().take(500),
                    isCompleted = match.groupValues[1].equals("x", ignoreCase = true),
                    position = todoItems.size
                )
            }
            true
        }

        val body = lines.joinToString("\n").trim().take(10000)
        val isTodoList = todoItems.isNotEmpty()
        return ParsedFile(
            title = title.take(200),
            // A note must carry something to show — the server rejects blanks.
            content = if (isTodoList && body.isBlank()) "" else body.ifBlank { title },
            tags = tags,
            isTodoList = isTodoList,
            todoItems = todoItems,
            parentPath = null
        )
    }

    private fun stemTitle(name: String): String =
        name.removeSuffix(".md").replace('_', ' ').trim().take(200)

    private fun stemOf(path: String): String = path.substringAfterLast('/').removeSuffix(".md")

    private fun normalize(path: String): String =
        path.replace('\\', '/').split('/').filter { it.isNotEmpty() && it != "." }.joinToString("/")

    private fun stripFrontmatter(content: String): String {
        val trimmed = content.trimStart('﻿')
        if (!trimmed.startsWith("---")) return content
        val lines = trimmed.split('\n')
        if (lines.size < 2) return content
        for (i in 1 until lines.size) {
            if (lines[i].trim() == "---") return lines.drop(i + 1).joinToString("\n")
        }
        return content
    }
}
