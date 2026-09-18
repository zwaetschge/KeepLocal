package com.keeplocal.android.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class InNoteSearchTest {

    private val text = "todo: Mail schreiben. todo: Einkaufen. todo: Sport."

    @Test
    fun `inactive state matches nothing`() {
        val state = InNoteSearch.State()
        assertFalse(state.isActive)
        assertTrue(InNoteSearch.hits(text, state).isEmpty())
        assertNull(InNoteSearch.currentRange(text, state))
        assertEquals(0 to 0, InNoteSearch.counter(text, state))
    }

    @Test
    fun `hits are case-insensitive and ordered`() {
        val state = InNoteSearch.onQueryChanged(InNoteSearch.State(), "TODO")
        val hits = InNoteSearch.hits(text, state)
        assertEquals(3, hits.size)
        assertEquals(0, hits[0].first)
        assertEquals(22, hits[1].first)
        assertEquals(39, hits[2].first)
    }

    @Test
    fun `query change resets to the first hit`() {
        val walked = InNoteSearch.next(text, InNoteSearch.onQueryChanged(InNoteSearch.State(), "todo"))
        val reQueried = InNoteSearch.onQueryChanged(walked, "todo")
        assertEquals(0, reQueried.hitIndex)
    }

    @Test
    fun `next wraps at the end`() {
        val first = InNoteSearch.onQueryChanged(InNoteSearch.State(), "todo")
        val second = InNoteSearch.next(text, first)
        val third = InNoteSearch.next(text, second)
        val wrapped = InNoteSearch.next(text, third)
        assertEquals(0, wrapped.hitIndex)
    }

    @Test
    fun `previous wraps at the start`() {
        val first = InNoteSearch.onQueryChanged(InNoteSearch.State(), "todo")
        val previous = InNoteSearch.previous(text, first)
        assertEquals(2, previous.hitIndex) // last of three hits
    }

    @Test
    fun `counter is one-based`() {
        val second = InNoteSearch.next(text, InNoteSearch.onQueryChanged(InNoteSearch.State(), "todo"))
        assertEquals(2 to 3, InNoteSearch.counter(text, second))
    }

    @Test
    fun `shrinking hit set coerces the index`() {
        val third = InNoteSearch.next(
            text,
            InNoteSearch.next(text, InNoteSearch.onQueryChanged(InNoteSearch.State(), "todo"))
        )
        // Same query, now against a text with a single hit.
        assertEquals(1 to 1, InNoteSearch.counter("nur todo", third))
        assertEquals(4..7, InNoteSearch.currentRange("nur todo", third))
    }

    @Test
    fun `blank query closes the search`() {
        val closed = InNoteSearch.onQueryChanged(InNoteSearch.State(query = "todo", hitIndex = 2), "  ")
        assertFalse(closed.isActive)
        assertEquals(InNoteSearch.State(), closed)
    }
}
