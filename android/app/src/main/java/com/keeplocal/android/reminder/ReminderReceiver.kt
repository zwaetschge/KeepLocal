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
 * snooze action by re-planning the alarm 15 minutes out. Tapping the
 * notification opens the note (MainActivity reads EXTRA_NOTE_ID); "Done"
 * merely dismisses — the reminder stays on the note until the user removes it.
 */
@AndroidEntryPoint
class ReminderReceiver : BroadcastReceiver() {

    @Inject lateinit var reminderScheduler: ReminderScheduler
    @Inject lateinit var fileLogger: FileLogger

    override fun onReceive(context: Context, intent: Intent) {
        val noteId = intent.getStringExtra(EXTRA_NOTE_ID) ?: return
        when (intent.action) {
            ACTION_SNOOZE -> {
                val title = intent.getStringExtra(EXTRA_TITLE).orEmpty()
                val pendingResult = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        reminderScheduler.scheduleAt(
                            noteId, title, System.currentTimeMillis() + ReminderScheduler.SNOOZE_MILLIS
                        )
                        NotificationManagerCompat.from(context).cancel(noteId.hashCode())
                    } finally {
                        pendingResult.finish()
                    }
                }
            }

            ACTION_DISMISS -> NotificationManagerCompat.from(context).cancel(noteId.hashCode())

            else -> showNotification(context, noteId, intent.getStringExtra(EXTRA_TITLE).orEmpty())
        }
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
                context.getString(R.string.reminder_snooze),
                broadcast(context, noteId, title, ACTION_SNOOZE)
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

    private fun broadcast(context: Context, noteId: String, title: String, action: String): PendingIntent =
        PendingIntent.getBroadcast(
            context,
            noteId.hashCode() + action.hashCode(),
            Intent(context, ReminderReceiver::class.java).apply {
                this.action = action
                putExtra(EXTRA_NOTE_ID, noteId)
                putExtra(EXTRA_TITLE, title)
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
    }
}
