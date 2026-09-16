package com.keeplocal.android.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color
import com.keeplocal.android.domain.model.NoteColor

/**
 * Note background palette per theme, mirroring the WebUI `--note-*` CSS variables.
 *
 * WebUI reference:
 * - light/dark: index.css `--note-color-*`
 * - eink:       index.css `body.eink-mode` (grayscale only)
 * - doodle:     DoodleTheme.css `body.doodle-mode` (pastel paper tones)
 */
@Immutable
data class NotePalette(
    val default: Color,
    val red: Color,
    val orange: Color,
    val yellow: Color,
    val green: Color,
    val teal: Color,
    val blue: Color,
    val darkBlue: Color,
    val purple: Color,
    val pink: Color,
    val brown: Color,
    val gray: Color
) {
    fun colorFor(color: NoteColor): Color = when (color) {
        NoteColor.DEFAULT -> default
        NoteColor.RED -> red
        NoteColor.ORANGE -> orange
        NoteColor.YELLOW -> yellow
        NoteColor.GREEN -> green
        NoteColor.TEAL -> teal
        NoteColor.BLUE -> blue
        NoteColor.DARK_BLUE -> darkBlue
        NoteColor.PURPLE -> purple
        NoteColor.PINK -> pink
        NoteColor.BROWN -> brown
        NoteColor.GRAY -> gray
    }
}

val LightNotePalette = NotePalette(
    default = NoteColors.DefaultLight,
    red = NoteColors.RedLight,
    orange = NoteColors.OrangeLight,
    yellow = NoteColors.YellowLight,
    green = NoteColors.GreenLight,
    teal = NoteColors.TealLight,
    blue = NoteColors.BlueLight,
    darkBlue = NoteColors.DarkBlueLight,
    purple = NoteColors.PurpleLight,
    pink = NoteColors.PinkLight,
    brown = NoteColors.BrownLight,
    gray = NoteColors.GrayLight
)

val DarkNotePalette = NotePalette(
    default = NoteColors.Default,
    red = NoteColors.Red,
    orange = NoteColors.Orange,
    yellow = NoteColors.Yellow,
    green = NoteColors.Green,
    teal = NoteColors.Teal,
    blue = NoteColors.Blue,
    darkBlue = NoteColors.DarkBlue,
    purple = NoteColors.Purple,
    pink = NoteColors.Pink,
    brown = NoteColors.Brown,
    gray = NoteColors.Gray
)

/** OLED keeps the dark hues but sinks the default card to pure black. */
val OledNotePalette = DarkNotePalette.copy(default = OledSurface)

/** E-Ink drops chroma entirely — same values the WebUI uses in `body.eink-mode`. */
val EInkNotePalette = NotePalette(
    default = Color(0xFFFFFFFF),
    red = Color(0xFFE8E8E8),
    orange = Color(0xFFE0E0E0),
    yellow = Color(0xFFF0F0F0),
    green = Color(0xFFE8E8E8),
    teal = Color(0xFFE4E4E4),
    blue = Color(0xFFE0E0E0),
    darkBlue = Color(0xFFDCDCDC),
    purple = Color(0xFFE4E4E4),
    pink = Color(0xFFE8E8E8),
    brown = Color(0xFFD8D8D8),
    gray = Color(0xFFD0D0D0)
)

/** Doodle uses the soft pastel paper tones from DoodleTheme.css. */
val DoodleNotePalette = NotePalette(
    default = Color(0xFFFFFFFF),
    red = Color(0xFFFFE2E2),
    orange = Color(0xFFFFE8CC),
    yellow = Color(0xFFFFF6BF),
    green = Color(0xFFDCFCE7),
    teal = Color(0xFFCCFBF1),
    blue = Color(0xFFDBEAFE),
    darkBlue = Color(0xFFD8F3FF),
    purple = Color(0xFFEDE9FE),
    pink = Color(0xFFFCE7F3),
    brown = Color(0xFFF1E3D3),
    gray = Color(0xFFF3F4F6)
)
