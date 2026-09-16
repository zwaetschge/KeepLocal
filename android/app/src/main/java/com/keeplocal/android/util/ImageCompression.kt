package com.keeplocal.android.util

/**
 * Pure decision logic for upload-side image compression (unit-tested); the
 * Bitmap work itself lives in MediaRepositoryImpl.
 *
 * Camera photos from a tablet easily run 3–8 MB. The server generates its
 * own 300px thumbnails and the app never shows the full resolution, so
 * anything above ~2048px on the long edge is wasted upload time and storage.
 */
object ImageCompression {

    /** Longest edge kept after compression. */
    const val MAX_DIMENSION = 2048

    /** JPEG quality — visually transparent for note photos. */
    const val JPEG_QUALITY = 85

    /**
     * Images worth recompressing. Small files (typically screenshots and
     * already-compressed downloads) pass through untouched — recompressing
     * a JPEG only loses quality without saving anything. GIFs are never
     * touched (re-encoding kills animation and palette).
     */
    fun shouldCompress(mime: String?, byteSize: Long): Boolean =
        byteSize > MIN_BYTES_TO_COMPRESS && compressibleMime(mime)

    /** Below this, the upload is already small; recompressing is not worth it. */
    const val MIN_BYTES_TO_COMPRESS = 300L * 1024 // 300 KB

    /** Formats the decode-scale-reencode pipeline can handle safely. */
    fun compressibleMime(mime: String?): Boolean = when (mime?.lowercase()?.substringBefore(';')) {
        "image/jpeg", "image/png", "image/webp" -> true
        else -> false
    }

    /**
     * Power-of-two sample size that brings the long edge down to
     * [MAX_DIMENSION] — the classic two-pass decode approach: this shrinks
     * the bitmap during decoding instead of allocating the full image first.
     */
    fun computeSampleSize(width: Int, height: Int, maxDimension: Int = MAX_DIMENSION): Int {
        if (width <= 0 || height <= 0) return 1
        var sample = 1
        var longest = maxOf(width, height)
        while (longest / 2 >= maxDimension) {
            sample *= 2
            longest /= 2
        }
        return sample
    }

    /** Target dimensions after the sampled+exact decode; never upscales. */
    fun targetSize(width: Int, height: Int, maxDimension: Int = MAX_DIMENSION): Pair<Int, Int> {
        if (width <= 0 || height <= 0) return 1 to 1
        val longest = maxOf(width, height)
        if (longest <= maxDimension) return width to height
        val scale = maxDimension.toFloat() / longest
        return (width * scale).toInt().coerceAtLeast(1) to (height * scale).toInt().coerceAtLeast(1)
    }
}
