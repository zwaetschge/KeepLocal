package com.keeplocal.android.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Unified KeepLocal brand mark — the same terracotta note-sheet logo as the
 * web client: gradient tile, white sheet with folded corner, two text lines
 * and a check badge breaking out of the sheet's bottom-right corner.
 *
 * Geometry is authored on a 48x48 canvas (the web SVG viewBox) and scaled to
 * the requested size so web and app stay pixel-identical.
 */
@Composable
fun KeepLocalLogo(size: Dp = 40.dp, modifier: Modifier = Modifier) {
    Canvas(modifier = modifier.size(size)) {
        val scale = this.size.width / 48f
        withTransform({ scale(scale, scale, pivot = Offset.Zero) }) {
            drawBrandMark()
        }
    }
}

private val TerracottaLight = Color(0xFFD4887D)
private val TerracottaDark = Color(0xFFB56B55)
private val FoldColor = Color(0xFFE7D9C9)

private fun DrawScope.drawBrandMark() {
    // Gradient tile
    drawRoundRect(
        brush = Brush.linearGradient(
            colors = listOf(TerracottaLight, TerracottaDark),
            start = Offset(0f, 0f),
            end = Offset(48f, 48f)
        ),
        topLeft = Offset.Zero,
        size = Size(48f, 48f),
        cornerRadius = CornerRadius(11f, 11f)
    )

    // Note sheet
    val sheet = Path().apply {
        moveTo(15f, 6.5f)
        lineTo(30f, 6.5f)
        lineTo(38f, 14.5f)
        lineTo(38f, 39f)
        quadraticBezierTo(38f, 42f, 35f, 42f)
        lineTo(15f, 42f)
        quadraticBezierTo(12f, 42f, 12f, 39f)
        lineTo(12f, 9.5f)
        quadraticBezierTo(12f, 6.5f, 15f, 6.5f)
        close()
    }
    drawPath(sheet, Color.White)

    // Folded corner with a soft shadow underneath
    val fold = Path().apply {
        moveTo(30f, 6.5f)
        lineTo(30f, 11.5f)
        quadraticBezierTo(30f, 14.5f, 33f, 14.5f)
        lineTo(38f, 14.5f)
        close()
    }
    drawPath(fold, FoldColor)
    val foldShadow = Path().apply {
        moveTo(30f, 14.5f)
        lineTo(33f, 14.5f)
        quadraticBezierTo(34.4f, 13.1f, 35.1f, 11.6f)
        lineTo(38f, 14.5f)
        close()
    }
    drawPath(foldShadow, Color.Black.copy(alpha = 0.08f))

    // Two bold text lines
    drawLine(
        color = TerracottaDark,
        start = Offset(16f, 18.5f),
        end = Offset(33.5f, 18.5f),
        strokeWidth = 2.7f,
        cap = StrokeCap.Round
    )
    drawLine(
        color = TerracottaDark.copy(alpha = 0.55f),
        start = Offset(16f, 24f),
        end = Offset(27f, 24f),
        strokeWidth = 2.7f,
        cap = StrokeCap.Round
    )

    // Check badge breaking out of the sheet's bottom-right corner
    val badgeCenter = Offset(31.5f, 36.5f)
    drawCircle(color = TerracottaDark, radius = 5.4f, center = badgeCenter)
    drawCircle(
        color = Color.White.copy(alpha = 0.35f),
        radius = 5.4f,
        center = badgeCenter,
        style = Stroke(width = 1.1f)
    )
    val check = Path().apply {
        moveTo(29.1f, 36.6f)
        lineTo(30.8f, 38.3f)
        lineTo(34.1f, 34.8f)
    }
    drawPath(
        path = check,
        color = Color.White,
        style = Stroke(width = 2.1f, cap = StrokeCap.Round, join = StrokeJoin.Round)
    )
}
