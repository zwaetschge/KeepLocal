package com.keeplocal.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.unit.dp

/**
 * Which scene the empty-state line art shows (v1.7.0 Nr. 9): the KeepLocal
 * note sheet with a badge glyph that tells the story of the screen.
 */
enum class EmptyStateVariant { NOTES, SEARCH, ARCHIVE, TRASH }

/**
 * Line-art version of the brand mark for empty and no-result screens. Same
 * sheet geometry as [KeepLocalLogo] but stroke-only and theme-tinted, so it
 * sits quietly on every theme incl. e-ink and doodle.
 */
@Composable
fun EmptyStateIllustration(
    variant: EmptyStateVariant,
    modifier: Modifier = Modifier,
    tint: Color = MaterialTheme.colorScheme.onSurfaceVariant,
    accent: Color = MaterialTheme.colorScheme.primary
) {
    Canvas(modifier = modifier.size(96.dp)) {
        val scale = this.size.width / 48f
        withTransform({ scale(scale, scale, pivot = Offset.Zero) }) {
            drawEmptySheet(variant, tint, accent)
        }
    }
}

private fun DrawScope.drawEmptySheet(variant: EmptyStateVariant, tint: Color, accent: Color) {
    val stroke = Stroke(width = 2.2f, cap = StrokeCap.Round, join = StrokeJoin.Round)

    // Sheet outline (same silhouette as the brand mark, incl. the folded corner)
    val sheet = Path().apply {
        moveTo(30f, 6.5f)
        lineTo(38f, 14.5f)
        lineTo(38f, 39f)
        quadraticBezierTo(38f, 42f, 35f, 42f)
        lineTo(15f, 42f)
        quadraticBezierTo(12f, 42f, 12f, 39f)
        lineTo(12f, 9.5f)
        quadraticBezierTo(12f, 6.5f, 15f, 6.5f)
        lineTo(30f, 6.5f)
        close()
    }
    drawPath(sheet, tint, style = stroke)

    // Fold line
    drawLine(tint, Offset(30f, 6.5f), Offset(30f, 11.5f), 2.2f, cap = StrokeCap.Round)
    drawLine(tint, Offset(30f, 11.5f), Offset(38f, 14.5f), 2.2f, cap = StrokeCap.Round)

    // Two ghost text lines
    drawLine(accent, Offset(17f, 19.5f), Offset(33f, 19.5f), 2.4f, cap = StrokeCap.Round)
    drawLine(accent.copy(alpha = 0.55f), Offset(17f, 25f), Offset(27f, 25f), 2.4f, cap = StrokeCap.Round)

    // Badge + per-variant glyph
    val badgeCenter = Offset(32.5f, 36.5f)
    drawCircle(accent, radius = 5.8f, center = badgeCenter, style = Stroke(width = 2.2f))
    when (variant) {
        EmptyStateVariant.NOTES -> {
            // The brand check.
            val check = Path().apply {
                moveTo(29.9f, 36.7f)
                lineTo(31.7f, 38.5f)
                lineTo(35.3f, 34.6f)
            }
            drawPath(check, accent, style = stroke)
        }
        EmptyStateVariant.SEARCH -> {
            // Magnifier instead of a badge: circle + handle.
            drawCircle(accent, radius = 4.6f, center = Offset(31.5f, 35.5f), style = Stroke(width = 2.2f))
            drawLine(accent, Offset(34.9f, 38.9f), Offset(38.5f, 42.5f), 2.6f, cap = StrokeCap.Round)
        }
        EmptyStateVariant.ARCHIVE -> {
            // Arrow down into the sheet: "filed away".
            drawLine(accent, Offset(32.5f, 34f), Offset(32.5f, 39f), 2.2f, cap = StrokeCap.Round)
            drawLine(accent, Offset(30.7f, 37.4f), Offset(32.5f, 39.2f), 2.2f, cap = StrokeCap.Round)
            drawLine(accent, Offset(34.3f, 37.4f), Offset(32.5f, 39.2f), 2.2f, cap = StrokeCap.Round)
        }
        EmptyStateVariant.TRASH -> {
            // Crossed out: nothing left to restore.
            drawLine(accent, Offset(30.6f, 34.6f), Offset(34.4f, 38.4f), 2.2f, cap = StrokeCap.Round)
            drawLine(accent, Offset(34.4f, 34.6f), Offset(30.6f, 38.4f), 2.2f, cap = StrokeCap.Round)
        }
    }
}

/**
 * Centered empty scene (v1.7.0 Nr. 9): line-art illustration, title, muted
 * subtitle and an optional action — used for empty notes, empty archive,
 * no search hits and the empty trash.
 */
@Composable
fun EmptyState(
    variant: EmptyStateVariant,
    title: String,
    subtitle: String? = null,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    secondaryActionLabel: String? = null,
    onSecondaryAction: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    androidx.compose.foundation.layout.Box(
        modifier = modifier.fillMaxSize(),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            EmptyStateIllustration(variant = variant)
            Spacer(modifier = Modifier.height(20.dp))
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                color = MaterialTheme.colorScheme.onSurface
            )
            if (subtitle != null) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (actionLabel != null && onAction != null) {
                Spacer(modifier = Modifier.height(20.dp))
                FilledTonalButton(onClick = onAction) {
                    Text(actionLabel)
                }
            }
            if (secondaryActionLabel != null && onSecondaryAction != null) {
                Spacer(modifier = Modifier.height(4.dp))
                TextButton(onClick = onSecondaryAction) {
                    Text(secondaryActionLabel)
                }
            }
        }
    }
}
