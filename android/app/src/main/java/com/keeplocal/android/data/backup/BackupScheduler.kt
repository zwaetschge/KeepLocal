package com.keeplocal.android.data.backup

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit

/**
 * Registers the periodic automatic backup (v1.8.0 Nr. 7). Interval hours <= 0
 * cancels it. UPDATE (not KEEP) so changing the interval takes effect without
 * uninstall/reinstall — WorkManager keeps the schedule, replaces the spec.
 */
object BackupScheduler {
    const val WORK_NAME = "keeplocal_periodic_backup"
    const val WORK_NAME_ONCE = "keeplocal_backup_now"

    fun schedule(context: Context, intervalHours: Int) {
        if (intervalHours <= 0) {
            cancel(context)
            return
        }
        val request = PeriodicWorkRequestBuilder<BackupWorker>(intervalHours.toLong(), TimeUnit.HOURS)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(WORK_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    fun cancel(context: Context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }

    /** "Back up now" from settings — runs immediately, once. */
    fun runNow(context: Context) {
        val request = OneTimeWorkRequestBuilder<BackupWorker>().build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(WORK_NAME_ONCE, ExistingWorkPolicy.REPLACE, request)
    }
}
