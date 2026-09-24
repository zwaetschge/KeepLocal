package com.keeplocal.android.reminder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReminderAlarmPlanTest {

    private val now = 1_800_000_000_000L

    // --- staleIds: which recorded alarms no longer have a reminder behind them ---

    @Test
    fun `alarm whose reminder was removed is stale`() {
        val stale = ReminderAlarmPlan.staleIds(
            scheduledIds = setOf("a", "b"),
            desiredIds = setOf("b")
        )
        assertEquals(setOf("a"), stale)
    }

    @Test
    fun `alarm of a still upcoming reminder is not stale`() {
        val stale = ReminderAlarmPlan.staleIds(
            scheduledIds = setOf("a"),
            desiredIds = setOf("a", "c")
        )
        assertTrue(stale.isEmpty())
    }

    @Test
    fun `rescheduled reminder keeps its id and is not stale`() {
        // Moving a reminder re-plans the same note id — nothing to cancel.
        val stale = ReminderAlarmPlan.staleIds(setOf("a"), setOf("a"))
        assertTrue(stale.isEmpty())
    }

    @Test
    fun `note deleted on another device leaves a stale alarm`() {
        // The pull path deletes the Room row without passing the scheduler.
        val stale = ReminderAlarmPlan.staleIds(setOf("gone", "kept"), setOf("kept"))
        assertEquals(setOf("gone"), stale)
    }

    @Test
    fun `empty registry cancels nothing`() {
        assertTrue(ReminderAlarmPlan.staleIds(emptySet(), setOf("a")).isEmpty())
    }

    @Test
    fun `no reminders left cancels every recorded alarm`() {
        assertEquals(setOf("a", "b"), ReminderAlarmPlan.staleIds(setOf("a", "b"), emptySet()))
    }

    // --- shouldFire: may a fired alarm still ring? ---

    @Test
    fun `untouched reminder fires`() {
        val firedAt = now - 5_000 // alarm planned five seconds ago
        assertTrue(
            ReminderAlarmPlan.shouldFire(
                noteExists = true,
                isArchived = false,
                remindAtEpochMs = firedAt,
                scheduledAtEpochMs = firedAt,
                nowEpochMs = now
            )
        )
    }

    @Test
    fun `deleted note never fires`() {
        assertFalse(
            ReminderAlarmPlan.shouldFire(
                noteExists = false,
                isArchived = false,
                remindAtEpochMs = now,
                scheduledAtEpochMs = now,
                nowEpochMs = now
            )
        )
    }

    @Test
    fun `archived note never fires`() {
        assertFalse(
            ReminderAlarmPlan.shouldFire(
                noteExists = true,
                isArchived = true,
                remindAtEpochMs = now,
                scheduledAtEpochMs = now,
                nowEpochMs = now
            )
        )
    }

    @Test
    fun `reminder removed after scheduling never fires`() {
        assertFalse(
            ReminderAlarmPlan.shouldFire(
                noteExists = true,
                isArchived = false,
                remindAtEpochMs = null,
                scheduledAtEpochMs = now - 5_000,
                nowEpochMs = now
            )
        )
    }

    @Test
    fun `reminder moved forward suppresses the old alarm`() {
        // The note carries a newer reminder time — its own alarm will ring.
        assertFalse(
            ReminderAlarmPlan.shouldFire(
                noteExists = true,
                isArchived = false,
                remindAtEpochMs = now + 60_000,
                scheduledAtEpochMs = now - 5_000,
                nowEpochMs = now
            )
        )
    }

    @Test
    fun `snoozed alarm fires although remindAt differs`() {
        // A snooze moves only the alarm; the note's remindAt stays in the past.
        assertTrue(
            ReminderAlarmPlan.shouldFire(
                noteExists = true,
                isArchived = false,
                remindAtEpochMs = now - 300_000,
                scheduledAtEpochMs = now,
                nowEpochMs = now
            )
        )
    }

    @Test
    fun `snooze is refused after the reminder was removed`() {
        // The snooze action reuses shouldFire with a null scheduled time.
        assertFalse(
            ReminderAlarmPlan.shouldFire(
                noteExists = true,
                isArchived = false,
                remindAtEpochMs = null,
                scheduledAtEpochMs = null,
                nowEpochMs = now
            )
        )
    }

    @Test
    fun `snooze is refused when the reminder was moved forward`() {
        // A future remindAt without a matching scheduled time means a newer
        // alarm exists — snoozing the stale notification must not stack a
        // second alarm on top of it.
        assertFalse(
            ReminderAlarmPlan.shouldFire(
                noteExists = true,
                isArchived = false,
                remindAtEpochMs = now + 60_000,
                scheduledAtEpochMs = null,
                nowEpochMs = now
            )
        )
    }

    @Test
    fun `legacy alarm without scheduled extra still fires for an untouched reminder`() {
        // Alarms planned before EXTRA_SCHEDULED_AT existed carry no timestamp;
        // an untouched reminder fires, a rescheduled one stays silent.
        assertTrue(
            ReminderAlarmPlan.shouldFire(
                noteExists = true,
                isArchived = false,
                remindAtEpochMs = now - 5_000,
                scheduledAtEpochMs = null,
                nowEpochMs = now
            )
        )
        assertFalse(
            ReminderAlarmPlan.shouldFire(
                noteExists = true,
                isArchived = false,
                remindAtEpochMs = now + 60_000,
                scheduledAtEpochMs = null,
                nowEpochMs = now
            )
        )
    }
    // --- v1.18.0-Review: Kandidaten mit lebendem Alarm ---

    @Test
    fun `a live snooze keeps its alarm through a sweep`() {
        // Snooze: remindAt liegt in der Vergangenheit, der Alarm in der
        // Zukunft — der Sweep darf ihn nicht als stale abwürgen.
        assertTrue(
            ReminderAlarmPlan.alarmStillBacked(
                noteExists = true,
                isArchived = false,
                remindAtEpochMs = now - 60_000
            )
        )
    }

    @Test
    fun `gone, archived and reminder-less notes are truly stale`() {
        assertFalse(
            ReminderAlarmPlan.alarmStillBacked(
                noteExists = false, isArchived = false, remindAtEpochMs = now
            )
        )
        assertFalse(
            ReminderAlarmPlan.alarmStillBacked(
                noteExists = true, isArchived = true, remindAtEpochMs = now
            )
        )
        assertFalse(
            ReminderAlarmPlan.alarmStillBacked(
                noteExists = true, isArchived = false, remindAtEpochMs = null
            )
        )
    }

    @Test
    fun `a mid-rebuild empty snapshot does not count as stale`() {
        // Der Sweep sah einen leeren Cache, die frische Abfrage sieht die
        // Notiz wieder — geschützt wie der Snooze-Fall.
        assertTrue(
            ReminderAlarmPlan.alarmStillBacked(
                noteExists = true,
                isArchived = false,
                remindAtEpochMs = now + 3_600_000
            )
        )
    }
}
