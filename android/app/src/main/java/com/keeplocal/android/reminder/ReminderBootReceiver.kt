package com.keeplocal.android.reminder

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import com.keeplocal.android.util.FileLogger
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import javax.inject.Inject

/**
 * Alarms do not survive a reboot — re-plan every upcoming reminder once the
 * device is up again (v1.8.0 Nr. 2). goAsync() keeps the receiver alive for
 * the database read without scheduling a WorkManager job for three queries.
 */
@AndroidEntryPoint
class ReminderBootReceiver : BroadcastReceiver() {

    @Inject lateinit var reminderScheduler: ReminderScheduler
    @Inject lateinit var fileLogger: FileLogger

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED &&
            intent.action != Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            return
        }
        val pendingResult = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                runCatching { reminderScheduler.rescheduleAll() }
                    .onFailure { fileLogger.error("ReminderBootReceiver", "re-planning failed", it) }
            } finally {
                pendingResult.finish()
            }
        }
    }
}
