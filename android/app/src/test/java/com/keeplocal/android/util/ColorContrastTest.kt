package com.keeplocal.android.util

import androidx.compose.ui.graphics.Color
import com.keeplocal.android.ui.theme.DarkNotePalette
import com.keeplocal.android.ui.theme.DoodleNotePalette
import com.keeplocal.android.ui.theme.EInkNotePalette
import com.keeplocal.android.ui.theme.LightNotePalette
import com.keeplocal.android.ui.theme.NotePalette
import com.keeplocal.android.ui.theme.OledNotePalette
import com.keeplocal.android.ui.theme.contentColorsFor
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * WCAG audit of the per-card ink system (v1.7.0 design round): every note
 * color of every palette must carry readable text and icons once
 * [contentColorsFor] picked its branch. The killer backgrounds are
 * RedLight #F28B82 (darkest pastel) for the dark-ink branch and Yellow
 * #635D19 (lightest dark tone) for the light-ink branch — the ink values in
 * NoteContentColors were chosen so exactly these cases still pass AA.
 */
class ColorContrastTest {

    private fun paletteColors(palette: NotePalette): List<Pair<String, Color>> = listOf(
        "default" to palette.default,
        "red" to palette.red,
        "orange" to palette.orange,
        "yellow" to palette.yellow,
        "green" to palette.green,
        "teal" to palette.teal,
        "blue" to palette.blue,
        "darkBlue" to palette.darkBlue,
        "purple" to palette.purple,
        "pink" to palette.pink,
        "brown" to palette.brown,
        "gray" to palette.gray
    )

    private fun assertPalettePasses(name: String, palette: NotePalette) {
        paletteColors(palette).forEach { (colorName, bg) ->
            val ink = contentColorsFor(bg)
            val ctx = "$name/$colorName (#${bg.value.toString(16).uppercase().padStart(8, '0')})"
            assertTrue(
                "$ctx: onCard ${ColorContrast.ratioLabel(ink.onCard, bg)} < ${ColorContrast.MIN_TEXT}",
                ColorContrast.passesText(ink.onCard, bg)
            )
            assertTrue(
                "$ctx: onCardVariant ${ColorContrast.ratioLabel(ink.onCardVariant, bg)} < ${ColorContrast.MIN_TEXT}",
                ColorContrast.passesText(ink.onCardVariant, bg)
            )
            assertTrue(
                "$ctx: accent ${ColorContrast.ratioLabel(ink.accent, bg)} < ${ColorContrast.MIN_ICON}",
                ColorContrast.passesIcon(ink.accent, bg)
            )
        }
    }

    @Test
    fun `light palette passes AA on every note color`() = assertPalettePasses("Light", LightNotePalette)

    @Test
    fun `dark palette passes AA on every note color`() = assertPalettePasses("Dark", DarkNotePalette)

    @Test
    fun `oled palette passes AA on every note color`() = assertPalettePasses("Oled", OledNotePalette)

    @Test
    fun `e-ink palette passes AA on every note color`() = assertPalettePasses("EInk", EInkNotePalette)

    @Test
    fun `doodle palette passes AA on every note color`() = assertPalettePasses("Doodle", DoodleNotePalette)

    @Test
    fun `branch split keeps light palettes on dark ink`() {
        // Every light-side card (light/e-ink/doodle palettes) must pick the
        // dark-ink branch — including RedLight, the darkest pastel.
        listOf(LightNotePalette, EInkNotePalette, DoodleNotePalette).forEach { palette ->
            paletteColors(palette).forEach { (_, bg) ->
                assertEquals(
                    "expected dark ink on #${bg.value.toString(16).uppercase()}",
                    Color(0xFF2D2D2D),
                    contentColorsFor(bg).onCard
                )
            }
        }
    }

    @Test
    fun `branch split keeps dark palettes on light ink`() {
        listOf(DarkNotePalette, OledNotePalette).forEach { palette ->
            paletteColors(palette).forEach { (_, bg) ->
                assertEquals(
                    "expected light ink on #${bg.value.toString(16).uppercase()}",
                    Color(0xFFF5F5F5),
                    contentColorsFor(bg).onCard
                )
            }
        }
    }

    @Test
    fun `ratio math matches known WCAG pairs`() {
        // Black on white is exactly 21:1.
        assertEquals(21.0, ColorContrast.ratio(Color.Black, Color.White), 0.01)
        // White on white is 1:1.
        assertEquals(1.0, ColorContrast.ratio(Color.White, Color.White), 0.01)
        // Symmetric in argument order.
        assertEquals(
            ColorContrast.ratio(Color(0xFF2D2D2D), Color(0xFFF28B82)),
            ColorContrast.ratio(Color(0xFFF28B82), Color(0xFF2D2D2D)),
            0.0001
        )
    }

    @Test
    fun `red light card is the tightest dark-ink case and still passes`() {
        val redLight = LightNotePalette.red
        val ink = contentColorsFor(redLight)
        assertTrue(ColorContrast.ratio(ink.onCard, redLight) >= 5.0)
        assertTrue(ColorContrast.ratio(ink.onCardVariant, redLight) >= 4.5)
        assertTrue(ColorContrast.ratio(ink.accent, redLight) >= 3.0)
    }

    @Test
    fun `yellow dark card is the tightest light-ink case and still passes`() {
        val yellowDark = DarkNotePalette.yellow
        val ink = contentColorsFor(yellowDark)
        assertTrue(ColorContrast.ratio(ink.onCard, yellowDark) >= 5.5)
        assertTrue(ColorContrast.ratio(ink.onCardVariant, yellowDark) >= 4.5)
        assertTrue(ColorContrast.ratio(ink.accent, yellowDark) >= 3.5)
    }
}
