package com.keeplocal.android.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

/**
 * Theme modes in the same order the WebUI cycles them
 * (light -> dark -> oled -> eink -> doodle), plus SYSTEM which the web app
 * does not need because the browser handles it.
 */
enum class ThemeMode {
    SYSTEM, LIGHT, DARK, OLED, E_INK, DOODLE;

    companion object {
        fun fromKey(key: String?): ThemeMode = when (key) {
            "light" -> LIGHT
            "dark" -> DARK
            "oled" -> OLED
            "e_ink" -> E_INK
            "doodle" -> DOODLE
            else -> SYSTEM
        }
    }

    val key: String
        get() = when (this) {
            SYSTEM -> "system"
            LIGHT -> "light"
            DARK -> "dark"
            OLED -> "oled"
            E_INK -> "e_ink"
            DOODLE -> "doodle"
        }
}

/** The theme the user actually picked — never derive dark/light from the system alone. */
val LocalThemeMode = staticCompositionLocalOf { ThemeMode.SYSTEM }

/** Resolved darkness of the active theme (SYSTEM already folded in). */
val LocalIsDarkTheme = staticCompositionLocalOf { false }

/** Note card backgrounds for the active theme. */
val LocalNotePalette = staticCompositionLocalOf { LightNotePalette }

// WebUI-matching: neutral gray feel with purple-blue accent used sparingly
// Light: #f5f5f5 bg, #ffffff cards, #333333 text, #667eea accent
// Dark: #121212 bg, #1e1e1e cards, #f5f5f5 text, #8ab4f8 accent
private val DarkColorScheme = darkColorScheme(
    primary = PrimaryDark,
    onPrimary = OnPrimaryDark,
    primaryContainer = PrimaryContainerDark,
    onPrimaryContainer = OnPrimaryContainerDark,
    secondary = SecondaryDark,
    onSecondary = OnSecondaryDark,
    secondaryContainer = SecondaryContainerDark,
    onSecondaryContainer = OnSecondaryContainerDark,
    tertiary = TertiaryDark,
    onTertiary = OnTertiaryDark,
    tertiaryContainer = TertiaryContainerDark,
    onTertiaryContainer = OnTertiaryContainerDark,
    background = BackgroundDark,
    onBackground = OnBackgroundDark,
    surface = SurfaceDark,
    onSurface = OnSurfaceDark,
    surfaceVariant = SurfaceVariantDark,
    onSurfaceVariant = OnSurfaceVariantDark,
    error = ErrorDark,
    onError = OnErrorDark,
    outline = OutlineDark
)

private val LightColorScheme = lightColorScheme(
    primary = PrimaryLight,
    onPrimary = OnPrimaryLight,
    primaryContainer = PrimaryContainerLight,
    onPrimaryContainer = OnPrimaryContainerLight,
    secondary = SecondaryLight,
    onSecondary = OnSecondaryLight,
    secondaryContainer = SecondaryContainerLight,
    onSecondaryContainer = OnSecondaryContainerLight,
    tertiary = TertiaryLight,
    onTertiary = OnTertiaryLight,
    tertiaryContainer = TertiaryContainerLight,
    onTertiaryContainer = OnTertiaryContainerLight,
    background = BackgroundLight,
    onBackground = OnBackgroundLight,
    surface = SurfaceLight,
    onSurface = OnSurfaceLight,
    surfaceVariant = SurfaceVariantLight,
    onSurfaceVariant = OnSurfaceVariantLight,
    error = ErrorLight,
    onError = OnErrorLight,
    outline = OutlineLight
)

private val OledColorScheme = DarkColorScheme.copy(
    background = OledBackground,
    surface = OledSurface
)

private val EInkColorScheme = lightColorScheme(
    primary = Color(0xFF333333),
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFD0D0D0),
    onPrimaryContainer = Color(0xFF1A1A1A),
    secondary = Color(0xFF555555),
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE0E0E0),
    onSecondaryContainer = Color(0xFF222222),
    tertiary = Color(0xFF666666),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFD8D8D8),
    onTertiaryContainer = Color(0xFF2A2A2A),
    background = Color(0xFFF5F5F0),
    onBackground = Color(0xFF1A1A1A),
    surface = Color(0xFFF5F5F0),
    onSurface = Color(0xFF1A1A1A),
    surfaceVariant = Color(0xFFE8E8E3),
    onSurfaceVariant = Color(0xFF3A3A3A),
    error = Color(0xFF444444),
    onError = Color(0xFFFFFFFF),
    outline = Color(0xFF999999)
)

