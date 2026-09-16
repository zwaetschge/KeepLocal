package com.keeplocal.android.util

/**
 * Client-side mirrors of the server's validation limits
 * (server/middleware/validators.js) so queued operations never bounce.
 */
object ServerContract {
    /** Anything else (e.g. "offline_*") is a local-only id the server rejects. */
    val MONGO_ID_REGEX: Regex = Regex("^[0-9a-fA-F]{24}$")

    /** PATCH /api/notes/reorder accepts at most 200 ids per call. */
    const val MAX_REORDER_IDS: Int = 200

    fun isServerId(id: String): Boolean = MONGO_ID_REGEX.matches(id)
}
