package com.keeplocal.android.util

import android.content.Intent
import io.mockk.every
import io.mockk.mockk
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Unit tests for the pure ACTION_SEND extraction. Intent is mocked — the
 * framework class is not usable in plain JVM tests without Robolectric.
 * (Action and extra constants are compile-time inlined, so no stubbing.)
 */
class IncomingIntentsTest {

    private fun sendIntent(
        text: String?,
        subject: String? = null,
        type: String? = "text/plain"
    ): Intent = mockk {
        every { action } returns Intent.ACTION_SEND
        every { this@mockk.type } returns type
        every { getStringExtra(Intent.EXTRA_TEXT) } returns text
        every { getStringExtra(Intent.EXTRA_SUBJECT) } returns subject
    }

    @Test
    fun `subject wins as the title`() {
        val shared = IncomingIntents.parseSharedText(
            sendIntent(text = "body text", subject = "A subject")
        )!!
        assertEquals("A subject", shared.title)
        assertEquals("body text", shared.text)
    }

    @Test
    fun `short first line becomes the title when there is no subject`() {
        val shared = IncomingIntents.parseSharedText(
            sendIntent(text = "Shopping list\nMilk\nBread")
        )!!
        assertEquals("Shopping list", shared.title)
        assertEquals("Shopping list\nMilk\nBread", shared.text)
    }

    @Test
    fun `single-line share has no title`() {
        val shared = IncomingIntents.parseSharedText(sendIntent(text = "just one line"))!!
        assertNull(shared.title)
    }

    @Test
    fun `overlong first line is treated as content not a title`() {
        val longLine = "x".repeat(81)
        val shared = IncomingIntents.parseSharedText(
            sendIntent(text = "$longLine\nsecond line")
        )!!
        assertNull(shared.title)
    }

    @Test
    fun `missing or blank text is rejected`() {
        assertNull(IncomingIntents.parseSharedText(sendIntent(text = null)))
        assertNull(IncomingIntents.parseSharedText(sendIntent(text = "   ")))
    }

    @Test
    fun `non-plain-text mime types are rejected`() {
        assertNull(IncomingIntents.parseSharedText(sendIntent(text = "hello", type = "image/png")))
    }

    @Test
    fun `non-send actions are rejected`() {
        val intent = mockk<Intent> {
            every { action } returns Intent.ACTION_VIEW
            every { getStringExtra(Intent.EXTRA_TEXT) } returns "hello"
        }
        assertNull(IncomingIntents.parseSharedText(intent))
    }
}
