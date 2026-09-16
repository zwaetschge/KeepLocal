package com.keeplocal.android.ui.theme

import androidx.compose.animation.core.TweenSpec
import androidx.compose.animation.core.tween

/**
 * Central motion tokens (v1.7.0 design round). Durations and curves live in
 * ONE place so screens animate coherently instead of scattering their own
 * `tween(300)` copies — the values mirror the navigation transitions in
 * AppNavigation, which stay the reference for full-screen moves.
 */
object Motion {
    /** Micro feedback: pressed states, chip appearances, small morphs. */
    const val DURATION_SHORT = 150

    /** Full content changes: search morph, section reveals. */
    const val DURATION_MEDIUM = 300

    /** Card press feedback — subtle enough to feel, not to wobble. */
    const val PRESS_SCALE = 0.98f

    fun <T> short(): TweenSpec<T> = tween(DURATION_SHORT)

    fun <T> medium(): TweenSpec<T> = tween(DURATION_MEDIUM)
}
