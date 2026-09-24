package com.keeplocal.android.reminder

/**
 * Pure planning and decision logic for reminder alarms — deliberately free of
 * Android types so the unit tests can pin the stale-alarm behaviour on the JVM.
 */
object ReminderAlarmPlan {

    /**
     * Ids whose alarm is on record but no longer backed by an upcoming
     * reminder: the reminder was removed, moved, or its note was deleted
     * (also remotely, where the pull path touches Room without going through
     * the scheduler). Those alarms must be cancelled before re-planning,
     * otherwise they keep firing for a state that no longer exists (v1.18.0).
     */
    fun staleIds(scheduledIds: Set<String>, desiredIds: Set<String>): Set<String> =
        scheduledIds - desiredIds

    /**
     * May a stale candidate keep its alarm? The upcoming query can not see
     * two legitimate states (Review v1.18.0): a live snooze — the snooze
     * moves only the alarm while remindAt stays in the past — and a cache
     * snapshot taken mid-rebuild that was momentarily empty. Only notes
     * that are gone, archived, or carry no reminder at all are truly
     * stale. Decided from FRESH per-note lookups, not the sweep's snapshot.
     */
    fun alarmStillBacked(noteExists: Boolean, isArchived: Boolean, remindAtEpochMs: Long?): Boolean =
        noteExists && !isArchived && remindAtEpochMs != null

    /**
     * May a fired alarm still ring? Mirrors the "upcoming reminder" query
     * (live note, remindAt set, not archived) and additionally drops alarms
     * whose reminder changed after they were planned: the alarm carries the
     * timestamp it was scheduled with, so a future remindAt that differs
     * means a newer alarm replaces this one.
     *
     * [scheduledAtEpochMs] is null for alarms planned by older app versions
     * (they carry no extra) and for the snooze action, where the alarm time
     * never matches remindAt by design — both fall back to "the reminder
     * still exists and was not moved forward".
     */
    fun shouldFire(
        noteExists: Boolean,
        isArchived: Boolean,
        remindAtEpochMs: Long?,
        scheduledAtEpochMs: Long?,
        nowEpochMs: Long
    ): Boolean {
        if (!noteExists || isArchived || remindAtEpochMs == null) return false
        // A future remindAt differing from this alarm's planned time means the
        // reminder was rescheduled — its own (newer) alarm will ring instead.
        if (remindAtEpochMs > nowEpochMs && remindAtEpochMs != scheduledAtEpochMs) return false
        return true
    }
}
