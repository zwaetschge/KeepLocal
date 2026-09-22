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
    version = 7,
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

        /**
         * v4 adds `remindAtEpochMs` (reminder trigger time, null = none). The
         * offline queue lives in the same database file, so this must be an
         * in-place migration — never destructive.
         */
        val MIGRATION_3_4: Migration = object : Migration(3, 4) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE notes ADD COLUMN remindAtEpochMs INTEGER")
            }
        }

        /**
         * v5 adds the tree (v1.10.0): `parentId` (parent note id, null = root)
         * and `isCode` (monospace rendering). Two additive columns; existing
         * rows become root-level text notes, which is what they were before.
         */
        val MIGRATION_4_5: Migration = object : Migration(4, 5) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE notes ADD COLUMN parentId TEXT")
                db.execSQL("ALTER TABLE notes ADD COLUMN isCode INTEGER NOT NULL DEFAULT 0")
            }
        }

        /**
         * v6 adds `filesJson` (PDF attachments, v1.14.0 Nr. 5). One additive
         * column with DEFAULT '[]' — existing rows simply have no attachments,
         * which is what the app showed before the field existed at all.
         */
        val MIGRATION_5_6: Migration = object : Migration(5, 6) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE notes ADD COLUMN filesJson TEXT NOT NULL DEFAULT '[]'")
            }
        }

        /**
         * v7 adds the poison guard to `pending_operations` (v1.16.0):
         * `attemptCount` counts server-side rejections, `poisoned` takes an
         * op out of the drain rotation after SyncManager.MAX_SYNC_ATTEMPTS.
         * Both additive with neutral defaults — every existing queued op
         * starts at zero attempts, unpoisoned.
         */
        val MIGRATION_6_7: Migration = object : Migration(6, 7) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE pending_operations ADD COLUMN attemptCount INTEGER NOT NULL DEFAULT 0")
                db.execSQL("ALTER TABLE pending_operations ADD COLUMN poisoned INTEGER NOT NULL DEFAULT 0")
            }
        }
    }
}
