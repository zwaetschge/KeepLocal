package com.keeplocal.android.util

/** Pure list-order helpers for the drag & drop reorder (unit-tested). */
object Ordering {

    /** Moves the id at [fromIndex] to [toIndex]; unchanged list on bad indices. */
    fun moveItem(ids: List<String>, fromIndex: Int, toIndex: Int): List<String> {
        if (fromIndex == toIndex) return ids
        if (fromIndex !in ids.indices || toIndex !in ids.indices) return ids
        return ids.toMutableList().apply { add(toIndex, removeAt(fromIndex)) }
    }

    /**
     * Order after dropping [draggedId] onto [targetId]: the dragged item
     * takes the target's slot. Refuses to cross into a foreign section —
     * when the two ids are not adjacent within the same contiguous block
     * (both pinned or both unpinned) the order stays as-is.
     */
    fun orderAfterDrop(
        orderedIds: List<String>,
        draggedId: String,
        targetId: String,
        pinnedIds: Set<String>
    ): List<String> {
        val from = orderedIds.indexOf(draggedId)
        val to = orderedIds.indexOf(targetId)
        if (from < 0 || to < 0 || from == to) return orderedIds
        val draggedIsPinned = draggedId in pinnedIds
        val targetIsPinned = targetId in pinnedIds
        // Reordering across the pinned/unpinned boundary would need a pin
        // change, not a position change — ignore such drops.
        if (draggedIsPinned != targetIsPinned) return orderedIds
        return moveItem(orderedIds, from, to)
    }
}
