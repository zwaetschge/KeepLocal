package com.keeplocal.android.util

import org.junit.Assert.assertEquals
import org.junit.Test

class SearchHighlightTest {

    @Test
    fun `blank query matches nothing`() {
        assertEquals(emptyList<IntRange>(), SearchHighlight.matchRanges("Einkaufsliste", ""))
    }

    @Test
    fun `whitespace-only query is treated as blank`() {
        assertEquals(emptyList<IntRange>(), SearchHighlight.matchRanges("Einkaufsliste", "   "))
    }

    @Test
    fun `query is trimmed before matching`() {
        val ranges = SearchHighlight.matchRanges("Milch kaufen", " Milch ")
        assertEquals(listOf(0..4), ranges)
    }

    @Test
    fun `matching is case-insensitive`() {
        assertEquals(listOf(0..6), SearchHighlight.matchRanges("EINKAUF", "einkauf"))
        assertEquals(listOf(0..6), SearchHighlight.matchRanges("einkauf", "EINKAUF"))
        assertEquals(listOf(0..6), SearchHighlight.matchRanges("Einkauf", "EINKAUF"))
    }

    @Test
    fun `single hit in the middle`() {
        assertEquals(listOf(6..8), SearchHighlight.matchRanges("Milch und Brot", "und"))
    }

    @Test
    fun `multiple hits are all reported`() {
        val text = "todo: mail schreiben, todo: einkaufen"
        assertEquals(listOf(0..3, 22..25), SearchHighlight.matchRanges(text, "todo"))
    }

    @Test
    fun `adjacent hits do not overlap`() {
        assertEquals(listOf(0..1, 2..3), SearchHighlight.matchRanges("aaaa", "aa"))
    }

    @Test
    fun `hit at start and end of text`() {
        assertEquals(listOf(0..2, 10..12), SearchHighlight.matchRanges("abc Mitte abc", "abc"))
    }

    @Test
    fun `no hit returns empty`() {
        assertEquals(emptyList<IntRange>(), SearchHighlight.matchRanges("Milch", "brot"))
    }

    @Test
    fun `query longer than text returns empty`() {
        assertEquals(emptyList<IntRange>(), SearchHighlight.matchRanges("ei", "einkauf"))
    }

    @Test
    fun `annotate without hits keeps the plain text`() {
        val annotated = SearchHighlight.annotate("Milch", "brot")
        assertEquals("Milch", annotated.text)
        assertEquals(0, annotated.spanStyles.size)
    }

    @Test
    fun `annotate wraps every hit in one span`() {
        val annotated = SearchHighlight.annotate("todo: mail, todo: einkaufen", "todo")
        assertEquals(2, annotated.spanStyles.size)
        annotated.spanStyles.forEach { span ->
            assertEquals("todo", annotated.text.substring(span.start, span.end))
        }
    }

    @Test
    fun `blank query annotates nothing`() {
        val annotated = SearchHighlight.annotate("Einkaufsliste", " ")
        assertEquals(0, annotated.spanStyles.size)
    }
}
