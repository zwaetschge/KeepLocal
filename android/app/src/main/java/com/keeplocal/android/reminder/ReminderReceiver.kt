package com.keeplocal.android.reminder

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.keeplocal.android.R
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.ui.MainActivity
import com.keeplocal.android.util.FileLogger
import com.keeplocal.android.util.IncomingIntents
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Fires when a reminder alarm goes off: shows the notification, or handles its
 * snooze actions (5 minutes / 1 hour, v1.9.0) by re-planning the alarm.
 * Tapping the notification opens the note (MainActivity reads EXTRA_NOTE_ID);
 * "Done" merely dismisses — the reminder stays on the note until the user
 * removes it.
 *
 * The alarm was planned minutes or days earlier, so the intent payload alone
 * proves nothing: before ringing (or snoozing) the note is re-read from Room
 * and ReminderAlarmPlan.shouldFire() decides whether the reminder is still the
 * one this alarm was planned for (v1.18.0). A removed, moved, or remotely
 * deleted reminder stays silent.
 */
@AndroidEntryPoint
class ReminderReceiver : BroadcastReceiver() {

    @Inject lateinit var reminderScheduler: ReminderScheduler
    @Inject lateinit var noteDao: NoteDao
    @Inject lateinit var fileLogger: FileLogger

    override fun onReceive(context: Context, intent: Intent) {
        val noteId = intent.getStringExtra(EXTRA_NOTE_ID) ?: return
        when (intent.action) {
            ACTION_SNOOZE -> {
                val title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
                val delay = if (intent.hasExtra(EXTRA_SNOOZE_DELAY)) {
                    intent.getLongExtra(EXTRA_SNOOZE_DELAY, ReminderScheduler.SNOOZE_SHORT_MILLIS)
                } else {
                    ReminderScheduler.SNOOZE_SHORT_MILLIS
                }
                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        // The user may have removed or moved the reminder while
                        // the notification sat in the tray — snooze nothing.
                        if (reminderStillOnNote(noteId)) {
                            reminderScheduler.scheduleAt(
                                noteId, title, System.currentTimeMillis() + delay
                            )
                            NotificationManagerCompat.from(context).cancel(noteId.hashCode())
                        } else {
                            fileLogger.log("ReminderReceiver", "snooze skipped, reminder gone for $noteId")
                        }
                    } finally {
                        pendingResult.finish()
                    }
                }
            }

            ACTION_DISMISS -> NotificationManagerCompat.from(context).cancel(noteId.hashCode())

            else -> {
                val scheduledAt = if (intent.hasExtra(EXTRA_SCHEDULED_AT)) {
                    intent.getLongExtra(EXTRA_SCHEDULED_AT, Long.MIN_VALUE)
                } else {
                    null
                }
                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        val note = noteDao.getNoteById(noteId)
                        val fire = ReminderAlarmPlan.shouldFire(
                            noteExists = note != null,
                            isArchived = note?.isArchived == true,
                            remindAtEpochMs = note?.remindAtEpochMs,
                            scheduledAtEpochMs = scheduledAt,
                            nowEpochMs = System.currentTimeMillis()
                        )
                        if (fire) {
                            showNotification(context, noteId, intent.getStringExtra(EXTRA_TITLE).orEmpty())
                        } else {
                            fileLogger.log("ReminderReceiver", "skipped stale reminder alarm for $noteId")
                        }
                    } finally {
                        pendingResult.finish()
                    }
                }
            }
        }
    }

    /**
     * Snooze needs less than the fire check: the reminder must still exist on
     * a live, unarchived note, but its time is irrelevant — it fired already.
     */
    private suspend fun reminderStillOnNote(noteId: String): Boolean {
        val note = noteDao.getNoteById(noteId)
        return ReminderAlarmPlan.shouldFire(
            noteExists = note != null,
            isArchived = note?.isArchived == true,
            remindAtEpochMs = note?.remindAtEpochMs,
            scheduledAtEpochMs = null,
            nowEpochMs = System.currentTimeMillis()
        )
    }

    private fun showNotification(context: Context, noteId: String, title: String) {
        ensureChannel(context)
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            fileLogger.log("ReminderReceiver", "notification suppressed (no permission) for $noteId")
            return
        }

        val openNote = PendingIntent.getActivity(
            context,
            noteId.hashCode(),
            Intent(context, MainActivity::class.java).apply {
                // IncomingIntents.handle() reads this extra on cold start and
                // onNewIntent alike and navigates to the note.
                putExtra(IncomingIntents.EXTRA_OPEN_NOTE_ID, noteId)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_launcher_monochrome)
            .setContentTitle(title.ifBlank { context.getString(R.string.reminder_fallback_title) })
            .setContentText(context.getString(R.string.reminder_fallback_title))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(openNote)
            .addAction(
                0,
                context.getString(R.string.reminder_snooze_short),
                broadcast(context, noteId, title, ACTION_SNOOZE, ReminderScheduler.SNOOZE_SHORT_MILLIS)
            )
            .addAction(
                0,
                context.getString(R.string.reminder_snooze_hour),
                broadcast(context, noteId, title, ACTION_SNOOZE, ReminderScheduler.SNOOZE_HOUR_MILLIS)
            )
            .addAction(
                0,
                context.getString(R.string.reminder_done),
                broadcast(context, noteId, title, ACTION_DISMISS)
            )
            .build()

        try {
            NotificationManagerCompat.from(context).notify(noteId.hashCode(), notification)
        } catch (e: SecurityException) {
            // Permission revoked while the process was alive.
            fileLogger.error("ReminderReceiver", "cannot post reminder notification", e)
        }
    }

    private fun broadcast(
        context: Context,
        noteId: String,
        title: String,
        action: String,
        snoozeDelayMillis: Long? = null
    ): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            noteId.hashCode() + action.hashCode() + (snoozeDelayMillis ?: 0L).hashCode(),
            Intent(context, ReminderReceiver::class.java).apply {
                this.action = action
                putExtra(EXTRA_NOTE_ID, noteId)
                putExtra(EXTRA_TITLE, title)
                snoozeDelayMillis?.let { putExtra(EXTRA_SNOOZE_DELAY, it) }
            },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            context.getString(R.string.reminder_channel_name),
            NotificationManager.IMPORTANCE_HIGH
        ).apply { description = context.getString(R.string.reminder_channel_description) }
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "reminders"
        const val ACTION_FIRED = "com.keeplocal.android.reminder.FIRED"
        const val ACTION_SNOOZE = "com.keeplocal.android.reminder.SNOOZE"
        const val ACTION_DISMISS = "com.keeplocal.android.reminder.DISMISS"
        const val EXTRA_NOTE_ID = "note_id"
        const val EXTRA_TITLE = "title"
        const val EXTRA_SNOOZE_DELAY = "snooze_delay_millis"

        /** The trigger the alarm was planned with — lets the receiver detect a
         *  reminder that was rescheduled after this alarm was set. */
        const val EXTRA_SCHEDULED_AT = "scheduled_at_millis"
    }
}
