package com.keeplocal.android.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.Instant

class TrashRetentionTest {

    private val now: Instant = Instant.parse("2026-09-14T12:00:00Z")

    @Test
    fun `live notes have no remaining days`() {
        assertNull(TrashRetention.daysRemaining(null, now))
    }

    @Test
    fun `freshly deleted note keeps the full 30 days`() {
        val deletedAt = now.minusSeconds(2 * 3600) // two hours ago
        assertEquals(30, TrashRetention.daysRemaining(deletedAt, now))
    }

    @Test
    fun `note deleted exactly now also shows 30`() {
        assertEquals(30, TrashRetention.daysRemaining(now, now))
    }

    @Test
    fun `25 whole days ago leaves 5 days`() {
        val deletedAt = now.minusSeconds(25L * 86400)
        assertEquals(5, TrashRetention.daysRemaining(deletedAt, now))
    }

    @Test
    fun `fractional days round up so the promise never reads low`() {
        // 25.5 days ago -> 4.5 days left -> still shown as 5
        val deletedAt = now.minusSeconds(25L * 86400 + 12 * 3600)
        assertEquals(5, TrashRetention.daysRemaining(deletedAt, now))
    }

    @Test
    fun `one second before expiry shows 1`() {
        val deletedAt = now.minusSeconds(30L * 86400 - 1)
        assertEquals(1, TrashRetention.daysRemaining(deletedAt, now))
    }

    @Test
    fun `expired note shows 0 not negative`() {
        val deletedAt = now.minusSeconds(30L * 86400)
        assertEquals(0, TrashRetention.daysRemaining(deletedAt, now))
    }

    @Test
    fun `long expired note also shows 0`() {
        val deletedAt = now.minusSeconds(90L * 86400)
        assertEquals(0, TrashRetention.daysRemaining(deletedAt, now))
    }
}
