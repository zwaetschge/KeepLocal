package com.keeplocal.android.domain.model

/**
 * Sort order of the note list (v1.8.0). MANUAL keeps the drag-&-drop order the
 * server assigns (isPinned/position/updatedAt); the alternatives are purely
 * local views — the stored `position` is never rewritten when sorting changes.
 */
enum class SortMode(val storageKey: String) {
    MANUAL("manual"),
    UPDATED("updated"),
    CREATED("created"),
    TITLE("title");

    companion object {
        fun fromStorageKey(key: String?): SortMode =
            entries.firstOrNull { it.storageKey == key } ?: MANUAL
    }
}
