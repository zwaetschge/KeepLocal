package com.keeplocal.android.ui.theme

import androidx.compose.foundation.border
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.unit.dp

/**
 * Doodle-theme decorations mirroring `DoodleTheme.css`:
 * a graph-paper canvas plus ink outlines with a hard offset shadow.
 * Every modifier is a no-op under the other themes.
 */

/** Graph-paper background (`body.doodle-mode::before`, 28px grid). */
fun Modifier.doodleCanvas(): Modifier = composed {
    if (LocalThemeMode.current != ThemeMode.DOODLE) return@composed this

    drawBehind {
        val step = 28.dp.toPx()
        val stroke = 1.dp.toPx()
        var x = 0f
        while (x <= size.width) {
            drawRect(
                color = DoodleGridLine,
                topLeft = Offset(x, 0f),
                size = Size(stroke, size.height)
            )
            x += step
        }
        var y = 0f
        while (y <= size.height) {
            drawRect(
                color = DoodleGridLine,
                topLeft = Offset(0f, y),
                size = Size(size.width, stroke)
            )
            y += step
        }
    }
}

/**
 * Hand-drawn card treatment: 2dp ink border plus the CSS `4px 4px 0` hard shadow.
 * Applied to note cards, sheets and the sidebar under the doodle theme.
 */
@Composable
fun Modifier.doodleCard(shape: Shape, offset: Int = 4): Modifier {
    if (LocalThemeMode.current != ThemeMode.DOODLE) return this
    return this
        .drawBehind {
            val d = offset.dp.toPx()
            translate(left = d, top = d) {
                val outline = shape.createOutline(size, layoutDirection, this)
                drawOutline(outline, color = DoodleInk.copy(alpha = 0.16f))
            }
        }
        .border(2.dp, DoodleInk, shape)
}

/** Dashed outline used for tag chips (`body.doodle-mode .note-tag`). */
@Composable
fun Modifier.doodleDashedBorder(shape: Shape): Modifier {
    if (LocalThemeMode.current != ThemeMode.DOODLE) return this
    return drawBehind {
        val outline = shape.createOutline(size, layoutDirection, this)
        drawOutline(
            outline = outline,
            color = DoodleInk,
            style = Stroke(width = 1.dp.toPx())
        )
    }
}
