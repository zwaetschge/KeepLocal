package com.keeplocal.android.data.local.dao

import androidx.sqlite.db.SimpleSQLiteQuery
import androidx.sqlite.db.SupportSQLiteQuery
import com.keeplocal.android.domain.model.SortMode

/**
 * SQL builders for the sort/paging queries (v1.8.0). Room cannot parameterize
 * ORDER BY, so the fragments are chosen from a fixed set here and only the
 * search term and limit are bound as arguments. A null limit loads everything
 * (small libraries keep the old single-shot behaviour).
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

    fun liveNotes(sortMode: SortMode, limit: Int? = null): SupportSQLiteQuery =
        SimpleSQLiteQuery(
            "SELECT * FROM notes WHERE isArchived = 0 ORDER BY ${orderBy(sortMode)}${limitClause(limit)}"
        )

    fun archivedNotes(sortMode: SortMode, limit: Int? = null): SupportSQLiteQuery =
        SimpleSQLiteQuery(
            "SELECT * FROM notes WHERE isArchived = 1 ORDER BY ${orderBy(sortMode)}${limitClause(limit)}"
        )

    fun searchNotes(term: String, sortMode: SortMode, limit: Int? = null): SupportSQLiteQuery =
        SimpleSQLiteQuery(
            "SELECT * FROM notes WHERE isArchived = 0 AND (" +
                "title LIKE '%' || ? || '%' OR content LIKE '%' || ? || '%' OR " +
                "todoItemsJson LIKE '%' || ? || '%' OR tagsJson LIKE '%' || ? || '%')" +
                " ORDER BY ${orderBy(sortMode)}${limitClause(limit)}",
            arrayOf(term, term, term, term)
        )
}
