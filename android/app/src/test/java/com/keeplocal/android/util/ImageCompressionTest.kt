package com.keeplocal.android.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ImageCompressionTest {

    /* ------------------------------ sample size ------------------------------ */

    @Test
    fun `8k photo is sampled by four`() {
        assertEquals(4, ImageCompression.computeSampleSize(8192, 6144))
    }

    @Test
    fun `already at max needs no sampling`() {
        assertEquals(1, ImageCompression.computeSampleSize(2048, 2048))
    }

    @Test
    fun `4000px long edge stays unsampled - exact scale handles the rest`() {
        assertEquals(1, ImageCompression.computeSampleSize(4000, 3000))
    }

    @Test
    fun `degenerate dimensions fall back to 1`() {
        assertEquals(1, ImageCompression.computeSampleSize(0, 500))
        assertEquals(1, ImageCompression.computeSampleSize(-5, 10))
        assertEquals(1, ImageCompression.computeSampleSize(10, 0))
    }

    /* ------------------------------ target size ------------------------------ */

    @Test
    fun `typical camera photo scales to 2048 long edge`() {
        assertEquals(2048 to 1536, ImageCompression.targetSize(4000, 3000))
    }

    @Test
    fun `portrait orientation keeps the long edge vertical`() {
        assertEquals(40 to 2048, ImageCompression.targetSize(100, 5000))
    }

    @Test
    fun `small images are never upscaled`() {
        assertEquals(1024 to 768, ImageCompression.targetSize(1024, 768))
    }

    @Test
    fun `just over max shrinks by one pixel`() {
        assertEquals(2048 to 9, ImageCompression.targetSize(2049, 10))
    }

    @Test
    fun `degenerate dimensions produce a 1x1 floor`() {
        assertEquals(1 to 1, ImageCompression.targetSize(0, 0))
        assertEquals(1 to 1, ImageCompression.targetSize(-3, 400))
    }

    /* ----------------------------- shouldCompress ---------------------------- */

    @Test
    fun `large jpeg should compress`() {
        assertTrue(ImageCompression.shouldCompress("image/jpeg", 5L * 1024 * 1024))
    }

    @Test
    fun `large png and webp should compress`() {
        assertTrue(ImageCompression.shouldCompress("image/png", 2L * 1024 * 1024))
        assertTrue(ImageCompression.shouldCompress("image/webp", 2L * 1024 * 1024))
    }

    @Test
    fun `mime casing and parameters are tolerated`() {
        assertTrue(ImageCompression.shouldCompress("IMAGE/JPEG", 5L * 1024 * 1024))
        assertTrue(ImageCompression.shouldCompress("image/jpeg; charset=binary", 5L * 1024 * 1024))
    }

    @Test
    fun `gifs are never recompressed`() {
        assertFalse(ImageCompression.shouldCompress("image/gif", 8L * 1024 * 1024))
    }

    @Test
    fun `unknown and missing mimes pass through`() {
        assertFalse(ImageCompression.shouldCompress("application/pdf", 8L * 1024 * 1024))
        assertFalse(ImageCompression.shouldCompress(null, 8L * 1024 * 1024))
    }

    @Test
    fun `small files skip the pipeline`() {
        assertFalse(ImageCompression.shouldCompress("image/jpeg", ImageCompression.MIN_BYTES_TO_COMPRESS))
        assertFalse(ImageCompression.shouldCompress("image/jpeg", 100L * 1024))
        assertTrue(
            ImageCompression.shouldCompress(
                "image/jpeg",
                ImageCompression.MIN_BYTES_TO_COMPRESS + 1
            )
        )
    }
}
