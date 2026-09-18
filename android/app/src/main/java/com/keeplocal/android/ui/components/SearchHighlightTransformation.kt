package com.keeplocal.android.ui.components

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation

/**
 * Highlights in-note search hits inside the editor's content field (v1.9.0
 * Nr. 7): every hit gets a soft marker, the hit the counter points at a
 * strong one. Offsets stay untouched (identity mapping) — the transformation
 * only paints, it never moves the cursor or changes the stored text.
 *
 * Ranges are clamped against the current text so a hit list computed for an
 * older draft can never crash the render; stale hits simply fall away until
 * the next keystroke recomputes them.
 */
class SearchHighlightTransformation(
    private val hits: List<IntRange>,
    private val current: IntRange?
) : VisualTransformation {

    override fun filter(text: AnnotatedString): TransformedText {
        val length = text.length
        fun IntRange.clamped(): IntRange? {
            val start = first.coerceIn(0, length)
            val endExclusive = (last + 1).coerceIn(0, length)
            return if (endExclusive > start) start until endExclusive else null
        }

        val annotated = AnnotatedString.Builder(text).apply {
            hits.forEach { range ->
                range.clamped()?.let {
                    addStyle(
                        SpanStyle(background = HitBackground),
                        it.first,
                        it.last + 1
                    )
                }
            }
            current?.clamped()?.let {
                addStyle(
                    SpanStyle(background = CurrentHitBackground, fontWeight = FontWeight.Bold),
                    it.first,
                    it.last + 1
                )
            }
        }.toAnnotatedString()
        return TransformedText(annotated, OffsetMapping.Identity)
    }

    companion object {
        private val HitBackground = Color(0x40FFC107)
        private val CurrentHitBackground = Color(0x80FFB300)
    }
}
