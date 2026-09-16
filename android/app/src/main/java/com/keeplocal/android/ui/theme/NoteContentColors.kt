package com.keeplocal.android.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance

/**
 * Per-card content colors (v1.7.0 design round). Note cards paint on their
 * own note color — light pastels in light/doodle mode, deep tones in dark
 * mode, grays in e-ink — so text, icons, checkboxes and tag chips must pick
 * colors that work on THAT background, not on the theme surface. Everything
 * derived here is verified against every palette in [ColorContrastTest].
 */
@Immutable
data class NoteContentColors(
    /** Titles and body text. */
    val onCard: Color,
    /** Secondary labels: tags, owner badge, meta lines. */
    val onCardVariant: Color,
    /** Icons, checkboxes, pin — full alpha, never the 0.7 wash that failed AA. */
    val accent: Color,
    /** Tag chip background; translucent so the card color shows through. */
    val chipContainer: Color,
    /** Tag chip outline for definition on low-chroma cards. */
    val chipOutline: Color
)

/**
 * Picks content colors by card luminance: bright pastels get dark ink, deep
 * note tones get light ink. Measured luminances leave a wide gap — the
 * darkest light-palette card (RedLight #F28B82) sits at 0.39, the lightest
 * dark-palette tone (Yellow #635D19) at 0.11 — so 0.25 splits them with
 * margin. The ink values themselves are the darkest/lightest shades that
 * still clear WCAG AA on the worst card of their branch (RedLight for dark
 * ink, Yellow-dark for light ink); [ColorContrastTest] locks them in.
 */
fun contentColorsFor(cardColor: Color): NoteContentColors {
    return if (cardColor.luminance() > 0.25f) {
        NoteContentColors(
            onCard = Color(0xFF2D2D2D),
            onCardVariant = Color(0xFF3F3A34),
            accent = Color(0xFF2F3FA8),
            chipContainer = Color.Black.copy(alpha = 0.07f),
            chipOutline = Color.Black.copy(alpha = 0.14f)
        )
    } else {
        NoteContentColors(
            onCard = Color(0xFFF5F5F5),
            onCardVariant = Color(0xFFE0DCD4),
            accent = Color(0xFFAECBFA),
            chipContainer = Color.White.copy(alpha = 0.14f),
            chipOutline = Color.White.copy(alpha = 0.24f)
        )
    }
}
