package com.keeplocal.android.util

import org.junit.Assert.assertEquals
import org.junit.Test

class OrderingTest {

    private val ids = listOf("a", "b", "c", "d")

    // --- moveItem ---

    @Test
    fun `moveItem forward takes the target slot`() {
        assertEquals(listOf("b", "c", "a", "d"), Ordering.moveItem(ids, 0, 2))
    }

    @Test
    fun `moveItem backward takes the target slot`() {
        // "d" moves from index 3 to index 1: the dragged item lands in the
        // target's slot, everything between shifts right.
        assertEquals(listOf("a", "d", "b", "c"), Ordering.moveItem(ids, 3, 1))
    }

    @Test
    fun `moveItem same index is a no-op`() {
        assertEquals(ids, Ordering.moveItem(ids, 2, 2))
    }

    @Test
    fun `moveItem out-of-bounds indices return the list unchanged`() {
        assertEquals(ids, Ordering.moveItem(ids, -1, 2))
        assertEquals(ids, Ordering.moveItem(ids, 0, 4))
        assertEquals(ids, Ordering.moveItem(ids, 4, 0))
    }

    // --- orderAfterDrop ---

    @Test
    fun `drop reorders within the unpinned block`() {
        val pinned = setOf("p1")
        val ordered = listOf("p1", "a", "b", "c")
        assertEquals(
            listOf("p1", "b", "a", "c"),
            Ordering.orderAfterDrop(ordered, "a", "b", pinned)
        )
    }

    @Test
    fun `drop reorders within the pinned block`() {
        val pinned = setOf("p1", "p2", "p3")
        val ordered = listOf("p1", "p2", "p3", "a")
        assertEquals(
            listOf("p1", "p3", "p2", "a"),
            Ordering.orderAfterDrop(ordered, "p3", "p2", pinned)
        )
    }

    @Test
    fun `drop across the pinned boundary is refused`() {
        val pinned = setOf("p1")
        val ordered = listOf("p1", "a", "b")
        // Unpinned onto pinned — and the reverse — both stay as-is: crossing
        // the section line would be a pin change, not a reorder.
        assertEquals(ordered, Ordering.orderAfterDrop(ordered, "a", "p1", pinned))
        assertEquals(ordered, Ordering.orderAfterDrop(ordered, "p1", "a", pinned))
    }

    @Test
    fun `drop onto itself or unknown ids is a no-op`() {
        val ordered = listOf("p1", "a", "b")
        assertEquals(ordered, Ordering.orderAfterDrop(ordered, "a", "a", setOf("p1")))
        assertEquals(ordered, Ordering.orderAfterDrop(ordered, "x", "a", setOf("p1")))
        assertEquals(ordered, Ordering.orderAfterDrop(ordered, "a", "x", setOf("p1")))
    }
}
