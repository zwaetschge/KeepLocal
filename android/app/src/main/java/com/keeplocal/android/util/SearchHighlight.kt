package com.keeplocal.android.util

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight

/**
 * Search-match highlighting (v1.7.0 design round): bold spans over every
 * case-insensitive hit of the current query, in note titles and previews.
 * Pure string/AnnotatedString logic so the span layout is unit-testable
 * without composition.
 */
object SearchHighlight {

    /**
     * Char-index ranges of every case-insensitive [query] hit in [text].
     * A blank/whitespace query highlights nothing. Matches never overlap:
     * scanning resumes at the end of the previous hit.
     */
    fun matchRanges(text: String, query: String): List<IntRange> {
        val q = query.trim()
        if (q.isEmpty()) return emptyList()
        val ranges = mutableListOf<IntRange>()
        var from = 0
        while (true) {
            val idx = text.indexOf(q, from, ignoreCase = true)
            if (idx < 0) break
            val end = idx + q.length
            ranges += idx until end
            from = end
        }
        return ranges
    }

    /**
     * [text] with a [style] span over every query hit — bold by default.
     * Returns the plain string untouched when there is nothing to highlight.
     */
    fun annotate(
        text: String,
        query: String,
        style: SpanStyle = SpanStyle(fontWeight = FontWeight.Bold)
    ): AnnotatedString {
        val ranges = matchRanges(text, query)
        if (ranges.isEmpty()) return AnnotatedString(text)
        return AnnotatedString.Builder(text).apply {
            ranges.forEach { addStyle(style, it.first, it.last + 1) }
        }.toAnnotatedString()
    }
}
