package com.keeplocal.android.ui.adaptive

import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Test

class WindowInfoTest {

    private fun sizeClass(width: Int, height: Int) = DpSize(width.dp, height.dp)

    @Test
    fun `compact width is phone mode`() {
        val info = buildWindowInfo(sizeClass(411, 891), FoldInfo())
        assertEquals(LayoutMode.PHONE, info.layoutMode)
    }

    @Test
    fun `medium width is tablet portrait`() {
        val info = buildWindowInfo(sizeClass(800, 1280), FoldInfo())
        assertEquals(LayoutMode.TABLET_PORTRAIT, info.layoutMode)
    }

    @Test
    fun `expanded width is tablet landscape two pane`() {
        val info = buildWindowInfo(sizeClass(1280, 800), FoldInfo())
        assertEquals(LayoutMode.TABLET_LANDSCAPE, info.layoutMode)
    }

    @Test
    fun `half opened vertical hinge is book posture`() {
        val fold = FoldInfo(
            isHalfOpened = true,
            hasFold = true,
            isVerticalHinge = true,
            hingeOffset = 400.dp,
            hingeSize = 16.dp
        )
        val info = buildWindowInfo(sizeClass(840, 900), fold)
        assertEquals(LayoutMode.FOLDABLE_BOOK, info.layoutMode)
    }

    @Test
    fun `half opened horizontal hinge is tabletop posture`() {
        val fold = FoldInfo(
            isHalfOpened = true,
            hasFold = true,
            isVerticalHinge = false,
            hingeOffset = 450.dp,
            hingeSize = 16.dp
        )
        val info = buildWindowInfo(sizeClass(900, 840), fold)
        assertEquals(LayoutMode.FOLDABLE_TABLETOP, info.layoutMode)
    }

    @Test
    fun `folded cover display stays in phone mode`() {
        // Galaxy Fold cover screen: a fold exists but the window is compact and flat.
        val fold = FoldInfo(hasFold = true, isVerticalHinge = true)
        val info = buildWindowInfo(sizeClass(320, 840), fold)
        assertEquals(LayoutMode.PHONE, info.layoutMode)
    }

    @Test
    fun `unfolded foldable at 4 to 3 reports its real width`() {
        // Galaxy Z Fold class inner display, ~1004dp x 758dp.
        val info = buildWindowInfo(sizeClass(1004, 758), FoldInfo(hasFold = true))
        assertEquals(LayoutMode.TABLET_LANDSCAPE, info.layoutMode)
        assertEquals(1004.dp, info.widthDp)
        assertEquals(758.dp, info.heightDp)
    }

    @Test
    fun `two pane flag matches the layout modes that host a detail pane`() {
        assertEquals(false, LayoutMode.PHONE.isTwoPane)
        assertEquals(false, LayoutMode.TABLET_PORTRAIT.isTwoPane)
        assertEquals(true, LayoutMode.TABLET_LANDSCAPE.isTwoPane)
        assertEquals(true, LayoutMode.FOLDABLE_BOOK.isTwoPane)
        assertEquals(true, LayoutMode.FOLDABLE_TABLETOP.isTwoPane)
    }
}
