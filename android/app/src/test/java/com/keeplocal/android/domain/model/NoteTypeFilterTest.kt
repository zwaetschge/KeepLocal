package com.keeplocal.android.domain.model

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class NoteTypeFilterTest {

    private fun note(
        isTodoList: Boolean = false,
        images: Int = 0,
        remindAt: Instant? = null,
        isPinned: Boolean = false
    ) = Note(
        id = "n",
        title = "t",
        content = "c",
        color = NoteColor.DEFAULT,
        isPinned = isPinned,
        isArchived = false,
        isTodoList = isTodoList,
        todoItems = emptyList(),
        tags = emptyList(),
        sharedWith = emptyList(),
        owner = "u",
        position = 0,
        createdAt = Instant.EPOCH,
        updatedAt = Instant.EPOCH,
        images = List(images) {
            com.keeplocal.android.domain.model.NoteImage("f$it.webp", "/uploads/images/f$it.webp")
        },
        remindAt = remindAt
    )

    @Test
    fun `ALL accepts everything`() {
        assertTrue(NoteTypeFilter.ALL.matches(note()))
        assertTrue(NoteTypeFilter.ALL.matches(note(isTodoList = true, images = 2, remindAt = Instant.EPOCH, isPinned = true)))
    }

    @Test
    fun `LISTS and TEXT split on isTodoList`() {
        val list = note(isTodoList = true)
        val text = note(isTodoList = false)
        assertTrue(NoteTypeFilter.LISTS.matches(list))
        assertFalse(NoteTypeFilter.LISTS.matches(text))
        assertTrue(NoteTypeFilter.TEXT.matches(text))
        assertFalse(NoteTypeFilter.TEXT.matches(list))
    }

    @Test
    fun `IMAGES needs at least one attachment`() {
        assertTrue(NoteTypeFilter.IMAGES.matches(note(images = 1)))
        assertFalse(NoteTypeFilter.IMAGES.matches(note(images = 0)))
    }

    @Test
    fun `REMINDERS needs a set remindAt`() {
        assertTrue(NoteTypeFilter.REMINDERS.matches(note(remindAt = Instant.EPOCH)))
        assertFalse(NoteTypeFilter.REMINDERS.matches(note(remindAt = null)))
    }

    @Test
    fun `PINNED needs the pin`() {
        assertTrue(NoteTypeFilter.PINNED.matches(note(isPinned = true)))
        assertFalse(NoteTypeFilter.PINNED.matches(note(isPinned = false)))
    }
}
