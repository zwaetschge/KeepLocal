package com.keeplocal.android.util

/**
 * Search-within-a-note (v1.9.0 Nr. 7): a find bar in the editor that walks
 * through the hits of the current query in the note body. Pure state logic —
 * hit matching reuses [SearchHighlight.matchRanges], the composable only
 * renders `x/y` and scrolls to [currentRange].
 */
object InNoteSearch {

    /** Find-bar state; immutable, every interaction returns a new state. */
    data class State(
        val query: String = "",
        val hitIndex: Int = 0
    ) {
        val isActive: Boolean get() = query.isNotBlank()
    }

    /** All hits of the query in [text], in reading order, non-overlapping. */
    fun hits(text: String, state: State): List<IntRange> =
        if (!state.isActive) emptyList() else SearchHighlight.matchRanges(text, state.query)

    /**
     * The hit the counter currently points at — coerced into range so a
     * shorter result set (query edited, text changed) never crashes the bar.
     */
    fun currentRange(text: String, state: State): IntRange? {
        val all = hits(text, state)
        if (all.isEmpty()) return null
        return all[state.hitIndex.coerceIn(0, all.lastIndex)]
    }

    /** "3 / 12" for the bar; "0 / 0" when there is nothing to show. */
    fun counter(text: String, state: State): Pair<Int, Int> {
        val all = hits(text, state)
        if (all.isEmpty()) return 0 to 0
        return (state.hitIndex.coerceIn(0, all.lastIndex) + 1) to all.size
    }

    /** New query resets the counter — always jump to the first hit. */
    fun onQueryChanged(state: State, query: String): State =
        if (query.isBlank()) State() else State(query = query)

    fun close(): State = State()

    /** Advances to the next hit, wrapping at the end. */
    fun next(text: String, state: State): State {
        val total = hits(text, state).size
        if (total == 0) return state
        return state.copy(hitIndex = (state.hitIndex.coerceIn(0, total - 1) + 1) % total)
    }

    /** Steps back to the previous hit, wrapping at the start. */
    fun previous(text: String, state: State): State {
        val total = hits(text, state).size
        if (total == 0) return state
        return state.copy(hitIndex = (state.hitIndex.coerceIn(0, total - 1) - 1 + total) % total)
    }
}
