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
 * infrastructure. Each note owns one alarm slot (requestCode = noteId hash):
 * re-planning a note overwrites its old alarm, cancelling clears it.
 */
@Singleton
class ReminderScheduler @Inject constructor(
    @ApplicationContext private val context: Context,
    private val noteDao: NoteDao,
    private val fileLogger: FileLogger
) {
    private val alarmManager = context.getSystemService(AlarmManager::class.java)

    /** Re-plans every upcoming reminder — after boot, after a sync, on login. */
    suspend fun rescheduleAll() {
        val upcoming = noteDao.getNotesWithUpcomingReminders(System.currentTimeMillis())
        upcoming.forEach { entity ->
            schedule(entity.id, entity.title, checkNotNull(entity.remindAtEpochMs))
        }
        if (upcoming.isNotEmpty()) {
            fileLogger.log("ReminderScheduler", "planned ${upcoming.size} reminder alarm(s)")
        }
    }

    /** Re-plans exactly one note after its reminder changed locally. */
    suspend fun syncForNote(noteId: String) {
        val entity = noteDao.getNoteById(noteId)
        val trigger = entity?.remindAtEpochMs
        if (entity != null && trigger != null && trigger > System.currentTimeMillis()) {
            schedule(entity.id, entity.title, trigger)
        } else {
            cancel(noteId)
        }
    }

    /** Plans (or re-plans) a concrete alarm; used by the receiver for snooze. */
    fun scheduleAt(noteId: String, title: String, triggerAtMillis: Long) {
        schedule(noteId, title, triggerAtMillis)
    }

    private fun schedule(noteId: String, title: String, triggerAtMillis: Long) {
        val pendingIntent = reminderPendingIntent(noteId, title)
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
    }

    fun cancel(noteId: String) {
        alarmManager.cancel(reminderPendingIntent(noteId, null))
    }

    private fun reminderPendingIntent(noteId: String, title: String?): PendingIntent {
        val intent = Intent(context, ReminderReceiver::class.java).apply {
            action = ReminderReceiver.ACTION_FIRED
            putExtra(ReminderReceiver.EXTRA_NOTE_ID, noteId)
            title?.let { putExtra(ReminderReceiver.EXTRA_TITLE, it) }
        }
        return PendingIntent.getBroadcast(
            context,
            noteId.hashCode(),
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
    }

    companion object {
        /** Snooze shift of the notification's action button (15 minutes). */
        const val SNOOZE_MILLIS = 15L * 60_000
    }
}
