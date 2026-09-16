package com.keeplocal.android.util

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * WCAG 2.1 contrast math for the app's own color pairs (v1.7.0 Nr. 8) — the
 * same audit the WebUI got, now as a unit test guard. Compose [Color] is a
 * pure value class, so this runs on the JVM without Android.
 */
object ColorContrast {

    /** WCAG relative luminance of an sRGB color (0.0–1.0). */
    fun relativeLuminance(c: Color): Double {
        fun channel(v: Float): Double {
            val s = v.toDouble()
            return if (s <= 0.04045) s / 12.92 else ((s + 0.055) / 1.055).pow(2.4)
        }
        return 0.2126 * channel(c.red) +
            0.7152 * channel(c.green) +
            0.0722 * channel(c.blue)
    }

    /** WCAG contrast ratio (1.0–21.0) between two opaque colors. */
    fun ratio(a: Color, b: Color): Double {
        val la = relativeLuminance(a)
        val lb = relativeLuminance(b)
        val lighter = maxOf(la, lb)
        val darker = minOf(la, lb)
        return (lighter + 0.05) / (darker + 0.05)
    }

    /** AA for body text. */
    const val MIN_TEXT = 4.5

    /** AA for large text (≥18pt) and meaningful icons/checkboxes. */
    const val MIN_ICON = 3.0

    fun passesText(fg: Color, bg: Color): Boolean = ratio(fg, bg) >= MIN_TEXT

    fun passesIcon(fg: Color, bg: Color): Boolean = ratio(fg, bg) >= MIN_ICON

    /** Ratio rounded to two decimals — for assertion messages. */
    fun ratioLabel(a: Color, b: Color): String =
        ((ratio(a, b) * 100).roundToInt() / 100.0).toString()
}
