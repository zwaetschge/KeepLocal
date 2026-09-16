package com.keeplocal.android.data.local

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.TypeConverters
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.keeplocal.android.data.local.dao.NoteDao
import com.keeplocal.android.data.local.dao.PendingOperationDao
import com.keeplocal.android.data.local.entity.NoteEntity
import com.keeplocal.android.data.local.entity.PendingOperationEntity

@Database(
    entities = [NoteEntity::class, PendingOperationEntity::class],
    version = 3,
    exportSchema = true
)
@TypeConverters(Converters::class)
abstract class AppDatabase : RoomDatabase() {
    abstract fun noteDao(): NoteDao
    abstract fun pendingOperationDao(): PendingOperationDao

    companion object {
        /**
         * v3 adds two columns to `notes`:
         * - `imagesJson`: serialized image attachments (parallel work; the
         *   entity default keeps existing rows at an empty list)
         * - `baseUpdatedAt`: raw server updatedAt this row is based on, sent
         *   back for optimistic locking of offline edits
         *
         * No 1->2 migration exists: that schema change predates schema export
         * and its historical diff is unrecoverable. Devices still on v1 fall
         * back to the backup-and-rebuild path in DatabaseModule.
         */
        val MIGRATION_2_3: Migration = object : Migration(2, 3) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE notes ADD COLUMN imagesJson TEXT NOT NULL DEFAULT '[]'")
                db.execSQL("ALTER TABLE notes ADD COLUMN baseUpdatedAt TEXT")
            }
        }
    }
}
