package com.keeplocal.android.data.local.dao

import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.sqlite.db.SupportSQLiteQuery
import com.keeplocal.android.domain.model.FolderScope
import com.keeplocal.android.domain.model.NoteTypeFilter
import com.keeplocal.android.domain.model.SortMode

/**
 * SQL builders for the sort/paging queries (v1.8.0). Room cannot parameterize
 * ORDER BY, so the fragments are chosen from a fixed set here and only the
 * search term and limit are bound as arguments. A null limit loads everything
 * (small libraries keep the old single-shot behaviour).
 *
 * v1.9.0: queries gained a [NoteTypeFilter] and the search tolerates a blank
 * term — the type chips filter the plain list too, not just search results.
 *
 * v1.10.0: queries gained a [FolderScope] — the tree panel narrows the card
 * grid to one node (or the root level) without a second query family.
 */
object NoteQueries {

    private fun orderBy(sortMode: SortMode): String = when (sortMode) {
        // Server display order: pinned first, then manual position, then recency.
        SortMode.MANUAL -> "isPinned DESC, position ASC, updatedAt DESC"
        SortMode.UPDATED -> "isPinned DESC, updatedAt DESC"
        SortMode.CREATED -> "isPinned DESC, createdAt DESC"
        SortMode.TITLE -> "isPinned DESC, title COLLATE NOCASE ASC"
    }

    private fun limitClause(limit: Int?): String = limit?.takeIf { it > 0 }?.let { " LIMIT $it" } ?: ""

    /**
     * Structural filter as SQL. All fragments are from this fixed set, so a
     * filter value can never inject SQL. imagesJson defaults to '[]', making
     * the inequality the cheapest "has images" test available without a
     * JSON1 extension.
     */
    private fun filterClause(filter: NoteTypeFilter): String = when (filter) {
        NoteTypeFilter.ALL -> ""
        NoteTypeFilter.LISTS -> " AND isTodoList = 1"
        NoteTypeFilter.TEXT -> " AND isTodoList = 0"
        NoteTypeFilter.IMAGES -> " AND imagesJson != '[]'"
        NoteTypeFilter.REMINDERS -> " AND remindAtEpochMs IS NOT NULL"
        NoteTypeFilter.PINNED -> " AND isPinned = 1"
    }

    /**
     * Folder scope (v1.10.0) as SQL plus its bound argument. `IS` (not `=`)
     * so the ROOT variant correctly matches NULL with a bound null — SQLite
     * treats `parentId IS NULL` as true while `parentId = NULL` never is.
     */
    private fun folderClause(scope: FolderScope): Pair<String, Array<Any?>> = when (scope) {
        FolderScope.All -> "" to arrayOf()
        FolderScope.Root -> " AND parentId IS ?" to arrayOf(null)
        is FolderScope.Node -> " AND parentId IS ?" to arrayOf(scope.id)
    }

    fun liveNotes(
        sortMode: SortMode,
        limit: Int? = null,
        filter: NoteTypeFilter = NoteTypeFilter.ALL,
        scope: FolderScope = FolderScope.All
    ): SupportSQLiteQuery {
        val (folder, folderArgs) = folderClause(scope)
        return SimpleSQLiteQuery(
            "SELECT * FROM notes WHERE isArchived = 0${filterClause(filter)}$folder ORDER BY ${orderBy(sortMode)}${limitClause(limit)}",
            folderArgs
        )
    }

    fun archivedNotes(sortMode: SortMode, limit: Int? = null): SupportSQLiteQuery =
        SimpleSQLiteQuery(
            "SELECT * FROM notes WHERE isArchived = 1 ORDER BY ${orderBy(sortMode)}${limitClause(limit)}"
        )

    fun searchNotes(
        term: String,
        sortMode: SortMode,
        limit: Int? = null,
        filter: NoteTypeFilter = NoteTypeFilter.ALL,
        scope: FolderScope = FolderScope.All
    ): SupportSQLiteQuery {
        // A blank term with an active filter stays useful: the chips then
        // narrow the whole list instead of the search hits.
        val match = if (term.isBlank()) "" else
            " AND (title LIKE '%' || ? || '%' OR content LIKE '%' || ? || '%' OR " +
                "todoItemsJson LIKE '%' || ? || '%' OR tagsJson LIKE '%' || ? || '%')"
        val matchArgs: Array<Any?> = if (term.isBlank()) arrayOf() else arrayOf(term, term, term, term)
        val (folder, folderArgs) = folderClause(scope)
        // Array + Array is ambiguous in Kotlin; concatenating via lists keeps
        // the bound order (search term first, folder id after) explicit.
        val boundArgs: Array<Any?> = (matchArgs.toList() + folderArgs.toList()).toTypedArray()
        return SimpleSQLiteQuery(
            "SELECT * FROM notes WHERE isArchived = 0$match${filterClause(filter)}$folder" +
                " ORDER BY ${orderBy(sortMode)}${limitClause(limit)}",
            boundArgs
        )
    }
}
