package com.keeplocal.android.data.local.entity

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "pending_operations")
data class PendingOperationEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val operationType: String,
    val noteId: String,
    val payloadJson: String,
    val createdAt: Long = System.currentTimeMillis(),
    /** Server-side failures only (HTTP answer ≠ 2xx) — network hiccups and
     *  expired sessions do NOT count, or a flaky connection would poison the
     *  whole queue. v1.16.0: cap see SyncManager.MAX_SYNC_ATTEMPTS. */
    val attemptCount: Int = 0,
    /** Poisoned ops stay in the table (sync-queue view can still discard
     *  them) but the drain never picks them up again — a permanently
     *  rejected op used to retry every 15 minutes forever. */
    val poisoned: Boolean = false
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
