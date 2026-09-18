package com.keeplocal.android.domain.model

/**
 * Type filter for the note list (v1.9.0 Nr. 7): narrows the search — or the
 * plain list, with no search term — to a structural note type. Applied in
 * SQL (NoteQueries) so it costs nothing on top of the existing LIKE search
 * and works fully offline.
 */
enum class NoteTypeFilter {
    /** No restriction. */
    ALL,
    /** Checklist notes only. */
    LISTS,
    /** Text notes (everything that is not a checklist) only. */
    TEXT,
    /** Notes with at least one image attachment. */
    IMAGES,
    /** Notes carrying a reminder, fired or not. */
    REMINDERS,
    /** Pinned notes only. */
    PINNED;

    /**
     * In-memory twin of the SQL filter in NoteQueries — applied when results
     * come straight from the server (search/tag) and keep its ranking while
     * still honouring the chip.
     */
    fun matches(note: Note): Boolean = when (this) {
        ALL -> true
        LISTS -> note.isTodoList
        TEXT -> !note.isTodoList
        IMAGES -> note.images.isNotEmpty()
        REMINDERS -> note.remindAt != null
        PINNED -> note.isPinned
    }
}
