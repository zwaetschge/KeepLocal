package com.keeplocal.android.util

import com.keeplocal.android.domain.model.TodoItem

/**
 * Checklist progress (v1.8.0 Nr. 5): the note card shows "3/7" while a
 * checklist has items, and the editor offers to drop the completed ones.
 * Pure functions, unit-tested, no Android dependencies.
 */
object ChecklistProgress {

    data class Progress(val done: Int, val total: Int) {
        val isComplete: Boolean get() = total > 0 && done == total
        override fun toString(): String = "$done/$total"
    }

    fun of(items: List<TodoItem>): Progress =
        Progress(done = items.count { it.isCompleted }, total = items.size)

    /**
     * Checklist cleanup: removes completed items and renumbers the positions
     * 0..n so the remaining open items keep their order. Blank-text items
     * (editor artefacts) are dropped as well.
     */
    fun cleanup(items: List<TodoItem>): List<TodoItem> =
        items.filterNot { it.isCompleted || it.text.isBlank() }
            .mapIndexed { index, item -> item.copy(position = index) }
}
