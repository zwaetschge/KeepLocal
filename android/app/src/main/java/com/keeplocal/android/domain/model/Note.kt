package com.keeplocal.android.domain.model

import java.time.Instant

data class Note(
    val id: String,
    val title: String,
    val content: String,
    val color: NoteColor,
    val isPinned: Boolean,
    val isArchived: Boolean,
    val isTodoList: Boolean,
    val todoItems: List<TodoItem>,
    val tags: List<String>,
    val sharedWith: List<SharedUser>,
    val owner: String,
    val position: Int,
    val createdAt: Instant,
    val updatedAt: Instant,
    // Server-side image attachments; empty when the note has none (yet).
    val images: List<NoteImage> = emptyList(),
    // Optimistic locking: server version this local copy is based on. Null when
    // the note has never been synced (server then accepts updates unchecked).
    val baseUpdatedAt: Instant? = null,
    // Set while the note sits in the 30-day server trash (null on live notes).
    // Only the trash screen reads it — trashed notes never enter the local cache.
    val deletedAt: Instant? = null,
    // Reminder (v1.8.0): server-side trigger time. The server only stores and
    // validates it; each device schedules its own local notification
    // (AlarmManager), so reminders fire offline and without push infrastructure.
    val remindAt: Instant? = null,
    // Tree (v1.10.0): parent note id; null = root level. A note with children
    // doubles as a folder — there is no separate folder type, mirroring the
    // server's single-parent model. Single-parent by design this round; clones
    // would need a join table on both ends.
    val parentId: String? = null,
    // Code note (v1.10.0): render content monospaced instead of the paper font.
    val isCode: Boolean = false
)

/**
 * One image attachment of a note. [url]/[thumbnailUrl] are server-relative
 * paths like "/uploads/images/x.webp" — resolve them against the configured
 * server base URL before loading (see MediaRepository.resolveImageUrl).
 */
data class NoteImage(
    val filename: String,
    val url: String,
    val thumbnailUrl: String? = null,
    val originalName: String? = null
) {
    /** Preferred URL for display: the lightweight thumbnail when present. */
    fun bestUrl(): String = if (!thumbnailUrl.isNullOrBlank()) thumbnailUrl else url
}

data class TodoItem(
    val id: String,
    val text: String,
    val isCompleted: Boolean,
    val position: Int
)

data class SharedUser(
    val userId: String,
    val username: String
)

/**
 * Note colors with their server hex values (the WebUI palette and the
 * NOTE_COLORS whitelist in notesService.js). The wire format is always the
 * hex — the server rejects anything else with 400 "Farbe muss ein gültiger
 * Hex-Code sein".
 */
enum class NoteColor(val hex: String) {
    DEFAULT("#ffffff"), RED("#f28b82"), ORANGE("#fbbc04"), YELLOW("#fff475"),
    GREEN("#ccff90"), TEAL("#a7ffeb"), BLUE("#cbf0f8"), DARK_BLUE("#aecbfa"),
    PURPLE("#d7aefb"), PINK("#fdcfe8"), BROWN("#e6c9a8"), GRAY("#e8eaed");

    companion object {
        /** Maps a server color back to the enum; unknown values fall back to DEFAULT. */
        fun fromHex(hex: String?): NoteColor =
            entries.firstOrNull { it.hex.equals(hex, ignoreCase = true) } ?: DEFAULT
    }
}