// DoodleTheme.css: ink #263D5B on paper #F8FCFF with a sky-blue marker accent.
private val DoodleColorScheme = lightColorScheme(
    primary = DoodleInk,
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = DoodleAccentLight,
    onPrimaryContainer = DoodleInkDark,
    secondary = DoodleAccent,
    onSecondary = Color(0xFF111827),
    secondaryContainer = DoodleAccentLight,
    onSecondaryContainer = DoodleInkDark,
    tertiary = DoodleMarker,
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFFDE9CF),
    onTertiaryContainer = Color(0xFF6B3F06),
    background = DoodlePaper,
    onBackground = DoodleText,
    surface = DoodleSurface,
    onSurface = DoodleText,
    surfaceVariant = DoodlePaperTinted,
    onSurfaceVariant = DoodleInk,
    error = Color(0xFFDC2626),
    onError = Color(0xFFFFFFFF),
    outline = DoodleInk
)

// Doodle keeps every corner at the same small radius (--radius-*: 8px in the CSS).
private val DoodleShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small = RoundedCornerShape(8.dp),
    medium = RoundedCornerShape(8.dp),
    large = RoundedCornerShape(8.dp),
    extraLarge = RoundedCornerShape(8.dp)
)

// E-Ink prints better with crisp, nearly square corners.
private val EInkShapes = Shapes(
    extraSmall = RoundedCornerShape(0.dp),
    small = RoundedCornerShape(2.dp),
    medium = RoundedCornerShape(2.dp),
    large = RoundedCornerShape(4.dp),
    extraLarge = RoundedCornerShape(4.dp)
)

@Composable
fun KeepLocalTheme(
    themeMode: ThemeMode = ThemeMode.SYSTEM,
    dynamicColor: Boolean = false, // Disabled: use WebUI-matching colors
    content: @Composable () -> Unit
) {
    val isDarkTheme = when (themeMode) {
        ThemeMode.SYSTEM -> isSystemInDarkTheme()
        ThemeMode.LIGHT, ThemeMode.E_INK, ThemeMode.DOODLE -> false
        ThemeMode.DARK, ThemeMode.OLED -> true
    }

    val colorScheme = when {
        themeMode == ThemeMode.E_INK -> EInkColorScheme
        themeMode == ThemeMode.DOODLE -> DoodleColorScheme
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (isDarkTheme) {
                if (themeMode == ThemeMode.OLED) {
                    dynamicDarkColorScheme(context).copy(
                        background = OledBackground,
                        surface = OledSurface
                    )
                } else {
                    dynamicDarkColorScheme(context)
                }
            } else {
                dynamicLightColorScheme(context)
            }
        }
        themeMode == ThemeMode.OLED -> OledColorScheme
        isDarkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    val notePalette = when {
        themeMode == ThemeMode.E_INK -> EInkNotePalette
        themeMode == ThemeMode.DOODLE -> DoodleNotePalette
        themeMode == ThemeMode.OLED -> OledNotePalette
        isDarkTheme -> DarkNotePalette
        else -> LightNotePalette
    }

    val shapes = when (themeMode) {
        ThemeMode.DOODLE -> DoodleShapes
        ThemeMode.E_INK -> EInkShapes
        else -> Shapes
    }

    val typography = if (themeMode == ThemeMode.DOODLE) {
        DoodleTypography
    } else {
        Typography
    }

    CompositionLocalProvider(
        LocalThemeMode provides themeMode,
        LocalIsDarkTheme provides isDarkTheme,
        LocalNotePalette provides notePalette
    ) {
        MaterialTheme(
            colorScheme = colorScheme,
            typography = typography,
            shapes = shapes,
            content = content
        )
    }
}

/** Doodle swaps in the platform's casual/handwritten family (Comic Sans equivalent). */
private val DoodleTypography = Typography.let { base ->
    androidx.compose.material3.Typography(
        displayLarge = base.displayLarge.copy(fontFamily = FontFamily.Cursive),
        displayMedium = base.displayMedium.copy(fontFamily = FontFamily.Cursive),
        displaySmall = base.displaySmall.copy(fontFamily = FontFamily.Cursive),
        headlineLarge = base.headlineLarge.copy(fontFamily = FontFamily.Cursive),
        headlineMedium = base.headlineMedium.copy(fontFamily = FontFamily.Cursive),
        headlineSmall = base.headlineSmall.copy(fontFamily = FontFamily.Cursive),
        titleLarge = base.titleLarge.copy(fontFamily = FontFamily.Cursive),
        titleMedium = base.titleMedium.copy(fontFamily = FontFamily.Cursive),
        titleSmall = base.titleSmall.copy(fontFamily = FontFamily.Cursive),
        bodyLarge = base.bodyLarge,
        bodyMedium = base.bodyMedium,
        bodySmall = base.bodySmall,
        labelLarge = base.labelLarge.copy(fontFamily = FontFamily.Cursive),
        labelMedium = base.labelMedium.copy(fontFamily = FontFamily.Cursive),
        labelSmall = base.labelSmall.copy(fontFamily = FontFamily.Cursive)
    )
}
