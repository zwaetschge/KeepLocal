package com.keeplocal.android.util

import com.keeplocal.android.domain.model.TodoItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChecklistProgressTest {

    private fun item(text: String, done: Boolean = false, position: Int = 0) =
        TodoItem(id = "id$position", text = text, isCompleted = done, position = position)

    @Test
    fun `progress counts completed over total`() {
        val items = listOf(item("Milch", true), item("Brot", false), item("Butter", false))

        val progress = ChecklistProgress.of(items)

        assertEquals(1, progress.done)
        assertEquals(3, progress.total)
        assertEquals("1/3", progress.toString())
        assertFalse(progress.isComplete)
    }

    @Test
    fun `empty list is never complete`() {
        val progress = ChecklistProgress.of(emptyList())

        assertEquals("0/0", progress.toString())
        assertFalse(progress.isComplete)
    }

    @Test
    fun `all done is complete`() {
        val progress = ChecklistProgress.of(listOf(item("a", true), item("b", true)))

        assertTrue(progress.isComplete)
    }

    @Test
    fun `cleanup drops completed and blank items and renumbers`() {
        val items = listOf(
            item("offen 1", false, 0),
            item("fertig", true, 1),
            item("  ", false, 2),
            item("offen 2", false, 3)
        )

        val cleaned = ChecklistProgress.cleanup(items)

        assertEquals(listOf("offen 1", "offen 2"), cleaned.map { it.text })
        assertEquals(listOf(0, 1), cleaned.map { it.position })
    }

    @Test
    fun `cleanup of an all-done list leaves nothing`() {
        val cleaned = ChecklistProgress.cleanup(listOf(item("x", true)))

        assertTrue(cleaned.isEmpty())
    }
}
