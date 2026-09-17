package com.keeplocal.android.util

import org.junit.Assert.assertEquals
import org.junit.Test

class NoteLinkDetectorTest {

    @Test
    fun `finds plain https url`() {
        val links = NoteLinkDetector.find("siehe https://example.com/page für Details")

        assertEquals(1, links.size)
        assertEquals("https://example.com/page", links[0].url)
        assertEquals("https://example.com/page", links[0].target)
    }

    @Test
    fun `bare www link gets https target but raw url stays`() {
        val links = NoteLinkDetector.find("geh zu www.example.com")

        assertEquals(1, links.size)
        assertEquals("www.example.com", links[0].url)
        assertEquals("https://www.example.com", links[0].target)
    }

    @Test
    fun `trailing sentence punctuation is not part of the url`() {
        val links = NoteLinkDetector.find("Lies https://example.com/a, dann https://example.com/b.")

        assertEquals("https://example.com/a", links[0].url)
        assertEquals("https://example.com/b", links[1].url)
    }

    @Test
    fun `balanced parentheses stay inside the url`() {
        val links = NoteLinkDetector.find(
            "Artikel: https://en.wikipedia.org/wiki/Java_(programming_language). Ende"
        )

        assertEquals("https://en.wikipedia.org/wiki/Java_(programming_language)", links[0].url)
    }

    @Test
    fun `unbalanced closing paren belongs to the sentence`() {
        val links = NoteLinkDetector.find("(siehe https://example.com/x)")

        assertEquals("https://example.com/x", links[0].url)
    }

    @Test
    fun `text without urls yields nothing`() {
        assertEquals(0, NoteLinkDetector.find("keine Links hier, nur Text.").size)
    }

    @Test
    fun `ranges point at the trimmed url inside the text`() {
        val text = "vorher https://example.com/pfad nachher"
        val link = NoteLinkDetector.find(text).single()

        assertEquals("https://example.com/pfad", text.substring(link.range))
    }
}
