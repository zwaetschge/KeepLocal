package com.keeplocal.android.ui.components

import org.junit.Assert.assertEquals
import org.junit.Test

class MediaComponentsTest {

    // --- ImageViewerNavigation ---

    @Test
    fun `viewer clamps out-of-range indices`() {
        assertEquals(0, ImageViewerNavigation.clamp(-1, 3))
        assertEquals(2, ImageViewerNavigation.clamp(5, 3))
        assertEquals(0, ImageViewerNavigation.clamp(0, 0))
        assertEquals(1, ImageViewerNavigation.clamp(1, 3))
    }

    @Test
    fun `viewer navigation wraps around`() {
        assertEquals(1, ImageViewerNavigation.next(0, 3))
        assertEquals(2, ImageViewerNavigation.next(1, 3))
        assertEquals(0, ImageViewerNavigation.next(2, 3))
        assertEquals(2, ImageViewerNavigation.previous(0, 3))
        assertEquals(1, ImageViewerNavigation.previous(2, 3))
    }

    @Test
    fun `viewer navigation is inert for single images`() {
        assertEquals(0, ImageViewerNavigation.next(0, 1))
        assertEquals(0, ImageViewerNavigation.previous(0, 1))
        assertEquals(0, ImageViewerNavigation.next(0, 0))
    }

    // --- recording duration formatting ---

    @Test
    fun `durations format as m-ss`() {
        assertEquals("0:00", formatRecordingDuration(0))
        assertEquals("0:07", formatRecordingDuration(7_000))
        assertEquals("0:59", formatRecordingDuration(59_999))
        assertEquals("1:00", formatRecordingDuration(60_000))
        assertEquals("12:05", formatRecordingDuration(725_000))
    }

    @Test
    fun `negative durations clamp to zero`() {
        assertEquals("0:00", formatRecordingDuration(-5_000))
    }
}
