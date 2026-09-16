package com.keeplocal.android.ui.adaptive

import android.app.Activity
import androidx.compose.material3.windowsizeclass.ExperimentalMaterial3WindowSizeClassApi
import androidx.compose.material3.windowsizeclass.WindowHeightSizeClass
import androidx.compose.material3.windowsizeclass.WindowSizeClass
import androidx.compose.material3.windowsizeclass.WindowWidthSizeClass
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.State
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.window.layout.FoldingFeature
import androidx.window.layout.WindowInfoTracker

/**
 * How the app should lay itself out. Derived from the window size class *and*
 * the physical fold, so a folded Galaxy Fold cover screen stays in phone mode
 * while the same device unfolded switches to the two-pane tablet layout.
 */
enum class LayoutMode {
    /** Phone / cover display / small window: single pane, modal drawer. */
    PHONE,

    /** Tablet portrait or unfolded inner display in portrait: nav rail + single pane. */
    TABLET_PORTRAIT,

    /** Tablet landscape / desktop window: permanent sidebar + list-detail. */
    TABLET_LANDSCAPE,

    /** Foldable half-opened with a vertical hinge (book posture): list | hinge | detail. */
    FOLDABLE_BOOK,

    /** Foldable half-opened with a horizontal hinge (tabletop): list on top, detail below. */
    FOLDABLE_TABLETOP
}

val LayoutMode.isTwoPane: Boolean
    get() = this == LayoutMode.TABLET_LANDSCAPE ||
        this == LayoutMode.FOLDABLE_BOOK ||
        this == LayoutMode.FOLDABLE_TABLETOP

@Immutable
data class FoldInfo(
    /** True while the device is physically bent (HALF_OPENED). */
    val isHalfOpened: Boolean = false,
    /** True when a hinge/fold crosses the window at all, flat ones included. */
    val hasFold: Boolean = false,
    val isVerticalHinge: Boolean = false,
    /** Distance from the window's leading edge to the hinge. */
    val hingeOffset: Dp = 0.dp,
    /** Physical width of the hinge occlusion; 0 for seamless folds. */
    val hingeSize: Dp = 0.dp
)

@Immutable
data class AppWindowInfo(
    val widthSizeClass: WindowWidthSizeClass,
    val heightSizeClass: WindowHeightSizeClass,
    /** Raw window size — size classes are too coarse to pick a sidebar width. */
    val widthDp: Dp,
    val heightDp: Dp,
    val layoutMode: LayoutMode,
    val fold: FoldInfo
) {
    /** Column count for the note grid, matching the WebUI's CSS grid breakpoints. */
    val noteColumns: Int
        get() = when (layoutMode) {
            LayoutMode.PHONE -> if (widthSizeClass == WindowWidthSizeClass.Compact) 2 else 3
            LayoutMode.TABLET_PORTRAIT -> 3
            LayoutMode.TABLET_LANDSCAPE -> 3
            LayoutMode.FOLDABLE_BOOK -> 2
            LayoutMode.FOLDABLE_TABLETOP -> 2
        }
}

val LocalAppWindowInfo = staticCompositionLocalOf {
    AppWindowInfo(
        widthSizeClass = WindowWidthSizeClass.Compact,
        heightSizeClass = WindowHeightSizeClass.Medium,
        widthDp = 411.dp,
        heightDp = 891.dp,
        layoutMode = LayoutMode.PHONE,
        fold = FoldInfo()
    )
}

/**
 * Collects the current fold posture. Emits [FoldInfo] defaults on devices without
 * a hinge, so callers never need a null check.
 */
@Composable
fun rememberFoldInfo(): State<FoldInfo> {
    val view = LocalView.current
    val density = LocalDensity.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val activity = remember(view) { view.context.findActivity() }

    return produceState(initialValue = FoldInfo(), activity, lifecycleOwner, density) {
        if (activity == null) return@produceState
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            WindowInfoTracker.getOrCreate(activity)
                .windowLayoutInfo(activity)
                .collect { layoutInfo ->
                    val fold = layoutInfo.displayFeatures
                        .filterIsInstance<FoldingFeature>()
                        .firstOrNull()
                    value = if (fold == null) {
                        FoldInfo()
                    } else {
                        val vertical = fold.orientation == FoldingFeature.Orientation.VERTICAL
                        with(density) {
                            FoldInfo(
                                isHalfOpened = fold.state == FoldingFeature.State.HALF_OPENED,
                                hasFold = true,
                                isVerticalHinge = vertical,
                                hingeOffset = (if (vertical) fold.bounds.left else fold.bounds.top).toDp(),
                                hingeSize = (
                                    if (vertical) fold.bounds.width() else fold.bounds.height()
                                    ).toDp()
                            )
                        }
                    }
                }
        }
    }
}

@Composable
fun rememberAppWindowInfo(): AppWindowInfo {
    // Size classes are buckets; the raw size decides the sidebar treatment.
    val configuration = LocalConfiguration.current
    val size = DpSize(configuration.screenWidthDp.dp, configuration.screenHeightDp.dp)
    val fold by rememberFoldInfo()
    // LocalConfiguration already recomposes this on every configuration change:
    // rotate, fold, resize, split-screen.
    return remember(size, fold) { buildWindowInfo(size, fold) }
}

@OptIn(ExperimentalMaterial3WindowSizeClassApi::class)
internal fun buildWindowInfo(size: DpSize, fold: FoldInfo): AppWindowInfo {
    val sizeClass = WindowSizeClass.calculateFromSize(size)
    val width = sizeClass.widthSizeClass
    val height = sizeClass.heightSizeClass

    val layoutMode = when {
        // A bent device wins over raw size: respect the hinge.
        fold.isHalfOpened && fold.isVerticalHinge &&
            width != WindowWidthSizeClass.Compact -> LayoutMode.FOLDABLE_BOOK

        fold.isHalfOpened && !fold.isVerticalHinge &&
            height != WindowHeightSizeClass.Compact -> LayoutMode.FOLDABLE_TABLETOP

        width == WindowWidthSizeClass.Expanded -> LayoutMode.TABLET_LANDSCAPE
        width == WindowWidthSizeClass.Medium -> LayoutMode.TABLET_PORTRAIT
        else -> LayoutMode.PHONE
    }

    return AppWindowInfo(
        widthSizeClass = width,
        heightSizeClass = height,
        widthDp = size.width,
        heightDp = size.height,
        layoutMode = layoutMode,
        fold = fold
    )
}

private tailrec fun android.content.Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is android.content.ContextWrapper -> baseContext.findActivity()
    else -> null
}
