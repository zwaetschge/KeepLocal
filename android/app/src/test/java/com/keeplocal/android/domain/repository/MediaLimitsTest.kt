package com.keeplocal.android.domain.repository

import org.junit.Assert.assertEquals
import org.junit.Test

class MediaLimitsTest {

    @Test
    fun `full budget allows everything picked`() {
        assertEquals(5, MediaLimits.allowedPickCount(currentCount = 0, picked = 5))
        assertEquals(3, MediaLimits.allowedPickCount(currentCount = 20, picked = 3))
    }

    @Test
    fun `partial budget truncates selection`() {
        assertEquals(2, MediaLimits.allowedPickCount(currentCount = 23, picked = 5))
        assertEquals(1, MediaLimits.allowedPickCount(currentCount = 24, picked = 4))
    }

    @Test
    fun `exhausted budget allows nothing`() {
        assertEquals(0, MediaLimits.allowedPickCount(currentCount = 25, picked = 3))
        assertEquals(0, MediaLimits.allowedPickCount(currentCount = 30, picked = 1))
    }

    @Test
    fun `negative inputs never leak through`() {
        assertEquals(0, MediaLimits.allowedPickCount(currentCount = 1, picked = -3))
        assertEquals(0, MediaLimits.allowedPickCount(currentCount = -5, picked = 2))
    }

    @Test
    fun `server policies are mirrored`() {
        assertEquals(5, MediaLimits.MAX_IMAGES_PER_REQUEST)
        assertEquals(25, MediaLimits.MAX_IMAGES_PER_NOTE)
    }

    // v1.14.0 Nr. 5: PDF-Anhänge — gleiche Budget-Logik wie Bilder.

    @Test
    fun `file budget truncates and exhausts like the image budget`() {
        assertEquals(25, MediaLimits.MAX_FILES_PER_NOTE)
        assertEquals(5, MediaLimits.MAX_FILES_PER_REQUEST)
        assertEquals(5, MediaLimits.allowedFilePickCount(currentCount = 0, picked = 5))
        assertEquals(2, MediaLimits.allowedFilePickCount(currentCount = 23, picked = 5))
        assertEquals(0, MediaLimits.allowedFilePickCount(currentCount = 25, picked = 3))
        assertEquals(0, MediaLimits.allowedFilePickCount(currentCount = 1, picked = -2))
    }
}
