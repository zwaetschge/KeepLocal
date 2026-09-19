package com.keeplocal.android.domain.usecase.notes

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.MarkdownNoteParser
import com.keeplocal.android.util.Result
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.inject.Inject

/**
 * Markdown/Trilium import (v1.10.0): walks the picked SAF tree (folders stay
 * folders, `_index.md` decorates them), hands the collected .md files to the
 * repository and returns how many notes were created. Binary files are
 * skipped — the import is text-only by design.
 */
class ImportMarkdownFolderUseCase @Inject constructor(
    @ApplicationContext private val context: Context,
    private val noteRepository: NoteRepository
) {
    suspend operator fun invoke(treeUri: Uri): Result<Int> = withContext(Dispatchers.IO) {
        Result.catching {
            val root = DocumentFile.fromTreeUri(context, treeUri)
                ?: throw Exception("Ordner nicht lesbar")
            val files = mutableListOf<MarkdownNoteParser.FileEntry>()
            collectMarkdownFiles(root, "", files, depthGuard = 0)
            if (files.isEmpty()) throw Exception("keine Markdown-Dateien gefunden")
            when (val result = noteRepository.importMarkdownFiles(files)) {
                is Result.Success -> result.data
                is Result.Error -> throw Exception(result.message)
            }
        }
    }

    /** Recursive SAF walk with a depth stop — a symlinked or cyclical provider
     *  must not spin this forever. Paths are built '/'-relative to the root. */
    private fun collectMarkdownFiles(
        dir: DocumentFile,
        prefix: String,
        out: MutableList<MarkdownNoteParser.FileEntry>,
        depthGuard: Int
    ) {
        if (depthGuard > MAX_DEPTH) return
        for (doc in dir.listFiles()) {
            val name = doc.name ?: continue
            val path = if (prefix.isEmpty()) name else "$prefix/$name"
            when {
                doc.isDirectory -> collectMarkdownFiles(doc, path, out, depthGuard + 1)
                doc.isFile && name.endsWith(".md", ignoreCase = true) -> {
                    val content = runCatching {
                        context.contentResolver.openInputStream(doc.uri)?.use { input ->
                            input.readBytes().toString(Charsets.UTF_8)
                        }
                    }.getOrNull() ?: continue
                    out += MarkdownNoteParser.FileEntry(path, content)
                }
            }
            if (out.size >= MAX_FILES) return
        }
    }

    private companion object {
        const val MAX_DEPTH = 20
        const val MAX_FILES = 1000
    }
}
