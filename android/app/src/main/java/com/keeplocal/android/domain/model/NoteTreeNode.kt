package com.keeplocal.android.domain.model

/**
 * One node of the note tree (v1.10.0). The repository builds the nesting in
 * memory out of the flat Room cache — a note with children is a folder, so
 * "folder" is a view state, never a stored type. [depth] counts levels below
 * the root (0 = root level) for the indent of the tree panel.
 */
data class NoteTreeNode(
    val note: Note,
    val depth: Int,
    val children: List<NoteTreeNode>
) {
    /** Flat pre-order walk (this node, then its subtree) — move pickers and
     *  bulk actions want the whole subtree in display order. */
    fun flatten(): List<NoteTreeNode> =
        listOf(this) + children.flatMap { it.flatten() }
}
