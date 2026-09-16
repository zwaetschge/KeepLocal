package com.keeplocal.android.ui.theme

import androidx.compose.ui.graphics.Color

// WebUI-matching color scheme
// Light: bg-primary #f5f5f5, bg-secondary #ffffff, text #333333, accent #667eea
// Dark: bg-primary #121212, bg-secondary #1e1e1e, text #f5f5f5, accent #8ab4f8

// Light theme
val PrimaryLight = Color(0xFF667EEA)        // WebUI accent (auth gradient start, search focus)
val OnPrimaryLight = Color(0xFFFFFFFF)
val PrimaryContainerLight = Color(0xFFE8ECFD)
val OnPrimaryContainerLight = Color(0xFF3B4FBF)
val SecondaryLight = Color(0xFF5F6368)      // WebUI --text-secondary: #555555
val OnSecondaryLight = Color(0xFFFFFFFF)
val SecondaryContainerLight = Color(0xFFE8EAED)
val OnSecondaryContainerLight = Color(0xFF3C4043)
val TertiaryLight = Color(0xFF764BA2)       // WebUI auth gradient end
val OnTertiaryLight = Color(0xFFFFFFFF)
val TertiaryContainerLight = Color(0xFFEDE0F5)
val OnTertiaryContainerLight = Color(0xFF5A3480)
val BackgroundLight = Color(0xFFF5F5F5)     // WebUI --bg-primary: #f5f5f5
val OnBackgroundLight = Color(0xFF333333)   // WebUI --text-primary: #333333
val SurfaceLight = Color(0xFFFFFFFF)        // WebUI --bg-secondary: #ffffff (cards)
val OnSurfaceLight = Color(0xFF333333)      // WebUI --text-primary
val SurfaceVariantLight = Color(0xFFF5F5F5) // Same as bg for input fields etc.
val OnSurfaceVariantLight = Color(0xFF555555) // WebUI --text-secondary
val ErrorLight = Color(0xFFF44336)          // WebUI .btn-confirm: #f44336
val OnErrorLight = Color(0xFFFFFFFF)
val OutlineLight = Color(0xFFE0E0E0)        // WebUI --border-color: #e0e0e0

// Dark theme
val PrimaryDark = Color(0xFF8AB4F8)         // WebUI dark accent
val OnPrimaryDark = Color(0xFF002D6D)
val PrimaryContainerDark = Color(0xFF2A3A5F)
val OnPrimaryContainerDark = Color(0xFFD3E3FD)
val SecondaryDark = Color(0xFFD0D0D0)       // WebUI dark --text-secondary
val OnSecondaryDark = Color(0xFF303134)
val SecondaryContainerDark = Color(0xFF3A3A3A)
val OnSecondaryContainerDark = Color(0xFFE8EAED)
val TertiaryDark = Color(0xFFB39DDB)
val OnTertiaryDark = Color(0xFF3A1D6E)
val TertiaryContainerDark = Color(0xFF4A3470)
val OnTertiaryContainerDark = Color(0xFFEDE0F5)
val BackgroundDark = Color(0xFF121212)      // WebUI dark --bg-primary: #121212
val OnBackgroundDark = Color(0xFFF5F5F5)    // WebUI dark --text-primary: #f5f5f5
val SurfaceDark = Color(0xFF1E1E1E)         // WebUI dark --bg-secondary: #1e1e1e
val OnSurfaceDark = Color(0xFFF5F5F5)       // WebUI dark --text-primary
val SurfaceVariantDark = Color(0xFF2A2A2A)  // Slightly lighter than surface for inputs
val OnSurfaceVariantDark = Color(0xFFD0D0D0) // WebUI dark --text-secondary
val ErrorDark = Color(0xFFCF6679)
val OnErrorDark = Color(0xFF690005)
val OutlineDark = Color(0xFF3A3A3A)         // WebUI dark --border-color: #3a3a3a

val OledBackground = Color(0xFF000000)
val OledSurface = Color(0xFF000000)

// Doodle theme — DoodleTheme.css `body.doodle-mode`
val DoodlePaper = Color(0xFFF8FCFF)          // --bg-primary
val DoodleSurface = Color(0xFFFFFFFF)        // --bg-secondary
val DoodlePaperTinted = Color(0xFFEAF7FD)    // --bg-tertiary
val DoodleText = Color(0xFF111827)           // --text-primary
val DoodleInk = Color(0xFF263D5B)            // --accent-color / --border-color-strong
val DoodleInkDark = Color(0xFF1D2F48)        // --accent-hover
val DoodleAccent = Color(0xFF49B6E5)         // --accent-secondary / --header-bg
val DoodleAccentLight = Color(0xFFD8F3FF)    // --accent-light, flattened
val DoodleMarker = Color(0xFFD97706)         // --warning-color, used for accents
val DoodleGridLine = Color(0x2249B6E5)       // graph-paper background lines

// Note colors matching WebUI exactly (index.css --note-color-* variables)
object NoteColors {
    // Dark mode note colors
    val Default = Color(0xFF202124)
    val Red = Color(0xFF5C2B29)
    val Orange = Color(0xFF614A19)
    val Yellow = Color(0xFF635D19)
    val Green = Color(0xFF345920)
    val Teal = Color(0xFF16504B)
    val Blue = Color(0xFF2D555E)
    val DarkBlue = Color(0xFF1E3A5F)
    val Purple = Color(0xFF42275E)
    val Pink = Color(0xFF5B2245)
    val Brown = Color(0xFF442F19)
    val Gray = Color(0xFF3C3F43)

    // Light mode note colors
    val DefaultLight = Color(0xFFFFFFFF)
    val RedLight = Color(0xFFF28B82)
    val OrangeLight = Color(0xFFFBBC04)
    val YellowLight = Color(0xFFFFF475)
    val GreenLight = Color(0xFFCCFF90)
    val TealLight = Color(0xFFA7FFEB)
    val BlueLight = Color(0xFFCBF0F8)
    val DarkBlueLight = Color(0xFFAECBFA)
    val PurpleLight = Color(0xFFD7AEFB)
    val PinkLight = Color(0xFFFDCFE8)
    val BrownLight = Color(0xFFE6C9A8)
    val GrayLight = Color(0xFFE8EAED)
}
