package com.keeplocal.android.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "pending_operations")
data class PendingOperationEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val operationType: String,
    val noteId: String,
    val payloadJson: String,
    val createdAt: Long = System.currentTimeMillis()
)

object OperationType {
    const val CREATE = "CREATE"
    const val UPDATE = "UPDATE"
    const val DELETE = "DELETE"
    const val TOGGLE_PIN = "TOGGLE_PIN"
    const val TOGGLE_ARCHIVE = "TOGGLE_ARCHIVE"

    /**
     * Manual drag-reorder. Not tied to one note, so it uses the sentinel
     * noteId "reorder" — the replay reads the current order fresh from Room,
     * which also collapses several consecutive drag actions into one op.
     */
    const val REORDER = "REORDER"
    const val REORDER_SENTINEL_NOTE_ID = "reorder"
}
