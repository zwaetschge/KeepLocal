package com.keeplocal.android.domain.model

/**
 * Which slice of the note tree the card grid shows (v1.10.0). The tree panel
 * picks one node; the tri-state exists because `parentId == null` alone
 * cannot distinguish "user chose the root level" from "no tree filter
 * active". SQL mapping happens in NoteQueries.folderClause.
 */
sealed interface FolderScope {
    /** No tree filter — every live note, the pre-v1.10 default view. */
    object All : FolderScope

    /** Root level only: notes with no parent, excluding folder children. */
    object Root : FolderScope

    /** One node's direct children (the node itself is opened separately). */
    data class Node(val id: String) : FolderScope

    /** In-memory twin of the SQL folder clause, for server-delivered lists
     *  (search/tag results) that skip the Room query path. */
    fun matches(parentId: String?): Boolean = when (this) {
        All -> true
        Root -> parentId == null
        is Node -> parentId == id
    }
}
