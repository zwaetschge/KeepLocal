package com.keeplocal.android.data.backup

import android.content.Context
import android.net.Uri
import androidx.documentfile.provider.DocumentFile
import androidx.hilt.work.HiltWorker
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.keeplocal.android.data.local.SettingsDataStore
import com.keeplocal.android.domain.repository.NoteRepository
import com.keeplocal.android.util.FileLogger
// CoroutineWorker's own nested Result (success/failure/retry) shadows plain
// imports inside the class body — alias the app's Result to keep both usable.
import com.keeplocal.android.util.Result as DataResult
import com.keeplocal.android.util.NoteExportFormatter
import dagger.assisted.Assisted
import dagger.assisted.AssistedInject
import kotlinx.coroutines.flow.first
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Writes a JSON backup of every local note into the user-picked SAF folder
 * (v1.8.0 Nr. 7) — same format as the manual export, so a backup doubles as a
 * restore source for the importer. Runs periodically (BackupScheduler) or as a
 * one-off for "Back up now"; retention keeps the newest N files only.
 */
@HiltWorker
class BackupWorker @AssistedInject constructor(
    @Assisted appContext: Context,
    @Assisted params: WorkerParameters,
    private val noteRepository: NoteRepository,
    private val settingsDataStore: SettingsDataStore,
    private val fileLogger: FileLogger
) : CoroutineWorker(appContext, params) {

    override suspend fun doWork(): Result {
        val treeUriString = settingsDataStore.backupTreeUri.first()
        if (treeUriString.isBlank()) return Result.success() // nothing configured

        val treeUri = runCatching { Uri.parse(treeUriString) }.getOrNull()
            ?: return Result.failure() // unparseable stored URI — never self-heals
        val folder = DocumentFile.fromTreeUri(applicationContext, treeUri)
            ?.takeIf { it.exists() && it.canWrite() }
            ?: return Result.retry() // SAF provider not ready (boot, USB drive)

        val notes = when (val fetched = noteRepository.getAllNotesForExport()) {
            is DataResult.Success -> fetched.data
            is DataResult.Error -> {
                // No notes, no backup — retrying would loop on a broken render.
                fileLogger.error("BackupWorker", "export render failed: ${fetched.message}")
                return Result.failure()
            }
        }
        val json = NoteExportFormatter.json(notes, Instant.now())

        val name = fileName(System.currentTimeMillis())
        val file = folder.createFile("application/json", name)
        if (file == null) {
            fileLogger.error("BackupWorker", "could not create $name in backup folder")
            return Result.retry()
        }
        val written = runCatching {
            val out = applicationContext.contentResolver.openOutputStream(file.uri)
            if (out == null) {
                false
            } else {
                out.use { it.write(json.toByteArray(Charsets.UTF_8)) }
                true
            }
        }.getOrDefault(false)
        if (!written) {
            runCatching { file.delete() }
            fileLogger.error("BackupWorker", "writing $name failed")
            return Result.retry()
        }

        applyRetention(folder, settingsDataStore.backupRetention.first())
        settingsDataStore.setLastBackupAt(System.currentTimeMillis())
        fileLogger.log("BackupWorker", "backup $name written (${notes.size} notes)")
        return Result.success()
    }

    /** Deletes the oldest backups beyond [keep] — newest last by name (the
     *  filename timestamp sorts lexicographically). */
    private fun applyRetention(folder: DocumentFile, keep: Int) {
        if (keep <= 0) return
        val backups = folder.listFiles()
            .filter { it.name.orEmpty().startsWith(FILE_PREFIX) && it.name.orEmpty().endsWith(".json") }
            .sortedByDescending { it.name.orEmpty() }
        backups.drop(keep).forEach { runCatching { it.delete() } }
    }

    companion object {
        const val FILE_PREFIX = "keeplocal-backup-"
        private val NAME_FORMAT = DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss", Locale.US)

        /** "keeplocal-backup-20260917-083000.json" — sortable, collision-free
         *  down to one backup per second. */
        fun fileName(epochMillis: Long): String {
            val local = LocalDateTime.ofInstant(Instant.ofEpochMilli(epochMillis), ZoneId.systemDefault())
            return "$FILE_PREFIX${NAME_FORMAT.format(local)}.json"
        }
    }
}
