package com.keeplocal.android.reminder

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.util.FileLogger
import dagger.hilt.android.qualifiers.ApplicationContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Plans the local notification for each note reminder (v1.8.0 Nr. 2).
 *
 * The server only stores `remindAt`; every device schedules its own
 * AlarmManager alarm so reminders fire offline, in Doze, and without push
 * infrastructure. Each note owns one alarm slot (requestCode = one stable
 * int per note, allocated collision-free in the registry; FLAG_UPDATE_CURRENT):
 * re-planning a note overwrites its old alarm, cancelling clears it.
 *
 * AlarmManager cannot enumerate its alarms, so the ids of all planned alarms
 * live in a tiny SharedPreferences registry. rescheduleAll() diffs that
 * registry against the reminders Room still backs (v1.18.0): alarms whose
 * reminder was edited away, moved, or whose note vanished in a remote-change
 * pull (the pull path deletes rows without passing through the scheduler)
 * are cancelled instead of ringing for a state that no longer exists. The
 * receiver's ReminderAlarmPlan.shouldFire() re-check is the second belt.
 */
@Singleton
class ReminderScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
    private val noteDao: NoteDao,
    private val fileLogger: FileLogger
) {
    private val alarmManager = context.getSystemService(AlarmManager::class.java)
    private val alarmRegistry = context.applicationContext
        .getSharedPreferences(REGISTRY_PREFS, Context.MODE_PRIVATE)

    /** Re-plans every upcoming reminder — after boot, after a sync, on login. */
    suspend fun rescheduleAll() {
        val upcoming = noteDao.getNotesWithUpcomingReminders(System.currentTimeMillis())
        val desiredIds = upcoming.mapTo(mutableSetOf()) { it.id }
        // Stale candidates first: a reminder that was removed or whose note
        // was deleted remotely would otherwise survive this sweep. Two states
        // look stale but are not (Review v1.18.0): a live snooze (remindAt in
        // the past, alarm in the future) and an empty snapshot taken while a
        // cache rebuild was mid-flight — fresh per-note lookups decide.
        val staleCandidates = ReminderAlarmPlan.staleIds(scheduledIds(), desiredIds)
        val stillBackedIds = staleCandidates.filterTo(mutableSetOf()) { id ->
            val entity = noteDao.getNoteById(id)
            ReminderAlarmPlan.alarmStillBacked(
                noteExists = entity != null,
                isArchived = entity?.isArchived == true,
                remindAtEpochMs = entity?.remindAtEpochMs
            )
        }
        val staleIds = staleCandidates - stillBackedIds
        staleIds.forEach { cancel(it) }
        upcoming.forEach { entity ->
            schedule(entity.id, entity.title, checkNotNull(entity.remindAtEpochMs))
        }
        storeScheduledIds(desiredIds + stillBackedIds)
        if (upcoming.isNotEmpty() || staleIds.isNotEmpty()) {
            fileLogger.log(
                "ReminderScheduler",
                "planned ${upcoming.size} reminder alarm(s), cancelled ${staleIds.size} stale"
            )
        }
    }

    /** Re-plans exactly one note after its reminder changed locally. */
    suspend fun syncForNote(noteId: String) {
        val entity = noteDao.getNoteById(noteId)
        val trigger = entity?.remindAtEpochMs
        // Archived notes are excluded like getNotesWithUpcomingReminders —
        // otherwise this path and rescheduleAll would keep re-adding and
        // cancelling each other's alarm for the same note.
        if (entity != null && !entity.isArchived &&
            trigger != null && trigger > System.currentTimeMillis()
        ) {
            schedule(entity.id, entity.title, trigger)
        } else {
            cancel(noteId)
        }
    }

    /**
     * Plans (or re-plans) a concrete alarm; used by the receiver for snooze.
     * A snooze moves only the alarm, never the note's remindAt.
     */
    fun scheduleAt(noteId: String, title: String, triggerAtMillis: Long) {
        schedule(noteId, title, triggerAtMillis)
    }

    private fun schedule(noteId: String, title: String, triggerAtMillis: Long) {
        val requestCode = allocateRequestCode(noteId)
        if (requestCode != noteId.hashCode()) {
            // Legacy alarm from a pre-v1.18.0 build still sits on the raw
            // hashCode slot — clear it or it rings beside the migrated one.
            runCatching {
                alarmManager.cancel(reminderPendingIntent(noteId, null, null, noteId.hashCode()))
            }
        }
        val pendingIntent = reminderPendingIntent(noteId, title, triggerAtMillis, requestCode)
        try {
            // Exact when the user granted it; otherwise a Doze-tolerant window —
            // a slightly late reminder beats none.
            if (alarmManager.canScheduleExactAlarms()) {
                alarmManager.setExactAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent
                )
            } else {
                alarmManager.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent
                )
            }
        } catch (e: SecurityException) {
            // Permission revoked between canScheduleExactAlarms() and set —
            // fall back to the inexact variant instead of losing the reminder.
            runCatching {
                alarmManager.setAndAllowWhileIdle(
                    AlarmManager.RTC_WAKEUP, triggerAtMillis, pendingIntent
                )
            }.onFailure { fileLogger.error("ReminderScheduler", "could not plan alarm for $noteId", e) }
        }
        rememberScheduled(noteId)
    }

    fun cancel(noteId: String) {
        // Extras are irrelevant for matching — the intent filter and the
        // requestCode identify the alarm. Unassigned = never planned here
        // (or legacy hashCode slot) — both target hashCode harmlessly.
        alarmManager.cancel(reminderPendingIntent(noteId, title = null, triggerAtMillis = null,
            requestCode = pendingRequestCode(noteId)))
        forgetScheduled(noteId)
    }

    /**
     * One stable int per note for the PendingIntent requestCode. A raw
     * noteId.hashCode() collides across 32-bit hashes for a handful of notes
     * (Review v1.18.0) — two colliding notes would share one alarm slot and
     * silently lose one reminder. Codes are allocated once and persist in
     * the registry; the sentinel keeps never-planned ids on hashCode.
     */
    private fun allocateRequestCode(noteId: String): Int {
        val stored = alarmRegistry.getInt(codeKey(noteId), CODE_UNASSIGNED)
        if (stored != CODE_UNASSIGNED) return stored
        val used = alarmRegistry.all
            .orEmpty()
            .filterKeys { it.startsWith(CODE_KEY_PREFIX) }
            .values
            .mapNotNull { it as? Int }
            .toSet()
        var candidate = alarmRegistry.getInt(KEY_NEXT_CODE, 1)
        while (candidate in used) candidate++
        alarmRegistry.edit()
            .putInt(codeKey(noteId), candidate)
            .putInt(KEY_NEXT_CODE, candidate + 1)
            .apply()
        return candidate
    }

    /** The code a live alarm would sit on; hashCode for unassigned/legacy ids. */
    private fun pendingRequestCode(noteId: String): Int {
        val stored = alarmRegistry.getInt(codeKey(noteId), CODE_UNASSIGNED)
        return if (stored != CODE_UNASSIGNED) stored else noteId.hashCode()
    }

    private fun reminderPendingIntent(
        noteId: String,
        title: String?,
        triggerAtMillis: Long?,
        requestCode: Int
    ): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_FIRED
            putExtra(ReminderReceiver.EXTRA_NOTE_ID, noteId)
            title?.let { putExtra(ReminderReceiver.EXTRA_TITLE, it) }
            // The receiver compares this against the note's current remindAt —
            // a mismatch means the reminder changed after this alarm was set.
            triggerAtMillis?.let { putExtra(ReminderReceiver.EXTRA_SCHEDULED_AT, it) }
        }
        return PendingIntent.getBroadcast(
            context,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }

    private fun scheduledIds(): Set<String> =
        alarmRegistry.getStringSet(REGISTRY_KEY, emptySet()).orEmpty()

    private fun storeScheduledIds(ids: Set<String>) {
        alarmRegistry.edit().putStringSet(REGISTRY_KEY, ids).apply()
    }

    private fun rememberScheduled(noteId: String) = storeScheduledIds(scheduledIds() + noteId)

    private fun forgetScheduled(noteId: String) {
        alarmRegistry.edit()
            .putStringSet(REGISTRY_KEY, scheduledIds() - noteId)
            .remove(codeKey(noteId))
            .apply()
    }

    companion object {
        /** Snooze choices (v1.9.0): notification actions 5 min / 1 hour, the
         *  reminder overview additionally offers "tomorrow morning". */
        const val SNOOZE_SHORT_MILLIS = 5L * 60_000
        const val SNOOZE_HOUR_MILLIS = 60L * 60_000

        /** Tomorrow 09:00 local time — a snooze that survives the night. */
        fun nextMorningMillis(nowMillis: Long = System.currentTimeMillis()): Long =
            java.util.Calendar.getInstance().apply {
                timeInMillis = nowMillis
                add(java.util.Calendar.DAY_OF_YEAR, 1)
                set(java.util.Calendar.HOUR_OF_DAY, 9)
                set(java.util.Calendar.MINUTE, 0)
                set(java.util.Calendar.SECOND, 0)
                set(java.util.Calendar.MILLISECOND, 0)
            }.timeInMillis

        private const val REGISTRY_PREFS = "reminder_alarms"
        private const val REGISTRY_KEY = "scheduled_note_ids"
        private const val CODE_KEY_PREFIX = "request_code_"
        private const val KEY_NEXT_CODE = "next_request_code"
        /** Never allocated as a requestCode; SharedPreferences getInt default. */
        private const val CODE_UNASSIGNED = Int.MIN_VALUE

        private fun codeKey(noteId: String) = CODE_KEY_PREFIX + noteId
    }
}
