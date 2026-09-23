package com.keeplocal.android.data.sync

import android.content.Context
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.data.local.SyncManager
import com.keeplocal.android.data.local.TokenManager
import com.keeplocal.android.reminder.ReminderScheduler
import com.keeplocal.android.util.FileLogger
import com.keeplocal.android.widget.NoteWidget
import com.keeplocal.android.widget.PinnedNotesWidget
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first

/**
 * Drains the offline queue while the app is in the background (every 15 min,
 * network permitting — see BackgroundSync). Quietly succeeds when there is
 * no session or the user turned background sync off; RETRY only on real
 * infrastructure errors, never on HTTP failures (those are already counted
 * as failed ops by the SyncManager and will be retried next period).
 */
@HiltWorker
class SyncWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val syncManager: SyncManager,
    private val settingsDataStore: SettingsDataStore,
    private val tokenManager: TokenManager,
    private val reminderScheduler: ReminderScheduler,
    private val fileLogger: FileLogger
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        if (!tokenManager.hasStoredSession()) return Result.success()
        if (!settingsDataStore.backgroundSync.first()) return Result.success()
        return try {
            val result = syncManager.syncPendingOperations()
            // Pull half (v1.14.0 Nr. 6): server-side changes land in Room even
            // while the app stays in the background. Meta probe gatet — ohne
            // Änderung kostet der Pull hier keinen einzigen List-Request.
            // v1.17.1 (Review): KEIN runCatching — das fängt Throwable und
            // hätte die CancellationException, die pullRemoteChanges seit
            // v1.17.0 durchreicht, wieder geschluckt (falsches „pulled=0“-
            // Log, Worker läuft als Zombie weiter). Best-Effort bleibt für
            // echte Fehler: 0 gezogene, der nächste Takt wiederholt.
            val pulled = try {
                syncManager.pullRemoteChanges()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                0
            }
            fileLogger.log(
                "SyncWorker",
                "background sync: synced=${result.synced} failed=${result.failed} " +
                    "skipped=${result.skipped} pulled=$pulled"
            )
            settingsDataStore.setLastSyncAt(System.currentTimeMillis())
            // Pinned notes/single-note widgets may show stale data now — refresh.
            runCatching { PinnedNotesWidget.refreshAll(applicationContext) }
            runCatching { NoteWidget.refreshAll(applicationContext) }
            // Synced or pulled updates may have changed reminders — re-plan alarms.
            if (result.synced > 0 || pulled > 0) {
                runCatching { reminderScheduler.rescheduleAll() }
            }
            Result.success()
        } catch (e: CancellationException) {
            // WorkManager-Abbruch (Stopp/Timeout) ist kein Crash und kein
            // RETRY-Fall (v1.17.0): geschluckt würde der Worker dem System
            // ein Ergebnis melden und den Abbruch brechen.
            throw e
        } catch (e: Exception) {
            fileLogger.error("SyncWorker", "background sync crashed", e)
            Result.retry()
        }
    }
}
