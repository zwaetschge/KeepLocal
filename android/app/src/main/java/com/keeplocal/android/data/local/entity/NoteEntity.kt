package com.keeplocal.android.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey
import androidx.room.TypeConverters
import com.keeplocal.android.data.local.Converters

@Entity(tableName = "notes")
@TypeConverters(Converters::class)
data class NoteEntity(
    @PrimaryKey val id: String,
    val title: String,
    val content: String,
    val color: String,
    val isPinned: Boolean,
    val isArchived: Boolean,
    val isTodoList: Boolean,
    val todoItemsJson: String,
    val tagsJson: String,
    val sharedWithJson: String,
    val owner: String,
    val position: Int,
    val createdAt: Long,
    val updatedAt: Long,
    // Image attachments serialized as JSON (see EntityMappers). Default keeps
    // schema-migration simple: ALTER TABLE ... ADD COLUMN with DEFAULT '[]'.
    val imagesJson: String = "[]",
    // Raw ISO updatedAt string of the server version this row is based on;
    // sent back as UpdateNoteDto.baseUpdatedAt for optimistic locking.
    val baseUpdatedAt: String? = null,
    // Reminder trigger time as epoch millis; null = no reminder. Room cannot
    // store Instant, and millis keep the v4 migration a single ADD COLUMN.
    val remindAtEpochMs: Long? = null,
    // Tree (v1.10.0): parent note id; null = root level. Children survive a
    // delete server-side (reparented one level up); locally the whole list is
    // replaced on sync, so no cascade handling is needed here.
    val parentId: String? = null,
    // Code note (v1.10.0): monospace rendering. Boolean with SQL DEFAULT 0
    // keeps the v5 migration a single ALTER TABLE like v4 before it.
    val isCode: Boolean = false
)
