package com.keeplocal.android.util

import java.time.Instant

/**
 * Remaining trash lifetime (v1.6.0 Nr. 4). The server indexes notes.deletedAt
 * with a 30-day TTL (notesService.js) and MongoDB purges them silently — so
 * the trash screen tells the user how long a restore is still possible.
 */
object TrashRetention {

    /** Server-side TTL in days (must match the trash index in notesService.js). */
    const val RETENTION_DAYS = 30

    /**
     * Full days left before the server purges this note, rounded up — a note
     * deleted two hours ago still shows "30 Tage", matching what a user
     * reading the 30-day promise would expect. Null while the note is live;
     * 0 once the expiry has passed (purge is imminent).
     */
    fun daysRemaining(deletedAt: Instant?, now: Instant = Instant.now()): Int? {
        if (deletedAt == null) return null
        val secondsLeft = deletedAt.plusSeconds(RETENTION_DAYS * 86400L).epochSecond - now.epochSecond
        if (secondsLeft <= 0) return 0
        return ((secondsLeft + 86399) / 86400L).toInt()
    }
}
