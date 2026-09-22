package com.keeplocal.android.di

import android.content.Context
import androidx.room.Room
import com.keeplocal.android.data.local.AppDatabase
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.dao.PendingOperationDao
import com.keeplocal.android.util.FileLogger
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    private const val DATABASE_NAME = "keeplocal_db"

    @Provides
    @Singleton
    fun provideDatabase(
        @ApplicationContext context: Context,
        fileLogger: FileLogger
    ): AppDatabase {
        val database = buildDatabase(context)
        return try {
            // Force the open (and with it any migration) here, so a missing
            // migration fails at the provider — where the old file can still
            // be backed up — instead of crashing on the first query later.
            database.openHelper.writableDatabase
            database
        } catch (e: Exception) {
            runCatching { database.close() }
            fileLogger.error("DatabaseModule", "Opening database failed, backing up and rebuilding", e)
            backupDatabaseFiles(context, fileLogger)
            buildDatabase(context)
        }
    }

    private fun buildDatabase(context: Context): AppDatabase =
        Room.databaseBuilder(context, AppDatabase::class.java, DATABASE_NAME)
            .addMigrations(
            AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4,
            AppDatabase.MIGRATION_4_5, AppDatabase.MIGRATION_5_6,
            AppDatabase.MIGRATION_6_7
        )
            .build()

    /**
     * No destructive fallback anymore: when no migration path exists (e.g. a
     * device still on schema v1), the database files are renamed to a
     * timestamped `.backup-*` copy next to the original and Room starts over
     * from an empty database instead of crashing on every launch.
     */
    private fun backupDatabaseFiles(context: Context, fileLogger: FileLogger) {
        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date())
        for (suffix in listOf("", "-wal", "-shm", "-journal")) {
            val file = context.getDatabasePath(DATABASE_NAME + suffix)
            if (!file.exists()) continue
            val target = File(file.parentFile, "${file.name}.backup-$stamp")
            val renamed = runCatching { file.renameTo(target) }.getOrDefault(false)
            if (!renamed) {
                // Keep the launch working even if the rename fails (e.g. full disk)
                runCatching { file.delete() }
                fileLogger.error("DatabaseModule", "Could not rename ${file.name}, deleted instead")
            } else {
                fileLogger.log("DatabaseModule", "Backed up ${file.name} to ${target.name}")
            }
        }
    }

    @Provides
    fun provideNoteDao(database: AppDatabase): NoteDao = database.noteDao()

    @Provides
    fun providePendingOperationDao(database: AppDatabase): PendingOperationDao = database.pendingOperationDao()
}
