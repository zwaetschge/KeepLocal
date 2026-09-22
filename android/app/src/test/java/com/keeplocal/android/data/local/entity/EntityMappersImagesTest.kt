package com.keeplocal.android.data.local.entity

import com.keeplocal.android.domain.model.Note
import com.keeplocal.android.domain.model.NoteColor
import com.keeplocal.android.domain.model.NoteFile
import com.keeplocal.android.domain.model.NoteImage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class EntityMappersImagesTest {

    private fun noteWithImages(images: List<NoteImage>) = Note(
        id = "n1",
        title = "Images",
        content = "Body",
        color = NoteColor.BLUE,
        isPinned = false,
        isArchived = false,
        isTodoList = false,
        todoItems = emptyList(),
        tags = emptyList(),
        sharedWith = emptyList(),
        owner = "u1",
        position = 0,
        createdAt = Instant.parse("2026-09-06T10:00:00Z"),
        updatedAt = Instant.parse("2026-09-06T10:00:00Z"),
        images = images
    )

    @Test
    fun `images survive the domain to entity to domain roundtrip`() {
        val images = listOf(
            NoteImage(
                filename = "abc.webp",
                url = "/uploads/images/abc.webp",
                thumbnailUrl = "/uploads/images/abc_t.webp",
                originalName = "Photo 2026.jpg"
            ),
            NoteImage(filename = "def.png", url = "/uploads/images/def.png")
        )

        val roundtrip = noteWithImages(images).toEntity().toDomain()

        assertEquals(images, roundtrip.images)
    }

    @Test
    fun `empty images serialize to empty json and back`() {
        val entity = noteWithImages(emptyList()).toEntity()
        assertEquals("[]", entity.imagesJson.replace(" ", ""))
        assertTrue(entity.toDomain().images.isEmpty())
    }

    @Test
    fun `legacy rows without images column default to empty list`() {
        val entity = noteWithImages(emptyList()).toEntity().copy(imagesJson = "[]")
        assertTrue(entity.toDomain().images.isEmpty())
    }

    @Test
    fun `corrupt images json degrades to empty list`() {
        val entity = noteWithImages(emptyList()).toEntity().copy(imagesJson = "{{{not json")
        assertTrue(entity.toDomain().images.isEmpty())
    }

    @Test
    fun `blank thumbnail urls are normalized to null`() {
        val entity = noteWithImages(
            listOf(NoteImage(filename = "a", url = "/uploads/a", thumbnailUrl = ""))
        ).toEntity()

        assertEquals(null, entity.toDomain().images.first().thumbnailUrl)
    }
}
