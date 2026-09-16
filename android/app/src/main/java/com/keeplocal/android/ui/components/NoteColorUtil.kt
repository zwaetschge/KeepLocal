package com.keeplocal.android.ui.components

import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import com.keeplocal.android.domain.model.NoteColor
import com.keeplocal.android.ui.theme.DarkNotePalette
import com.keeplocal.android.ui.theme.LightNotePalette
import com.keeplocal.android.ui.theme.LocalNotePalette

object NoteColorUtil {
    /**
     * Note background for the *active* theme (light, dark, OLED, E-Ink, doodle).
     * Prefer this over [getColor]: reading `isSystemInDarkTheme()` at the call site
     * ignores a manually picked theme and paints light cards on a dark canvas.
     */
    @Composable
    @ReadOnlyComposable
    fun colorFor(color: NoteColor): Color = LocalNotePalette.current.colorFor(color)

    /** Non-composable fallback for previews and tests. */
    fun getColor(color: NoteColor, isDark: Boolean): Color =
        (if (isDark) DarkNotePalette else LightNotePalette).colorFor(color)

    fun getAllColors(): List<NoteColor> = NoteColor.entries.toList()
}
